// Live channel list from somafm.com/channels.json, plus artwork, both cached
// on disk. Every fetch is async and cancellable: enable() must never block the
// shell on the network, so callers render from cache first and swap in the
// fresh list when it arrives.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import * as Streams from "./streams.js";

const CHANNELS_URL = "https://somafm.com/channels.json";
const CACHE_FILE = "channels-cache.json";
const ART_DIR = "art";
const DIR_NAME = ".somafm-radio";
const CACHE_TTL = 24 * 60 * 60; // seconds
// Bumped when the cached shape changes, so an old cache is refetched instead of
// read back missing fields. v2 added per-channel stream qualities.
const CACHE_VERSION = 2;
const USER_AGENT = "somafm-radio-gnome-ext";

let session = null;
// Channel ids whose logo is known to be on disk. Built up as artwork is looked
// up or downloaded, so getGicon() never has to stat a file while the menus are
// being built.
const artOnDisk = new Set();

function getSession() {
    if (session == null) {
        session = new Soup.Session({ user_agent: USER_AGENT, timeout: 15 });
    }
    return session;
}

export function shutdown() {
    if (session != null) {
        session.abort();
        session = null;
    }
    artOnDisk.clear();
}

function cacheDir() {
    return GLib.build_filenamev([GLib.get_home_dir(), DIR_NAME]);
}

function artDir() {
    return GLib.build_filenamev([cacheDir(), ART_DIR]);
}

// make_directory_with_parents() has no async form, so the two levels this
// extension needs are created one at a time. An existing directory is the
// normal case, not an error.
function makeDir(path, onDone) {
    Gio.file_new_for_path(path).make_directory_async(
        GLib.PRIORITY_DEFAULT,
        null,
        (dir, res) => {
            try {
                dir.make_directory_finish(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    console.error(`SomaFM: cannot create ${path}: ${e}`);
            }
            onDone();
        },
    );
}

function ensureArtDir(onDone) {
    makeDir(cacheDir(), () => makeDir(artDir(), onDone));
}

// One channel from the API, reduced to what the UI needs. `pic` is left null:
// channels.js decides between bundled artwork and the disk cache.
function normalize(raw) {
    if (typeof raw?.id !== "string" || raw.id === "") return null;
    if (!Array.isArray(raw.playlists) || raw.playlists.length === 0) return null;

    // Which bitrates this channel actually serves. Kept in the cache so the
    // Quality menu is right offline too.
    const qualities = Streams.qualitiesFromPlaylists(raw.id, raw.playlists);
    if (qualities.length === 0) return null;

    return {
        id: raw.id,
        name: typeof raw.title === "string" && raw.title !== "" ? raw.title : raw.id,
        art: raw.largeimage ?? raw.image ?? raw.xlimage ?? null,
        genre: raw.genre ?? "",
        description: raw.description ?? "",
        qualities,
    };
}

function parseChannels(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.channels)) throw new Error("no channels array");

    const channels = parsed.channels
        .map(normalize)
        .filter((c) => c != null)
        .sort((a, b) => a.name.localeCompare(b.name));

    if (channels.length === 0) throw new Error("channel list empty");
    return channels;
}

function parseCache(bytes) {
    const cached = JSON.parse(new TextDecoder().decode(bytes));
    if (cached?.version !== CACHE_VERSION) return null;
    if (!Array.isArray(cached.channels) || cached.channels.length === 0)
        return null;

    return {
        fetchedAt: Number(cached.fetchedAt) || 0,
        channels: cached.channels,
    };
}

// onDone(cache | null). Reading the cache off the disk must not block the
// shell, so callers render the bundled list first and swap this in when it
// arrives -- the same way they already handle the live list.
export function readCache(cancellable, onDone) {
    const path = GLib.build_filenamev([cacheDir(), CACHE_FILE]);

    Gio.file_new_for_path(path).load_contents_async(cancellable, (self, res) => {
        let cache = null;
        try {
            const [ok, bytes] = self.load_contents_finish(res);
            if (ok) cache = parseCache(bytes);
        } catch (e) {
            // A missing cache is the normal first-run case, not an error.
            if (
                !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
                !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
            )
                console.error(`SomaFM: cannot read channel cache: ${e}`);
            cache = null;
        }
        onDone(cache);
    });
}

export function isFresh(cache) {
    if (cache == null) return false;
    const age = GLib.DateTime.new_now_utc().to_unix() - cache.fetchedAt;
    return age >= 0 && age < CACHE_TTL;
}

function writeCache(channels) {
    const path = GLib.build_filenamev([cacheDir(), CACHE_FILE]);
    const payload = JSON.stringify({
        version: CACHE_VERSION,
        fetchedAt: GLib.DateTime.new_now_utc().to_unix(),
        channels,
    });
    makeDir(cacheDir(), () =>
        Gio.file_new_for_path(path).replace_contents_async(
            new TextEncoder().encode(payload),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (self, res) => {
                try {
                    self.replace_contents_finish(res);
                } catch (e) {
                    console.error(`SomaFM: cannot write channel cache: ${e}`);
                }
            },
        ),
    );
}

// onDone(channels | null). Never throws; a failed fetch just reports null and
// the caller keeps whatever list it already has.
export function fetchChannels(cancellable, onDone) {
    const msg = Soup.Message.new("GET", CHANNELS_URL);

    getSession().send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (self, res) => {
            let channels = null;
            try {
                const bytes = self.send_and_read_finish(res);
                const status = msg.get_status();
                if (status !== Soup.Status.OK)
                    throw new Error(`HTTP ${status}`);

                channels = parseChannels(
                    new TextDecoder().decode(bytes.get_data()),
                );
                writeCache(channels);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`SomaFM: channel list fetch failed: ${e}`);
                channels = null;
            }
            onDone(channels);
        },
    );
}

export function artPath(id) {
    return GLib.build_filenamev([artDir(), `${id}.img`]);
}

// Answered from memory: whether a previous lookup or download put this
// channel's logo on disk. False just means "not known yet", and fetchArt()
// settles it without blocking.
export function isArtCached(id) {
    return artOnDisk.has(id);
}

// Downloads artwork once and caches it. onDone(path | null). Anything already
// on disk is reported without a download; the check itself is async, so a menu
// build never waits on it.
export function fetchArt(id, url, cancellable, onDone) {
    if (typeof url !== "string" || url === "") {
        onDone(null);
        return;
    }
    if (artOnDisk.has(id)) {
        onDone(artPath(id));
        return;
    }

    Gio.file_new_for_path(artPath(id)).query_info_async(
        Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_LOW,
        cancellable,
        (file, res) => {
            try {
                file.query_info_finish(res);
                artOnDisk.add(id);
                onDone(artPath(id));
                return;
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    onDone(null);
                    return;
                }
            }
            ensureArtDir(() => downloadArt(id, url, cancellable, onDone));
        },
    );
}

function downloadArt(id, url, cancellable, onDone) {
    const msg = Soup.Message.new("GET", url);
    getSession().send_and_read_async(
        msg,
        GLib.PRIORITY_LOW,
        cancellable,
        (self, res) => {
            try {
                const bytes = self.send_and_read_finish(res);
                if (msg.get_status() !== Soup.Status.OK)
                    throw new Error(`HTTP ${msg.get_status()}`);

                const data = bytes.get_data();
                if (data == null || data.length === 0)
                    throw new Error("empty body");

                Gio.file_new_for_path(artPath(id)).replace_contents_async(
                    data,
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                    (file, r) => {
                        try {
                            file.replace_contents_finish(r);
                            artOnDisk.add(id);
                            onDone(artPath(id));
                        } catch (e2) {
                            console.error(
                                `SomaFM: cannot cache artwork for ${id}: ${e2}`,
                            );
                            onDone(null);
                        }
                    },
                );
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`SomaFM: artwork fetch failed for ${id}: ${e}`);
                onDone(null);
            }
        },
    );
}
