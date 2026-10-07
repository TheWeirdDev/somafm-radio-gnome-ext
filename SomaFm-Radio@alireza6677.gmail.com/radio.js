// GStreamer is deliberately not imported here: it runs in player-helper.js, a
// separate process. Initialising it inside gnome-shell can deadlock the
// compositor at login -- see the comment at the top of that file.
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Channels from "./channels.js";
import * as Streams from "./streams.js";

const DEFAULT_VOLUME = 0.5;
const HELPER_FILE = "player-helper.js";

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


// Drives the GStreamer worker (player-helper.js) and keeps everything that
// concerns streams -- host retry, quality fallback -- on this side. The worker
// is started on the first play(), not before, so that merely enabling the
// extension at login does not touch GStreamer at all.
export const RadioPlayer = class RadioPlayer {
    constructor(channel, quality, extPath) {
        this.helperPath = GLib.build_filenamev([extPath, HELPER_FILE]);

        // Whether GStreamer can play HLS is only known once the worker is up
        // (see _onReady), so assume it can; playbin3 is nearly universal.
        this.hlsAvailable = true;

        this.channel = channel;
        this.quality = Streams.coerceQuality(
            channel.getId(),
            quality,
            this.hlsAvailable,
        );
        // Index into the Icecast host ring; advanced by _retryNextHost().
        this.hostIndex = 0;

        this.volume = DEFAULT_VOLUME;
        this.muted = false;
        this.tag = "Soma FM";
        this.playing = false;

        // Bumped by every play and stop. The worker echoes it back, which lets
        // _onEvent() drop events of a stream that has since been replaced.
        this.gen = 0;

        this.helper = null;
        this.helperIn = null;
        this.helperCancellable = null;
        this.outQueue = [];
        this.writing = false;
        this.failId = 0;

        this.onError = null;
        this.onTagChanged = null;
        this.onQualityFallback = null;
        this.onCapabilities = null;
    }

    // Kills the worker. disable() used to leave the bus watch and its handler
    // alive; they leaked across every disable/enable cycle.
    destroy() {
        this.onError = null;
        this.onTagChanged = null;
        this.onQualityFallback = null;
        this.onCapabilities = null;

        if (this.failId !== 0) {
            GLib.source_remove(this.failId);
            this.failId = 0;
        }

        const helper = this.helper;
        this._dropHelper();
        helper?.force_exit();
        this.playing = false;
    }

    // Starts the worker unless it is running. Returns false if it cannot be
    // started, in which case the error has already been scheduled.
    _startHelper() {
        if (this.helper != null) return true;

        let helper;
        try {
            helper = Gio.Subprocess.new(
                ["gjs", "-m", this.helperPath],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
            );
        } catch (e) {
            console.error(`SomaFM: cannot start the player helper: ${e}`);
            // Not reported synchronously: the play button is still halfway
            // through its own click handler.
            this.failId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.failId = 0;
                this.playing = false;
                this.onError?.();
                return GLib.SOURCE_REMOVE;
            });
            return false;
        }

        this.helper = helper;
        this.helperIn = helper.get_stdin_pipe();
        this.helperCancellable = new Gio.Cancellable();
        this.outQueue = [];
        this.writing = false;

        this._readEvents(
            helper,
            new Gio.DataInputStream({ base_stream: helper.get_stdout_pipe() }),
        );
        helper.wait_async(this.helperCancellable, () =>
            this._onHelperExit(helper),
        );

        // The worker starts from scratch, so hand it the current settings.
        this._send({ cmd: "volume", value: this.volume });
        this._send({ cmd: "mute", value: this.muted });
        return true;
    }

    _dropHelper() {
        this.helperCancellable?.cancel();
        this.helper = null;
        this.helperIn = null;
        this.helperCancellable = null;
        this.outQueue = [];
        this.writing = false;
    }

    // The worker died on its own, e.g. a codec crashed. That is exactly what
    // running it out of process is for: the shell carries on, and the next
    // play() starts a fresh worker.
    _onHelperExit(helper) {
        if (this.helper !== helper) return;

        const how = helper.get_if_exited()
            ? `status ${helper.get_exit_status()}`
            : `signal ${helper.get_term_sig()}`;
        console.warn(`SomaFM: player helper exited (${how})`);

        const wasPlaying = this.playing;
        this._dropHelper();
        this.playing = false;
        this.tag = "Soma FM";
        if (wasPlaying) this.onError?.();
    }

    _readEvents(helper, stream) {
        stream.read_line_async(
            GLib.PRIORITY_DEFAULT,
            this.helperCancellable,
            (self, res) => {
                let line = null;
                try {
                    [line] = self.read_line_finish_utf8(res);
                } catch (e) {
                    // Cancelled by destroy(), or the pipe broke; either way
                    // _onHelperExit() takes it from here.
                    return;
                }
                if (line == null || this.helper !== helper) return;

                this._onEvent(line);
                this._readEvents(helper, stream);
            },
        );
    }

    // One write in flight at a time: a second write_bytes_async() on a busy
    // stream fails with PENDING. Messages are short lines, far below PIPE_BUF,
    // so a write is never split. Nothing here may block the shell, even when
    // the worker is stuck.
    _send(message) {
        if (this.helper == null) return;

        const line = `${JSON.stringify(message)}\n`;
        // Volume changes arrive in bursts while the slider is dragged, and only
        // the last one matters.
        if (message.cmd === "volume" || message.cmd === "mute")
            this.outQueue = this.outQueue.filter(
                (queued) => !queued.startsWith(`{"cmd":"${message.cmd}"`),
            );
        this.outQueue.push(line);
        this._pump();
    }

    _pump() {
        if (this.writing || this.helperIn == null || this.outQueue.length === 0)
            return;

        this.writing = true;
        const helper = this.helper;
        const bytes = new GLib.Bytes(new TextEncoder().encode(this.outQueue.shift()));
        this.helperIn.write_bytes_async(
            bytes,
            GLib.PRIORITY_DEFAULT,
            this.helperCancellable,
            (self, res) => {
                let written;
                try {
                    written = self.write_bytes_finish(res);
                } catch (e) {
                    // The worker is gone; _onHelperExit() reports it.
                    return;
                }
                if (this.helper !== helper) return;

                // A short write would leave half a line in the pipe.
                if (written < bytes.get_size())
                    this.outQueue.unshift(
                        new TextDecoder().decode(bytes.toArray().slice(written)),
                    );
                this.writing = false;
                this._pump();
            },
        );
    }

    _onEvent(line) {
        let event;
        try {
            event = JSON.parse(line);
        } catch (e) {
            console.warn(`SomaFM: unreadable player helper output: ${line}`);
            return;
        }

        if (event.ev === "ready") {
            this._onReady(event);
            return;
        }
        // From a stream that has been stopped or replaced since.
        if (event.gen !== this.gen) return;

        switch (event.ev) {
            case "tag":
                this.tag = event.title;
                if (this.onTagChanged != null) this.onTagChanged();
                break;

            case "started":
                // Reached a working node; start from the top of the ring on
                // the next failure.
                this.hostIndex = 0;
                if (this.onTagChanged != null) this.onTagChanged();
                break;

            case "error":
                // A 404 means this tier does not exist on this channel, so
                // every node will answer the same: step down instead of
                // walking the ring. Any other failure (dead node, no network)
                // is per-host, and stepping down would not help.
                if (event.notFound) {
                    if (this._degradeQuality("404")) break;
                } else if (this._retryNextHost()) {
                    break;
                }
                this.stop();
                if (this.onError != null) this.onError();
                break;

            case "eos":
                if (this._retryNextHost()) break;
                this.stop();
                if (this.onError != null) this.onError();
                break;

            default:
                break;
        }
    }

    // The worker reports whether its GStreamer has playbin3, the only playbin
    // that can play HLS.
    _onReady(event) {
        if (event.hls || !this.hlsAvailable) return;

        this.hlsAvailable = false;
        console.warn("SomaFM: playbin3 unavailable, HLS tiers disabled");

        const from = this.quality;
        const to = Streams.coerceQuality(this.channel.getId(), from, false);
        if (to !== from) {
            this.quality = to;
            this.hostIndex = 0;
            if (this.playing) this._playUri(this._uri());
            if (this.onQualityFallback != null) this.onQualityFallback(from, to);
        }
        if (this.onCapabilities != null) this.onCapabilities();
    }

    _playUri(uri) {
        this.gen++;
        this._send({ cmd: "play", uri, gen: this.gen });
    }

    play() {
        this.playing = true;
        if (this._startHelper()) this._playUri(this._uri());
    }

    setOnError(onError) {
        this.onError = onError;
    }

    setOnTagChanged(onTagChanged) {
        this.onTagChanged = onTagChanged;
    }

    // Called as onQualityFallback(from, to) when a tier turns out to be
    // unplayable and the player steps down on its own.
    setOnQualityFallback(onQualityFallback) {
        this.onQualityFallback = onQualityFallback;
    }

    // Called when what the player can play changes, i.e. the tiers on offer
    // have to be listed again.
    setOnCapabilities(onCapabilities) {
        this.onCapabilities = onCapabilities;
    }

    setMute(mute) {
        this.muted = mute;
        this._send({ cmd: "mute", value: mute });
    }

    stop() {
        this.playing = false;
        this.tag = "Soma FM";

        if (this.helper != null) {
            this.gen++;
            this._send({ cmd: "stop", gen: this.gen });
        }
    }

    next() {
        this.setChannel(Channels.neighbour(this.channel.getId(), 1));
    }

    prev() {
        this.setChannel(Channels.neighbour(this.channel.getId(), -1));
    }

    // Only resumes if something was already playing, like setQuality(): both
    // call sites stop() first and play() afterwards, and a channel restored at
    // startup must not start the radio by itself.
    setChannel(ch) {
        const wasPlaying = this.playing;
        this.channel = ch;
        // Channels serve different bitrates and the HLS tiers exist for one
        // channel only, so the selected quality may not be available here.
        // coerceQuality() degrades it instead of building a URL that would 404.
        this.quality = Streams.coerceQuality(
            ch.getId(),
            this.quality,
            this.hlsAvailable,
        );
        this.hostIndex = 0;
        this.stop();
        if (wasPlaying) this.play();
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

        this._playUri(uri);
        return true;
    }

    // The menu only offers tiers channels.json advertises, but one can still
    // 404: the cached list may be stale, or it may not have been fetched yet
    // and the assumed tiers are wrong for this channel. Stepping down one tier
    // keeps the radio playing instead of dead-ending on "--- Error ---".
    _degradeQuality(reason) {
        if (!this.playing) return false;

        const from = this.quality;
        const to = Streams.lowerQuality(
            this.channel.getId(),
            from,
            this.hlsAvailable,
        );
        if (to == null || to === from) return false;

        const id = this.channel.getId();
        console.warn(
            `SomaFM: ${Streams.labelFor(id, from)} unavailable on ${id} ` +
                `(${reason}), falling back to ${Streams.labelFor(id, to)}`,
        );

        this.quality = to;
        this.hostIndex = 0;
        this._playUri(this._uri());

        if (this.onQualityFallback != null) this.onQualityFallback(from, to);
        return true;
    }

    setVolume(value) {
        this.volume = value;
        this._send({ cmd: "volume", value });
    }

    isPlaying() {
        return this.playing;
    }

    getTag() {
        return this.tag;
    }
};
