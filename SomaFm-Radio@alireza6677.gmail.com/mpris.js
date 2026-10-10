// Publishes the radio as an MPRIS player. GNOME routes the keyboard's media
// keys (play/pause, next, previous, stop) through gsd-media-keys to whichever
// MPRIS player is active; an extension cannot grab those keys itself. As a
// side effect the radio also shows up in the media controls of the shell's
// notification list.
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const BUS_NAME = "org.mpris.MediaPlayer2.SomaFM";
const OBJECT_PATH = "/org/mpris/MediaPlayer2";

const ROOT_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
</node>`;

const PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek">
      <arg direction="in" name="Offset" type="x"/>
    </method>
    <method name="SetPosition">
      <arg direction="in" name="TrackId" type="o"/>
      <arg direction="in" name="Position" type="x"/>
    </method>
    <method name="OpenUri">
      <arg direction="in" name="Uri" type="s"/>
    </method>
    <signal name="Seeked">
      <arg name="Position" type="x"/>
    </signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

// A live stream cannot be paused, so Pause stops it, as the panel's own button
// does. The buttons are the ones the popup shows: going through them keeps the
// popup's icon and spinner in step with the keys.
export const MprisPlayer = class MprisPlayer {
    constructor(player, controls) {
        this.player = player;
        this.controls = controls;
        this.status = null;
        this.metadataKey = null;

        this.root = Gio.DBusExportedObject.wrapJSObject(ROOT_IFACE, {
            Raise() {},
            Quit() {},
            CanQuit: false,
            CanRaise: false,
            HasTrackList: false,
            Identity: "SomaFM Radio",
            SupportedUriSchemes: [],
            SupportedMimeTypes: [],
        });

        const self = this;
        this.iface = Gio.DBusExportedObject.wrapJSObject(PLAYER_IFACE, {
            Next: () => this.controls.skip(1),
            Previous: () => this.controls.skip(-1),
            PlayPause: () => this.controls.toggle(),
            Play: () => {
                if (!this.controls.playing) this.controls.toggle();
            },
            Pause: () => this._stop(),
            Stop: () => this._stop(),
            Seek() {},
            SetPosition() {},
            OpenUri() {},
            get PlaybackStatus() {
                return self._status();
            },
            Rate: 1.0,
            get Metadata() {
                return self._metadata();
            },
            get Volume() {
                return self.player.volume;
            },
            Position: 0,
            MinimumRate: 1.0,
            MaximumRate: 1.0,
            CanGoNext: true,
            CanGoPrevious: true,
            CanPlay: true,
            CanPause: true,
            CanSeek: false,
            CanControl: true,
        });

        this.root.export(Gio.DBus.session, OBJECT_PATH);
        this.iface.export(Gio.DBus.session, OBJECT_PATH);
        this.ownerId = Gio.bus_own_name_on_connection(
            Gio.DBus.session,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            null,
            () => console.warn(`SomaFM: cannot own ${BUS_NAME}`),
        );

        this.update();
    }

    destroy() {
        if (this.ownerId !== 0) Gio.bus_unown_name(this.ownerId);
        this.ownerId = 0;
        this.iface.unexport();
        this.root.unexport();
    }

    _stop() {
        if (this.controls.playing) this.controls.toggle();
    }

    _status() {
        return this.player.isPlaying() ? "Playing" : "Stopped";
    }

    _metadata() {
        const ch = this.player.getChannel();
        const tag = this.player.getTag();
        const id = ch.getId().replace(/[^A-Za-z0-9_]/g, "_");

        const metadata = {
            "mpris:trackid": GLib.Variant.new_object_path(
                `/org/somafm/channel/${id}`,
            ),
            "xesam:title": GLib.Variant.new_string(
                tag != null && tag !== "Soma FM" ? tag : ch.getName(),
            ),
            "xesam:artist": GLib.Variant.new_strv([ch.getName()]),
            "xesam:album": GLib.Variant.new_string("SomaFM"),
        };

        const icon = ch.getGicon();
        if (icon instanceof Gio.FileIcon)
            metadata["mpris:artUrl"] = GLib.Variant.new_string(
                icon.get_file().get_uri(),
            );

        return metadata;
    }

    // Tells listeners what changed. Called on every player state change and
    // when a channel logo arrives; repeats are dropped here.
    update() {
        const status = this._status();
        if (status !== this.status) {
            this.status = status;
            this.iface.emit_property_changed(
                "PlaybackStatus",
                GLib.Variant.new_string(status),
            );
        }

        const metadata = new GLib.Variant("a{sv}", this._metadata());
        const key = metadata.print(false);
        if (key !== this.metadataKey) {
            this.metadataKey = key;
            this.iface.emit_property_changed("Metadata", metadata);
        }
    }
};
