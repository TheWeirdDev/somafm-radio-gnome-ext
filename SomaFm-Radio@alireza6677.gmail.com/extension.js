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
import * as Streams from "./streams.js";
import * as Api from "./somafm-api.js";

// const Extension = imports.misc.extensionUtils.getCurrentExtension();

let player;
let button;
let popup;
let favs;
let fav_menu;
let channels_menu;
let quality_menu;
let quality_items = [];
let cancellable;
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
            this.loadingBox = new St.BoxLayout({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                style_class: 'somafm-popup-loading-box',
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
                this.spinner.stop();
                this.spinner.hide();
            } else {
                this.loadtxt.show();
                this.spinner.play();
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
            this.spinner = new Animation.Spinner(16);
            this.loadtxt = new St.Label({
                text: "Loading...",
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
                reactive: true,
            });
            this.desc.clutter_text.line_wrap = true;
            this.desc.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            this.desc.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this.desc.connect('button-press-event', () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this.desc.text));

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
                gicon: this.player.getChannel().getGicon(),
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
                const id = this.player.getChannel().getId();
                if (this.player.getChannel().isFav()) {
                    this.star.set_icon_name("non-starred-symbolic");
                    favs.splice(favs.indexOf(id), 1);
                    this.player.getChannel().setFav(false);
                } else {
                    this.star.set_icon_name("starred-symbolic");
                    favs.push(id);
                    this.player.getChannel().setFav(true);
                }
                Data.save(
                    this.player.getChannel(),
                    this.volume,
                    favs,
                    this.player.getQuality(),
                );

                // Rebuild Channel objects so their stars reflect the new favs
                Channels.invalidate();
                reloadFavsMenu();
            });

            this.box.add_child(this.ch_pic);
            this.box.add_child(this.star);

            // Channels that are only in the live list have no bundled logo.
            this.setChannelIcon();

            // This listener may be still buggy.
            this.player.setOnTagChanged(() => {
                let tag = this.player.getTag();
                if (tag == null) tag = "Soma FM";
                this.desc.set_text(tag);
                this.setLoading(false);
                this.setError(false);
            });
            
            this.loadingBox.add_child(this.spinner);
            this.loadingBox.add_child(this.loadtxt);
            this.box.add_child(this.loadingBox);

            this.spinner.hide();
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
            this.setChannelIcon();
            this.cfav = this.player.getChannel().isFav();
            this.star.set_icon_name(
                this.cfav ? "starred-symbolic" : "non-starred-symbolic",
            );
            // The available HLS tiers depend on the channel, and setChannel()
            // may have degraded the active quality.
            rebuildQualityMenu();
            Data.save(
                this.player.getChannel(),
                this.volume,
                favs,
                this.player.getQuality(),
            );
        }

        setChannelIcon() {
            const ch = this.player.getChannel();
            this.ch_pic.set_gicon(ch.getGicon());
            ch.ensureArt(() => this.ch_pic.set_gicon(ch.getGicon()));
        }
        // disconnectAll: function () {
        //     this.mixer.disconnect(this.stream_id);
        // },
        setVolume(slider, event) {
            this.player.setVolume(slider.value);
            this.volume = slider.value;
            this.setVolIcon(slider.value);
            Data.save(
                this.player.getChannel(),
                this.volume,
                favs,
                this.player.getQuality(),
            );
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
            box.add_child(icon);
            this.add_child(box);
            this.add_style_class_name("panel-status-button");

            popup = new SomaFMPopup(player);
            this.menu.addMenuItem(popup);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            fav_menu = new PopupMenu.PopupSubMenuMenuItem("Favorites");
            fav_menu.menu.actor.add_style_class_name("somafm-popup-sub-menu");
            this.menu.addMenuItem(fav_menu);

            reloadFavsMenu();

            channels_menu = new PopupMenu.PopupSubMenuMenuItem("Channels");
            channels_menu.menu.actor.add_style_class_name("somafm-popup-sub-menu");
            this.menu.addMenuItem(channels_menu);

            reloadChannelsMenu();

            quality_menu = new PopupMenu.PopupSubMenuMenuItem("Quality");
            quality_menu.menu.actor.add_style_class_name("somafm-popup-sub-menu");
            this.menu.addMenuItem(quality_menu);

            rebuildQualityMenu();
        }
    },
);

function reloadFavsMenu() {
    if (fav_menu == null) return;

    let chs = Channels.getFavChannels();
    fav_menu.menu.removeAll();
    if (chs.length < 1) {
        let emptymenu = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        emptymenu.add_child(new St.Label({ text: "Empty" }));
        fav_menu.menu.addMenuItem(emptymenu);
        return;
    }

    chs.forEach((ch) => {
        fav_menu.menu.addMenuItem(new Channels.ChannelBox(ch, player, popup));
    });
}

function reloadChannelsMenu() {
    if (channels_menu == null) return;

    channels_menu.menu.removeAll();
    Channels.getChannels().forEach((ch) => {
        channels_menu.menu.addMenuItem(new Channels.ChannelBox(ch, player, popup));
    });
}

// Rebuilt on every channel change: the experimental HLS tiers exist for Groove
// Salad only, so the list is per-channel rather than fixed. Never call this
// from a menu item's own activate handler -- see refreshQualityMenu().
function rebuildQualityMenu() {
    if (quality_menu == null || player == null) return;

    quality_menu.menu.removeAll();
    quality_items = [];

    const addTier = (tier) => {
        const item = new PopupMenu.PopupMenuItem(tier.label);
        item.connect("activate", () => setQuality(tier.id));
        quality_menu.menu.addMenuItem(item);
        quality_items.push({ id: tier.id, item });
    };

    Streams.QUALITY_TIERS.forEach(addTier);

    const hls = player.supportsHls()
        ? Streams.hlsTiersFor(player.getChannel().getId())
        : [];
    if (hls.length > 0) {
        quality_menu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        hls.forEach(addTier);
    }

    refreshQualityMenu();
}

// Updates the label and the selected dot in place. Picking a tier must not
// rebuild the menu: removeAll() would destroy the very item whose activate
// signal is still being emitted, and GJS then reports "Object ... has been
// already disposed" when PopupMenuItem.activate() carries on afterwards.
function refreshQualityMenu() {
    if (quality_menu == null || player == null) return;

    const active = player.getQuality();
    quality_menu.label.text = `Quality: ${Streams.labelFor(
        player.getChannel().getId(),
        active,
    )}`;

    quality_items.forEach(({ id, item }) =>
        item.setOrnament(
            id === active ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE,
        ),
    );
}

function setQuality(id) {
    if (player == null) return;

    const wasPlaying = player.isPlaying();
    player.setQuality(id);
    Data.save(player.getChannel(), popup.volume, favs, player.getQuality());
    refreshQualityMenu();

    if (wasPlaying) {
        popup.setError(false);
        popup.setLoading(true);
    }
}

// The live list can rename, add or drop channels, so every menu that shows one
// has to be rebuilt together.
function onChannelListFetched(list) {
    if (list == null || !Channels.setChannelList(list)) return;

    reloadChannelsMenu();
    reloadFavsMenu();
    rebuildQualityMenu();

    // SomaFM retires stations; the saved one may be gone. Playback is left
    // alone rather than silently switched, but say so in the log.
    const id = player.getChannel().getId();
    if (Channels.getChannelById(id).getId() !== id)
        console.warn(`SomaFM: channel ${id} is no longer offered upstream`);
}

export default class SomaFMRadioExtension extends Extension {
    enable() {
        extPath = this.path;

        cancellable = new Gio.Cancellable();
        Channels.setCancellable(cancellable);

        favs = Data.getFavs();
        if (favs == null) favs = [];

        // Built from the on-disk cache (or the bundled list) so enable() never
        // waits on the network.
        player = new Radio.RadioPlayer(
            Channels.getChannelById(Data.getLastChannelId()),
            Data.getQuality(),
        );
        player.setVolume(Data.getLastVol());

        button = new SomaFMPanelButton(player);
        Main.panel.addToStatusArea("somafm", button);

        if (!Api.isFresh(Api.readCache()))
            Api.fetchChannels(cancellable, onChannelListFetched);
    }

    disable() {
        //popup.disconnectAll();
        cancellable?.cancel();
        Api.shutdown();
        Channels.setCancellable(null);
        Channels.reset();
        Data.invalidate();

        player.destroy();
        popup.destroy();
        button.destroy();
        favs = null;
        button = null;
        popup = null;
        player = null;
        fav_menu = null;
        channels_menu = null;
        quality_menu = null;
        quality_items = [];
        cancellable = null;
    }
}
