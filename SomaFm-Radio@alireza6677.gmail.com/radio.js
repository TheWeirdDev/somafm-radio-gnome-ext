// imports.gi.versions.Gst = "1.0";
// imports.gi.versions.GstAudio = "1.0";
import Gst from "gi://Gst";
import GstAudio from "gi://GstAudio";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Channels from "./channels.js";
import * as Streams from "./streams.js";

const DEFAULT_VOLUME = 0.5;
const CLIENT_NAME = "somafm-radio";

// HLS is demuxed by adaptivedemux2, which only works inside a streams-aware
// pipeline: with the classic "playbin" every HLS URL fails with "Element
// requires a streams-aware context". playbin3 plays both HLS and the plain
// Icecast streams, so prefer it and keep playbin purely as a fallback for
// GStreamer builds that lack it.
function makePlaybin() {
    const playbin3 = Gst.ElementFactory.make("playbin3", "somafm");
    if (playbin3 != null) return { element: playbin3, hls: true };

    console.warn("SomaFM: playbin3 unavailable, HLS tiers disabled");
    return { element: Gst.ElementFactory.make("playbin", "somafm"), hls: false };
}

export const ControlButtons = GObject.registerClass(
    {
        GTypeName: "ControlButtons",
    },
    class ControlButtons extends St.BoxLayout {
        _init(player, pr) {
            super._init({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            this.prev = new St.Icon({
                style_class: "icon",
                icon_name: "media-skip-backward-symbolic",
                reactive: true,
                icon_size: 25,
            });

            this.icon = new St.Icon({
                style_class: "icon",
                icon_name: "media-playback-start-symbolic",
                reactive: true,
            });

            this.next = new St.Icon({
                style_class: "icon",
                icon_name: "media-skip-forward-symbolic",
                reactive: true,
                icon_size: 25,
            });

            this.add_child(this.prev);
            this.add_child(this.icon);
            this.add_child(this.next);

            this.player = player;
            this.playing = false;
            this.pr = pr;

            this.next.connect("button-press-event", () => {
                this.player.stop();
                this.player.next();
                this.player.play();
                this.pr.channelChanged();
            });

            this.prev.connect("button-press-event", () => {
                this.player.stop();
                this.player.prev();
                this.player.play();
                this.pr.channelChanged();
            });

            this.icon.connect("button-press-event", () => {
                if (this.playing) {
                    this.player.stop();
                    this.icon.set_icon_name("media-playback-start-symbolic");
                    this.pr.setLoading(false);
                    this.pr.desc.set_text("Soma FM");
                } else {
                    this.player.play();
                    this.icon.set_icon_name("media-playback-stop-symbolic");
                    this.pr.setLoading(false);
                    this.pr.setLoading(true);
                    if (this.pr.err != null) this.pr.err.destroy();
                }

                this.playing = !this.playing;
            });
        }
    },
);

export const RadioPlayer = class RadioPlayer {
    constructor(channel, quality) {
        Gst.init([]);

        const { element, hls } = makePlaybin();
        this.playbin = element;
        this.hlsAvailable = hls;

        this.channel = channel;
        this.quality = Streams.coerceQuality(
            channel.getId(),
            quality,
            this.hlsAvailable,
        );
        // Index into the Icecast host ring; advanced by _retryNextHost().
        this.hostIndex = 0;

        this.playbin.set_property("uri", this._uri());
        this.sink = Gst.ElementFactory.make("pulsesink", "sink");

        this.sink.set_property("client-name", CLIENT_NAME);
        this.playbin.set_property("audio-sink", this.sink);
        this.setVolume(DEFAULT_VOLUME);
        this.tag = "Soma FM";

        this.bus = this.playbin.get_bus();
        this.bus.add_signal_watch();
        this.busId = this.bus.connect("message", (bus, msg) => {
            if (msg != null) this._onMessageReceived(msg);
        });
        this.onError = null;
        this.onTagChanged = null;
    }

    // disable() used to only stop playback, leaving the bus watch and its
    // handler alive; they leaked across every disable/enable cycle.
    destroy() {
        this.stop();

        if (this.bus != null) {
            if (this.busId != null) this.bus.disconnect(this.busId);
            this.bus.remove_signal_watch();
            this.bus = null;
            this.busId = null;
        }
        this.onError = null;
        this.onTagChanged = null;
        this.playbin = null;
        this.sink = null;
    }

    play() {
        this.playbin.set_state(Gst.State.PLAYING);
        this.playing = true;
    }

    setOnError(onError) {
        this.onError = onError;
    }

    setOnTagChanged(onTagChanged) {
        this.onTagChanged = onTagChanged;
    }

    setMute(mute) {
        this.playbin.set_property("mute", mute);
    }

    stop() {
        this.playbin.set_state(Gst.State.NULL);
        this.playing = false;
        this.tag = "Soma FM";
    }

    next() {
        this.setChannel(Channels.neighbour(this.channel.getId(), 1));
    }

    prev() {
        this.setChannel(Channels.neighbour(this.channel.getId(), -1));
    }

    setChannel(ch) {
        this.channel = ch;
        // The HLS tiers exist for one channel only, so the selected quality
        // may not be available here. coerceQuality() degrades it instead of
        // building a URL that would 404.
        this.quality = Streams.coerceQuality(
            ch.getId(),
            this.quality,
            this.hlsAvailable,
        );
        this.hostIndex = 0;
        this.stop();
        this.playbin.set_property("uri", this._uri());
        this.play();
    }

    getChannel() {
        return this.channel;
    }

    getQuality() {
        return this.quality;
    }

    supportsHls() {
        return this.hlsAvailable;
    }

    setQuality(quality) {
        const wasPlaying = this.playing;
        this.quality = Streams.coerceQuality(
            this.channel.getId(),
            quality,
            this.hlsAvailable,
        );
        this.hostIndex = 0;
        this.stop();
        this.playbin.set_property("uri", this._uri());
        if (wasPlaying) this.play();
    }

    _uri() {
        return Streams.resolveUri(
            this.channel.getId(),
            this.quality,
            this.hostIndex,
        );
    }

    // A dead Icecast node used to surface as "--- Error ---" with no retry,
    // because the stream URL was pinned to a single host. Walk the rest of the
    // ring before giving up. HLS has one host, so there is nothing to retry.
    _retryNextHost() {
        if (!this.playing) return false;
        if (Streams.isHls(this.quality)) return false;
        if (this.hostIndex >= Streams.hostCount() - 1) return false;

        this.hostIndex++;
        const uri = this._uri();
        console.log(`SomaFM: stream failed, retrying with ${uri}`);

        this.playbin.set_state(Gst.State.NULL);
        this.playbin.set_property("uri", uri);
        this.playbin.set_state(Gst.State.PLAYING);
        return true;
    }

    setVolume(value) {
        //this.playbin.set_volume(GstAudio.StreamVolumeFormat.LINEAR, value);
        this.playbin.volume = value;
    }

    isPlaying() {
        return this.playing;
    }

    getTag() {
        return this.tag;
    }

    _onMessageReceived(msg) {
        switch (msg.type) {
            case Gst.MessageType.TAG:
                let tagList = msg.parse_tag();
                let tmp = tagList.get_string("title");
                let tag = tmp[1];
                this.tag = tag;
                if (this.onTagChanged != null) this.onTagChanged();
                break;

            case Gst.MessageType.STREAM_START:
                // Reached a working node; start from the top of the ring on
                // the next failure.
                this.hostIndex = 0;
                if (this.onTagChanged != null) this.onTagChanged();
                break;

            // Both should do the same thing
            case Gst.MessageType.EOS:
            case Gst.MessageType.ERROR:
                if (this._retryNextHost()) break;
                this.stop();
                if (this.onError != null) this.onError();
                break;
            default:
                break;
        }
    }
};
