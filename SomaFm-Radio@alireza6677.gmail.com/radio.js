const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gst = imports.gi.Gst;
const GstAudio = imports.gi.GstAudio;
const Lang = imports.lang;
const St = imports.gi.St;
const Channels = Extension.imports.channels;

const DEFAULT_VOLUME = 0.5;
const CLIENT_NAME = "somafm-radio";

const ControlButtons = new Lang.Class({
    Name: 'ControlButtons',
    Extends: St.BoxLayout,

    _init: function (player, pr) {
        this.parent({
            vertical: false,
        });

        this.prev = new St.Icon({
            style_class: 'icon',
            icon_name: 'gtk-media-previous',
            reactive: true,
            icon_size: 25,
        });

        this.icon = new St.Icon({
            style_class: 'icon',
            icon_name: 'gtk-media-play',
            reactive: true,
        });

        this.next = new St.Icon({
            style_class: 'icon',
            icon_name: 'gtk-media-next',
            reactive: true,
            icon_size: 25,
        });

        this.add_child(this.prev);
        this.add_child(this.icon);
        this.add_child(this.next);

        this.player = player;
        this.playing = false;
        this.pr = pr;

        this.next.connect('button-press-event', Lang.bind(this, function () {
            this.player.stop();
            this.player.next();
            this.player.play();
            this.pr.channelChanged();
        }));

        this.prev.connect('button-press-event', Lang.bind(this, function () {
            this.player.stop();
            this.player.prev();
            this.player.play();
            this.pr.channelChanged();
        }));

        this.icon.connect('button-press-event', Lang.bind(this, function () {
            if (this.playing) {
                this.player.stop();
                this.icon.set_icon_name('gtk-media-play');
                this.pr.setLoading(false);
                this.pr.desc.set_text('SOMA FM');
            } else {
                this.player.play();
                this.icon.set_icon_name('gtk-media-stop');
                this.pr.setLoading(false);
                this.pr.setLoading(true);
                if (this.pr.err)
                    this.pr.err.destroy();
            }

            this.playing = !this.playing;
        }));
    },

});

const RadioPlayer = new Lang.Class({
    Name: 'RadioPlayer',

    _init: function (channel) {
        Gst.init(null, 0);
        this.playbin = Gst.ElementFactory.make("playbin", "somafm");
        this.playbin.set_property("uri", channel.getLink());
        this.sink = Gst.ElementFactory.make("pulsesink", "sink");
        // Using 'stream-changed' listener is better than checking the description tag :|  (extension.js:165)
        // Set the client name, so i can find my stream in active streams
        this.sink.set_property('client-name', CLIENT_NAME);
        this.playbin.set_property("audio-sink", this.sink);
        this.channel = channel;
        this.setVolume(DEFAULT_VOLUME);
        this.tag = '';

        let bus = this.playbin.get_bus();
        bus.add_signal_watch();
        bus.connect("message", Lang.bind(this, function (bus, msg) {
            if (msg != null)
                this._onMessageReceived(msg);
        }));


    },

    play: function () {
        this.playbin.set_state(Gst.State.PLAYING);
        this.playing = true;
    },

    get: function () {
        return this.sink.get_property()
    },
    setOnError: function (onError) {
        this.onError = onError;
    },

    setMute: function (mute) {
        this.playbin.set_property("mute", mute);
    },

    stop: function () {
        this.playbin.set_state(Gst.State.NULL);
        this.playing = false;
    },

    next: function () {
        num = this.channel.getNum();
        if (num >= Channels.channels.length - 1)
            num = 0;
        else
            num += 1;

        this.setChannel(Channels.getChannel(num));
    },

    prev: function () {
        num = this.channel.getNum();
        if (num <= 0)
            num = Channels.channels.length - 1;
        else
            num -= 1;

        this.setChannel(Channels.getChannel(num));
    },

    setChannel: function (ch) {
        this.channel = ch;
        this.playbin.set_property("uri", ch.getLink());
    },
    getChannel: function () {
        return this.channel;
    },

    setVolume: function (value) {
        this.playbin.set_volume(GstAudio.StreamVolumeFormat.LINEAR, value);
    },

    isPlaying: function () {
        return this.playing;
    },
    getTag: function () {
        return this.tag;
    },
    _onMessageReceived: function (msg) {
        switch (msg.type) {

            case Gst.MessageType.TAG:
                let tagList = msg.parse_tag();
                let tmp = tagList.get_string('title');

                tag = tmp[1];
                this.tag = tag;
              //  global.log(tag);
                break;
            case Gst.MessageType.ERROR:
                this.stop();
                this.onError();
                break;
            case Gst.MessageType.STATE_CHANGED:
                break;
            case Gst.MessageType.EOS:
                this.stop();
                this.onError();
                break;
            default:
                break;
        }
    },

})
