// GStreamer worker for the panel extension. It runs as a separate gjs process:
// GStreamer must never be initialised inside gnome-shell.
//
// When the plugin registry is missing or stale (first boot after an upgrade,
// or any plugin change), gst_init() runs gst-plugin-scanner and waits for it,
// and on current GStreamer the scanner loads the Vulkan plugin, which connects
// to the X display. On a Wayland session mutter starts Xwayland on demand, on
// that first connection -- and only mutter's main loop can do it, which is the
// very loop that is blocked waiting for the scanner. The shell, and with it
// input and VT switching, then hangs for good at login. In a process of its own
// the same scan just takes a second or two. As a bonus a crashing codec can no
// longer take the whole session down with it.
//
// The protocol is one JSON object per line.
//
//   stdin  (shell -> helper)
//     {cmd: "play", uri, gen}   (re)start the pipeline on uri
//     {cmd: "stop", gen}
//     {cmd: "volume", value}    0..1, linear
//     {cmd: "mute", value}
//
//   stdout (helper -> shell)
//     {ev: "ready", hls}        once, after GStreamer is up
//     {ev: "tag", title, gen}   title is null when the tags carried none
//     {ev: "started", gen}
//     {ev: "error", notFound, message, debug, gen}
//     {ev: "eos", gen}
//
// `gen` is the shell's counter, copied from the latest play or stop. The shell
// drops events from a generation it has since stopped or replaced, such as the
// error a pipeline raises while it is being torn down.
//
// The helper quits when stdin closes, so it never outlives the shell.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gst from "gi://Gst?version=1.0";
import System from "system";

// Gio.Unix*Stream moved to GioUnix in GLib 2.80 and warns when used from Gio;
// older GLib has no GioUnix.
let Unix = Gio;
try {
    Unix = (await import("gi://GioUnix")).default;
} catch (e) {
    // Pre-2.80 GLib: the classes are still in Gio.
}

const CLIENT_NAME = "somafm-radio";

// HLS is demuxed by adaptivedemux2, which only works inside a streams-aware
// pipeline: with the classic "playbin" every HLS URL fails with "Element
// requires a streams-aware context". playbin3 plays both HLS and the plain
// Icecast streams, so prefer it and keep playbin purely as a fallback for
// GStreamer builds that lack it.
function makePlaybin() {
    const playbin3 = Gst.ElementFactory.make("playbin3", "somafm");
    if (playbin3 != null) return { element: playbin3, hls: true };

    printerr("SomaFM: playbin3 unavailable, HLS tiers disabled");
    return { element: Gst.ElementFactory.make("playbin", "somafm"), hls: false };
}

// A tier the channel does not serve answers 404 on every Icecast node, so the
// shell skips the host ring in that case. GStreamer reports it as
// GST_RESOURCE_ERROR_NOT_FOUND, but the mapping of the enum into GJS depends on
// the build, hence the string check as a backstop.
function isNotFound(err, debug) {
    try {
        if (err?.matches?.(Gst.ResourceError, Gst.ResourceError.NOT_FOUND))
            return true;
    } catch (e) {
        // Error domain not introspectable here; fall through to the text.
    }
    return /404|not found/i.test(`${err?.message ?? ""} ${debug ?? ""}`);
}

Gst.init([]);

const { element: playbin, hls } = makePlaybin();
if (playbin == null) {
    printerr("SomaFM: GStreamer's playbin is not installed");
    System.exit(1);
}

const sink = Gst.ElementFactory.make("pulsesink", "sink");
if (sink != null) {
    sink.set_property("client-name", CLIENT_NAME);
    playbin.set_property("audio-sink", sink);
}

const loop = new GLib.MainLoop(null, false);
const input = new Gio.DataInputStream({
    base_stream: Unix.InputStream.new(0, false),
});
const output = new Gio.DataOutputStream({
    base_stream: Unix.OutputStream.new(1, false),
});

let gen = 0;

function quit() {
    playbin.set_state(Gst.State.NULL);
    loop.quit();
}

function send(event) {
    try {
        output.put_string(`${JSON.stringify(event)}\n`, null);
        output.flush(null);
    } catch (e) {
        // The shell is gone.
        quit();
    }
}

function onMessage(msg) {
    switch (msg.type) {
        case Gst.MessageType.TAG: {
            const [found, title] = msg.parse_tag().get_string("title");
            send({ ev: "tag", title: found ? title : null, gen });
            break;
        }
        case Gst.MessageType.STREAM_START:
            send({ ev: "started", gen });
            break;
        case Gst.MessageType.ERROR: {
            const [err, debug] = msg.parse_error();
            send({
                ev: "error",
                notFound: isNotFound(err, debug),
                message: err?.message ?? "",
                debug: debug ?? "",
                gen,
            });
            break;
        }
        case Gst.MessageType.EOS:
            send({ ev: "eos", gen });
            break;
        default:
            break;
    }
}

function onCommand(cmd) {
    switch (cmd.cmd) {
        case "play":
            gen = cmd.gen;
            playbin.set_state(Gst.State.NULL);
            playbin.set_property("uri", cmd.uri);
            playbin.set_state(Gst.State.PLAYING);
            break;
        case "stop":
            gen = cmd.gen;
            playbin.set_state(Gst.State.NULL);
            break;
        case "volume":
            playbin.volume = cmd.value;
            break;
        case "mute":
            playbin.set_property("mute", cmd.value);
            break;
        default:
            printerr(`SomaFM: unknown player command ${cmd.cmd}`);
            break;
    }
}

function readNext() {
    input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
        let line = null;
        try {
            [line] = stream.read_line_finish_utf8(res);
        } catch (e) {
            line = null;
        }

        // EOF: the shell closed our stdin, or died.
        if (line === null) {
            quit();
            return;
        }

        try {
            onCommand(JSON.parse(line));
        } catch (e) {
            printerr(`SomaFM: bad player command: ${e}`);
        }
        readNext();
    });
}

const bus = playbin.get_bus();
bus.add_signal_watch();
bus.connect("message", (_bus, msg) => {
    if (msg != null) onMessage(msg);
});

send({ ev: "ready", hls });
readNext();
loop.run();
