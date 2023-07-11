imports.gi.versions.Gst = "1.0";
const Gst = imports.gi.Gst;

const Clutter = imports.gi.Clutter;
const Animation = imports.ui.animation;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Radio = Extension.imports.radio;
const Slider = imports.ui.slider;
const Channels = Extension.imports.channels;
const Data = Extension.imports.data;
const Pango = imports.gi.Pango;

var SomaFMPopup = GObject.registerClass(
    {
        GTypeName: 'SomaFMPopup'
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
            width: 200,
        });
        this.volBox = new St.BoxLayout({
            vertical: false,
            width: 200,
        });

        this.add_child(this.box);

        // Volume slider
        this.slider = new Slider.Slider(this.volume);
        this.slider.connect('notify::value', this.setVolume.bind(this));

        // Mute icon
        this.mute_icon = new St.Icon({
            icon_name: 'audio-volume-medium-symbolic',
            icon_size: 20,
            reactive: true,
            style: 'margin-right:5px',
        });

        this.mute_icon.connect('button-press-event', Lang.bind(this, this.setMute));

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
            this.box.remove_child(this.loadtxt);
            this.box.remove_child(this.spinner);
        } else {
            this.box.add_child(this.loadtxt);
            this.box.add_child(this.spinner);
        }
    }

    setError(state) {
        if (!state) {
            if(this.err != null) {
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
        this.spinnerIcon = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/process-working.svg');
        this.spinner = new Animation.AnimatedIcon(this.spinnerIcon, 16);
        this.spinner.x_align = Clutter.ActorAlign.CENTER;
        this.spinner.x_expand = true;
        this.spinner.play();
        this.loadtxt = new St.Label({
            text: "Loading...",
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        this.controlbtns = new Radio.ControlButtons(this.player, this);
        this.player.setOnError(Lang.bind(this, function () {
            this.setError(false);
            this.setError(true);
        }));

        this.box.add_child(this.controlbtns);

        // Stream description
        this.desc = new St.Label({
            text:"Soma FM",
            style: 'padding:5px',
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
            gicon: Gio.icon_new_for_string(Extension.path + this.player.getChannel().getPic()),
            style: 'padding:10px',
            icon_size: 75,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        // favorite button
        this.star = new St.Icon({
            icon_name: this.player.getChannel().isFav() ? 'starred-symbolic' : 'non-starred-symbolic',
            icon_size: 20,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        this.star.connect('button-press-event', Lang.bind(this, function () {
            if (this.player.getChannel().isFav()) {
                this.star.set_icon_name('non-starred-symbolic');
                favs.splice(favs.indexOf(this.player.getChannel().getNum()), 1);
                this.player.getChannel().setFav(false);
            } else {
                this.star.set_icon_name('starred-symbolic');
                favs.push(this.player.getChannel().getNum());
                this.player.getChannel().setFav(true);
            }
            Data.save(this.player.getChannel(), this.volume, favs);

            // Reload favorites
            reloadFavsMenu();
        }));

        this.box.add_child(this.ch_pic);
        this.box.add_child(this.star);

        // This listener may be still buggy. 
        this.player.setOnTagChanged(Lang.bind(this, function(){
            let tag = this.player.getTag();
            if(tag == null) tag = 'Soma FM';
            this.desc.set_text(tag);
            this.setLoading(false);
            this.setError(false);
        }));

    }

    stopped() {
        this.controlbtns.icon.set_icon_name('media-playback-start-symbolic');
        this.controlbtns.playing = false;
        this.setLoading(false);
        this.desc.set_text('Soma FM');
    }

    channelChanged() {
        this.controlbtns.icon.set_icon_name('media-playback-stop-symbolic');
        this.controlbtns.playing = true;
        this.setLoading(false);
        this.setLoading(true);
        this.ch.set_text(this.player.getChannel().getName());
        this.desc.set_text('Soma FM');
        this.ch_pic.set_gicon(Gio.icon_new_for_string(Extension.path + this.player.getChannel().getPic()));
        this.cfav = this.player.getChannel().isFav();
        this.star.set_icon_name(this.cfav ? 'starred-symbolic' : 'non-starred-symbolic');
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
        if (vol == 0)
            this.mute_icon.set_icon_name('audio-volume-muted-symbolic');
        else if (vol < 0.3)
            this.mute_icon.set_icon_name('audio-volume-low-symbolic');
        else if (vol < 0.6)
            this.mute_icon.set_icon_name('audio-volume-medium-symbolic');
        else
            this.mute_icon.set_icon_name('audio-volume-high-symbolic');
    }

});

var SomaFMPanelButton = GObject.registerClass(
    {
        GTypeName: 'SomaFMPanelButton'
    },
    class extends PanelMenu.Button {

    _init(player) {
        
        super._init(0.0, "SomaFm");

        let box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });
        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(Extension.path + '/radio-symbolic.svg'),
            style_class: 'system-status-icon',
        });
        box.add_actor(icon);
        this.add_actor(box);
        this.add_style_class_name('panel-status-button');

        popup = new SomaFMPopup(player);
        this.menu.addMenuItem(popup);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        fav_menu = new PopupMenu.PopupSubMenuMenuItem('Favorites');
        this.menu.addMenuItem(fav_menu);

        reloadFavsMenu();

        let channelsMenu = new PopupMenu.PopupSubMenuMenuItem('Channels');
        this.menu.addMenuItem(channelsMenu);
        Channels.getChannels().forEach(ch => {
            channelsMenu.menu.addMenuItem(new Channels.ChannelBox(ch, player, popup));
        });
    }

});

function reloadFavsMenu() {
    if(fav_menu == null)
        return;
        
    let chs = Channels.getFavChannels();
    fav_menu.menu.removeAll();
    if (chs.length < 1) {
        let emptymenu = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        emptymenu.add(new St.Label({ text: "Empty" }));
        fav_menu.menu.addMenuItem(emptymenu);
        return;
    }

    chs.forEach(ch => {
        fav_menu.menu.addMenuItem(new Channels.ChannelBox(ch, player, popup));
    });
}

function init() {
}

let player;
let button;
let popup;
let favs;
let fav_menu;

function enable() {
    player = new Radio.RadioPlayer(Data.getLastChannel());
    player.setVolume(Data.getLastVol());

    favs = Data.getFavs();
    if (favs == null)
        favs = [];

    button = new SomaFMPanelButton(player);
    Main.panel.addToStatusArea('somafm', button);
}

function disable() {
    //popup.disconnectAll();
    player.stop();
    popup.destroy();
    button.destroy();
    favs = null;
}
