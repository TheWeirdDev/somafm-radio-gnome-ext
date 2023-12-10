// imports.gi.versions.Gst = "1.0";
// import Gst from "gi://Gst";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Pango from "gi://Pango";

import * as Animation from "resource:///org/gnome/shell/ui/animation.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import * as Channels from "./channels.js";
import * as Radio from "./radio.js";
import * as Data from "./data.js";

// const Extension = imports.misc.extensionUtils.getCurrentExtension();

let player;
let button;
let popup;
let favs;
let fav_menu;
export let extPath;

const SomaFMPopup = GObject.registerClass(
    {
        GTypeName: "SomaFMPopup",
    },
    class extends PopupMenu.PopupBaseMenuItem {
        _init(player) {
            super._init({
                hover: false,
                activate: false,
                can_focus: true,
            });

            this.volume = Data.getLastVol();
            this.old_vol = 0;

            this.player = player;

            this.box = new St.BoxLayout({
                vertical: true,
                width: 250,
            });
            this.volBox = new St.BoxLayout({
                vertical: false,
                width: 250,
            });

            this.add_child(this.box);

            // Volume slider
            this.slider = new Slider.Slider(this.volume);
            this.slider.connect("notify::value", this.setVolume.bind(this));

            // Mute icon
            this.mute_icon = new St.Icon({
                icon_name: "audio-volume-medium-symbolic",
                icon_size: 20,
                reactive: true,
                style: "margin-right:5px",
            });

            this.mute_icon.connect("button-press-event", () => this.setMute());

            this.volBox.add_child(this.mute_icon);
            this.volBox.add_child(this.slider);
            this.box.add_child(this.volBox);

            this.err = null;
            this.createUi();
        }

        setMute() {
            if (this.volume > 0) {
                this.old_vol = this.volume;
                this.volume = 0;
                this.slider.value = 0;
            } else {
                this.volume = this.old_vol;
                this.slider.value = this.volume;
            }
            this.player.setMute(this.volume == 0);
            this.setVolIcon(this.volume);
        }

        setLoading(state) {
            if (!state) {
                this.loadtxt.hide();
                this.spinner.hide();
            } else {
                this.loadtxt.show();
                this.spinner.show();
            }
        }

        setError(state) {
            if (!state) {
                if (this.err != null) {
                    this.err.destroy();
                    this.err = null;
                }
                return;
            }
            this.stopped();
            this.err = new St.Label({
                text: "--- Error ---",
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this.box.add_child(this.err);
        }

        createUi() {
            this.spinnerIcon = Gio.File.new_for_uri(
                "resource:///org/gnome/shell/theme/process-working.svg",
            );
            this.spinner = new Animation.AnimatedIcon(this.spinnerIcon, 16);
            this.spinner.x_align = Clutter.ActorAlign.CENTER;
            this.spinner.x_expand = true;
            this.spinner.play();
            this.spinner.hide();
            
            this.loadtxt = new St.Label({
                text: "Loading...",
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this.loadtxt.hide();

            this.controlbtns = new Radio.ControlButtons(this.player, this);
            this.player.setOnError(() => {
                this.setError(false);
                this.setError(true);
            });

            this.box.add_child(this.controlbtns);

            // Stream description
            this.desc = new St.Label({
                text: "Soma FM",
                style: "padding:5px",
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this.desc.clutter_text.line_wrap = true;
            this.desc.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            this.desc.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            this.box.add_child(this.desc);

            // Current channel
            this.ch = new St.Label({
                text: this.player.getChannel().getName(),
                reactive: true,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this.box.add_child(this.ch);

            // Channel picture
            this.ch_pic = new St.Icon({
                gicon: Gio.icon_new_for_string(
                    extPath + this.player.getChannel().getPic(),
                ),
                style: "padding:10px",
                icon_size: 100,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            // favorite button
            this.star = new St.Icon({
                icon_name: this.player.getChannel().isFav()
                    ? "starred-symbolic"
                    : "non-starred-symbolic",
                icon_size: 25,
                reactive: true,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            this.star.connect("button-press-event", () => {
                if (this.player.getChannel().isFav()) {
                    this.star.set_icon_name("non-starred-symbolic");
                    favs.splice(favs.indexOf(this.player.getChannel().getNum()), 1);
                    this.player.getChannel().setFav(false);
                } else {
                    this.star.set_icon_name("starred-symbolic");
                    favs.push(this.player.getChannel().getNum());
                    this.player.getChannel().setFav(true);
                }
                Data.save(this.player.getChannel(), this.volume, favs);

                // Reload favorites
                reloadFavsMenu();
            });

            this.box.add_child(this.ch_pic);
            this.box.add_child(this.star);

            // This listener may be still buggy.
            this.player.setOnTagChanged(() => {
                let tag = this.player.getTag();
                if (tag == null) tag = "Soma FM";
                this.desc.set_text(tag);
                this.setLoading(false);
                this.setError(false);
            });

            this.box.add_child(this.spinner);
            this.box.add_child(this.loadtxt);
        }

        stopped() {
            this.controlbtns.icon.set_icon_name("media-playback-start-symbolic");
            this.controlbtns.playing = false;
            this.setLoading(false);
            this.desc.set_text("Soma FM");
        }

        channelChanged() {
            this.controlbtns.icon.set_icon_name("media-playback-stop-symbolic");
            this.controlbtns.playing = true;
            this.setLoading(false);
            this.setLoading(true);
            this.ch.set_text(this.player.getChannel().getName());
            this.desc.set_text("Soma FM");
            this.ch_pic.set_gicon(
                Gio.icon_new_for_string(extPath + this.player.getChannel().getPic()),
            );
            this.cfav = this.player.getChannel().isFav();
            this.star.set_icon_name(
                this.cfav ? "starred-symbolic" : "non-starred-symbolic",
            );
            Data.save(this.player.getChannel(), this.volume, favs);
        }
        // disconnectAll: function () {
        //     this.mixer.disconnect(this.stream_id);
        // },
        setVolume(slider, event) {
            this.player.setVolume(slider.value);
            this.volume = slider.value;
            this.setVolIcon(slider.value);
            Data.save(this.player.getChannel(), this.volume, favs);
        }

        setVolIcon(vol) {
            if (vol == 0) this.mute_icon.set_icon_name("audio-volume-muted-symbolic");
            else if (vol < 0.3)
                this.mute_icon.set_icon_name("audio-volume-low-symbolic");
            else if (vol < 0.6)
                this.mute_icon.set_icon_name("audio-volume-medium-symbolic");
            else this.mute_icon.set_icon_name("audio-volume-high-symbolic");
        }
    },
);

const SomaFMPanelButton = GObject.registerClass(
    {
        GTypeName: "SomaFMPanelButton",
    },
    class extends PanelMenu.Button {
        _init(player) {
            super._init(0.0, "SomaFm");

            let box = new St.BoxLayout({
                style_class: "panel-status-menu-box",
            });
            let icon = new St.Icon({
                gicon: Gio.icon_new_for_string(extPath + "/radio-symbolic.svg"),
                style_class: "system-status-icon",
            });
            box.add_actor(icon);
            this.add_actor(box);
            this.add_style_class_name("panel-status-button");

            popup = new SomaFMPopup(player);
            this.menu.addMenuItem(popup);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            fav_menu = new PopupMenu.PopupSubMenuMenuItem("Favorites");
            fav_menu.menu.actor.add_style_class_name("somafm-popup-sub-menu");
            this.menu.addMenuItem(fav_menu);

            reloadFavsMenu();

            let channelsMenu = new PopupMenu.PopupSubMenuMenuItem("Channels");
            channelsMenu.menu.actor.add_style_class_name("somafm-popup-sub-menu");
            this.menu.addMenuItem(channelsMenu);
            
            Channels.getChannels().forEach((ch) => {
                channelsMenu.menu.addMenuItem(
                    new Channels.ChannelBox(ch, player, popup),
                );
            });
        }
    },
);

function reloadFavsMenu() {
    if (fav_menu == null) return;

    let chs = Channels.getFavChannels();
    fav_menu.menu.removeAll();
    if (chs.length < 1) {
        let emptymenu = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        emptymenu.add(new St.Label({ text: "Empty" }));
        fav_menu.menu.addMenuItem(emptymenu);
        return;
    }

    chs.forEach((ch) => {
        fav_menu.menu.addMenuItem(new Channels.ChannelBox(ch, player, popup));
    });
}

export default class SomaFMRadioExtension extends Extension {
    enable() {
        extPath = this.path;
        player = new Radio.RadioPlayer(Data.getLastChannel());
        player.setVolume(Data.getLastVol());

        favs = Data.getFavs();
        if (favs == null) favs = [];

        button = new SomaFMPanelButton(player);
        Main.panel.addToStatusArea("somafm", button);
    }

    disable() {
        //popup.disconnectAll();
        player.stop();
        popup.destroy();
        button.destroy();
        favs = null;
        button = null;
        popup = null;
        player = null;
        fav_menu = null;
    }
}
