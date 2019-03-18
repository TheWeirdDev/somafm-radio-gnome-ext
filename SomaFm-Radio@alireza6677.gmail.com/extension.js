imports.gi.versions.Gst = "1.0";
const Gst = imports.gi.Gst;

const Animation = imports.ui.animation;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Radio = Extension.imports.radio;
const Slider = imports.ui.slider;
//const Volume = imports.ui.status.volume;
const Channels = Extension.imports.channels;
const Data = Extension.imports.data;
const Pango = imports.gi.Pango;
// I'm not a JS developer.
// The code may look shitty. But it Works! :)


var Popup = class PopUp extends PopupMenu.PopupBaseMenuItem {

    constructor(player) {

        super({
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
        this.bb = new St.BoxLayout({
            vertical: true,
            width: 170,
        });

        this.actor.add(this.box);

        this.setLoading(true);

        // Volume slider
        this.slider = new Slider.Slider(this.volume);
        this.slider.connect('value-changed', Lang.bind(this, this.setVolume));

        this.bb.add_child(this.slider.actor);

        // Mute icon
        this.mute_icon = new St.Icon({
            icon_name: 'audio-volume-medium-symbolic',
            icon_size: 20,
            reactive: true,
            style: 'margin-right:5px',
        });

        this.mute_icon.connect('button-press-event', Lang.bind(this, this.setMute));

        this.volBox.add_child(this.mute_icon);
        this.volBox.add_child(this.bb);
        this.box.add_child(this.volBox);

        this.err = new St.Label({ text: "--- Error ---" });
        this.createUi();
    }

    setMute() {
        if (this.volume > 0) {
            this.old_vol = this.volume;
            this.volume = 0;
            this.slider.setValue(0);

        } else {
            this.volume = this.old_vol;
            this.slider.setValue(this.volume);
        }
        this.player.setMute(this.volume == 0);
        this.setVolIcon(this.volume);

    }

    setLoading(state) {
        if (!state) {
            this.spinner.actor.destroy();
            this.loadtxt.destroy();
            return;
        }
        let spinnerIcon = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/process-working.svg');
        this.spinner = new Animation.AnimatedIcon(spinnerIcon, 16);
        this.spinner.play();
        this.loadtxt = new St.Label({ text: "Loading..." });
        this.box.add(this.loadtxt, { x_fill: false, x_align: St.Align.MIDDLE });
        this.box.add_child(this.spinner.actor);
    }

    setError(state) {
        if (!state) {
            this.err.destroy();
            return;
        }
        this.stopped();
        this.err = new St.Label({ text: "--- Error ---" });
        this.box.add(this.err, { x_fill: false, x_align: St.Align.MIDDLE });
    }

    createUi() {
        this.setLoading(false);

        this.controlbtns = new Radio.ControlButtons(this.player, this);
        this.player.setOnError(Lang.bind(this, function () {
            this.setError(false);
            this.setError(true);
        }));

        this.box.add(this.controlbtns, { x_align: St.Align.MIDDLE, x_fill: false });

        // Stream description
        this.desc = new St.Label({ text:"Soma FM" , style: 'padding:5px' });
        this.desc.clutter_text.line_wrap = true;
        this.desc.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.desc.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this.box.add(this.desc, { x_fill: false, x_align: St.Align.MIDDLE });

        // Current channel
        this.ch = new St.Label({ text: this.player.getChannel().getName(), reactive: true });
        this.box.add(this.ch, { x_fill: false, x_align: St.Align.MIDDLE });

        // Channel picture
        this.ch_pic = new St.Icon({
            gicon: Gio.icon_new_for_string(Extension.path + this.player.getChannel().getPic()),
            style: 'padding:10px',
            icon_size: 75,
        });

        // favorite button
        this.star = new St.Icon({
            icon_name: this.player.getChannel().isFav() ? 'starred-symbolic' : 'non-starred-symbolic',
            icon_size: 20,
            reactive: true,
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

        this.box.add(this.ch_pic, { x_fill: false, x_align: St.Align.MIDDLE });
        this.box.add(this.star, { x_fill: false, x_align: St.Align.MIDDLE });

        // This listener may be still buggy. 
        this.player.setOnTagChanged(Lang.bind(this, function(){
            let tag = this.player.getTag();
            if(tag == null) tag = 'Soma FM';
            this.desc.set_text(tag);
            this.setLoading(false);
        }));

        // This piece of code is not compatible with gnome 3.18 and before that. I'm commenting it out. It may be useful later
        //
        // this.mixer = Volume.getMixerControl();
        // this.stream_id = this.mixer.connect('stream-changed', Lang.bind(this, function () {
        //     for (var i = 0, c = this.mixer.get_streams(); i < c.length; i++) {
        //         if (c[i].name == Radio.CLIENT_NAME) {
        //             if (this.player.isPlaying()) {
        //                 this.desc.set_text(c[i].description);
        //                 if (c[i].description != 'pulsesink probe')
        //                     this.setLoading(false);
        //                 this.ch.set_text(this.player.getChannel().getName());
        //                 break;
        //             }
        //             //EXPERIMENTAL
        //             //if(!this.slider._dragging)
        //             //  this.slider.setValue(c[i].volume / 65536);
        //         }
        //     }
        // })
        // );

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
    setVolume(slider, vol, property) {
        this.player.setVolume(vol);
        this.volume = vol;
        this.setVolIcon(vol);
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

}

var PanelButton = class PanelButton extends PanelMenu.Button {

    constructor(player) {
        
        super(0.0, "SomaFm");

        let box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });
        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(Extension.path + '/radio-symbolic.svg'),
            style_class: 'system-status-icon',
        });
        box.add_actor(icon);
        this.actor.add_actor(box);
        this.actor.add_style_class_name('panel-status-button');

        popup = new Popup(player);
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
}

function reloadFavsMenu() {
    if(fav_menu == null)
        return;
        
    let chs = Channels.getFavChannels();
    fav_menu.menu.removeAll();
    if (chs.length < 1) {
        let emptymenu = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        emptymenu.actor.add(new St.Label({ text: "Empty" }));
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

    button = new PanelButton(player);
    Main.panel.addToStatusArea('somafm', button);
}

function disable() {
    //popup.disconnectAll();
    player.stop();
    popup.destroy();
    button.destroy();
    favs = null;
}
