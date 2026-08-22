import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Data from "./data.js";
import * as Api from "./somafm-api.js";
import * as Streams from "./streams.js";
import { extPath } from "./extension.js";

const FALLBACK_ICON = "audio-x-generic-symbolic";

// SomaFM tags each channel with one or more genres, pipe-separated in
// channels.json ("bossanova|world"). The bundled fallback list carries none, so
// the genre menu stays empty until the live list arrives.
function parseGenres(raw) {
    if (typeof raw !== "string") return [];

    return [
        ...new Set(
            raw
                .split(/[|,]/)
                .map((g) => g.trim().toLowerCase())
                .filter((g) => g !== ""),
        ),
    ];
}

// Set by enable() and cancelled on disable(), so in-flight artwork downloads
// do not outlive the extension.
let cancellable = null;

export function setCancellable(c) {
    cancellable = c;
}


const BUNDLED_CHANNELS = [
    { id: "groovesalad", name: "Groove Salad", pic: "/images/groovesalad.png" },
    { id: "secretagent", name: "Secret Agent", pic: "/images/secretagent.jpg" },
    { id: "lush", name: "Lush", pic: "/images/lush-x.jpg" },
    { id: "fluid", name: "Fluid", pic: "/images/fluid.jpg" },
    { id: "deepspaceone", name: "Deep Space One", pic: "/images/deepspaceone.gif" },
    { id: "dronezone", name: "Drone Zone", pic: "/images/dronezone.jpg" },
    { id: "spacestation", name: "Space Station Soma", pic: "/images/sss.jpg" },
    { id: "defcon", name: "DEF CON Radio", pic: "/images/defcon.png" },
    { id: "sonicuniverse", name: "Sonic Universe", pic: "/images/sonicuniverse.jpg" },
    { id: "suburbsofgoa", name: "Suburbs of Goa", pic: "/images/sog.jpg" },
    { id: "beatblender", name: "Beat Blender", pic: "/images/blender.png" },
    { id: "thetrip", name: "The Trip", pic: "/images/thetrip.jpg" },
    { id: "illstreet", name: "Illinois Street Lounge", pic: "/images/illstreet.jpg" },
    { id: "7soul", name: "Seven Inch Soul", pic: "/images/7soul.png" },
    { id: "seventies", name: "Left Coast 70s", pic: "/images/seventies.jpg" },
    { id: "u80s", name: "Underground 80s", pic: "/images/u80s-.png" },
    { id: "bootliquor", name: "Boot Liquor", pic: "/images/bootliquor.jpg" },
    { id: "digitalis", name: "Digitalis", pic: "/images/digitalis.png" },
    { id: "thistle", name: "ThistleRadio", pic: "/images/thistle.png" },
    { id: "folkfwd", name: "Folk Forward", pic: "/images/folkfwd.jpg" },
    { id: "cliqhop", name: "cliqhop idm", pic: "/images/cliqhop.png" },
    { id: "poptron", name: "PopTron", pic: "/images/poptron.png" },
    { id: "indiepop", name: "Indie Pop Rocks!", pic: "/images/indychick.jpg" },
    { id: "bagel", name: "BAGeL Radio", pic: "/images/bagel.png" },
    { id: "metal", name: "Metal Detector", pic: "/images/metal.png" },
    { id: "covers", name: "Covers", pic: "/images/covers.jpg" },
    { id: "doomed", name: "Doomed", pic: "/images/doomed.png" },
    { id: "dubstep", name: "Dub Step Beyond", pic: "/images/dubstep.png" },
    { id: "brfm", name: "Black Rock FM", pic: "/images/1023brc.jpg" },
    { id: "missioncontrol", name: "Mission Control", pic: "/images/missioncontrol.jpg" },
    { id: "sf1033", name: "SF 10-33", pic: "/images/sf1033.png" },
    { id: "gsclassic", name: "Groove Salad Classic", pic: "/images/gsclassic400.jpg" },
    { id: "vaporwaves", name: "Vaporwaves", pic: "/images/vaporwaves400.png" },
    { id: "reggae", name: "Heavyweight Reggae", pic: "/images/reggae400.png" },
];


const BUNDLED_HOLIDAY = [
    { id: "n5md", name: "n5MD Radio", pic: "/images/n5md120.png" },
    { id: "deptstore", name: "Department Store Christmas", pic: "/images/deptstore120.jpg" },
    { id: "christmas", name: "Christmas Lounge", pic: "/images/christmas120.png" },
    { id: "xmasrocks", name: "Christmas Rocks!", pic: "/images/xmasrocks120.png" },
    { id: "xmasinfrisko", name: "Xmas in Frisko", pic: "/images/xmasinfrisko120.jpg" },
    { id: "jollysoul", name: "Jolly Ol' Soul", pic: "/images/jollysoul120.png" },
];

// Artwork that ships with the extension, so the common channels render
// instantly and offline. Channels only present in the live list fall back to
// the downloaded-and-cached logo from the API.
const BUNDLED_ART = new Map(
    [...BUNDLED_CHANNELS, ...BUNDLED_HOLIDAY].map((c) => [c.id, c.pic]),
);

// Holiday channels are seasonal upstream, so the bundled fallback list hides
// them outside December. The live list needs no such rule: SomaFM adds and
// removes them itself.
function bundledList() {
    const isDecember = new Date().getMonth() === 11;
    return isDecember
        ? [...BUNDLED_CHANNELS, ...BUNDLED_HOLIDAY]
        : [...BUNDLED_CHANNELS];
}

// Plain descriptors ({id, name, art?}) for the channels currently on offer,
// and the Channel objects built from them. Both are cached: getChannels() used
// to rebuild every Channel on every call, and isFav() re-read prefs from disk
// for each one.
let descriptors = null;
let built = null;

function ensureDescriptors() {
    if (descriptors != null) return descriptors;

    const cached = Api.readCache();
    descriptors = cached != null ? cached.channels : bundledList();
    // The bundled list carries no `qualities`, so streams.js keeps assuming
    // the usual four tiers until a fetch lands.
    Streams.registerQualities(descriptors);
    return descriptors;
}

// Called when the live fetch lands. Returns true if the list actually changed,
// so the caller can skip rebuilding menus for an identical list.
export function setChannelList(list) {
    if (!Array.isArray(list) || list.length === 0) return false;

    // Tier availability is refreshed even when the list itself is unchanged:
    // SomaFM can add a bitrate to a channel without adding channels.
    Streams.registerQualities(list);

    const same =
        descriptors != null &&
        descriptors.length === list.length &&
        descriptors.every((d, i) => d.id === list[i].id);
    if (same) return false;

    descriptors = list;
    built = null;
    return true;
}

// Drops the built Channel objects (not the descriptors) so favorite stars are
// re-read on the next build.
export function invalidate() {
    built = null;
}

export function reset() {
    descriptors = null;
    built = null;
    Streams.resetQualities();
}

export const Channel = class Channel {
    constructor(id, name, art, fav, genres) {
        this.id = id;
        this.name = name;
        this.art = art ?? null;
        this.fav = fav;
        this.genres = genres ?? [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    isFav() {
        return this.fav;
    }

    getGenres() {
        return this.genres;
    }

    hasGenre(tag) {
        return this.genres.includes(tag);
    }

    setFav(f) {
        this.fav = f;
    }

    // Bundled artwork first, then a previously downloaded logo, then a
    // symbolic placeholder while (or instead of) the download happens.
    getGicon() {
        const bundled = BUNDLED_ART.get(this.id);
        if (bundled != null) return Gio.icon_new_for_string(extPath + bundled);

        if (Api.hasArt(this.id))
            return Gio.icon_new_for_string(Api.artPath(this.id));

        return new Gio.ThemedIcon({ name: FALLBACK_ICON });
    }

    // Fetches this channel's logo if it isn't available yet, then calls
    // onReady() so the caller can refresh whatever is showing the icon.
    ensureArt(onReady) {
        if (BUNDLED_ART.has(this.id) || Api.hasArt(this.id) || this.art == null)
            return;

        Api.fetchArt(this.id, this.art, cancellable, (path) => {
            if (path != null) onReady();
        });
    }
};

function buildAll() {
    if (built != null) return built;

    const favs = Data.getFavs();
    built = ensureDescriptors().map(
        (c) =>
            new Channel(
                c.id,
                c.name,
                c.art,
                favs.includes(c.id),
                parseGenres(c.genre),
            ),
    );
    return built;
}

export function getChannels() {
    return buildAll();
}

// Every genre in the current list with its channel count, alphabetical. A
// channel with several tags is counted under each of them.
export function getGenres() {
    const counts = new Map();
    for (const ch of buildAll())
        for (const g of ch.getGenres()) counts.set(g, (counts.get(g) ?? 0) + 1);

    return [...counts]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
}

// An empty tag means "all genres", which is also the fallback for a tag SomaFM
// has stopped using.
export function getChannelsByGenre(tag) {
    if (tag == null || tag === "") return buildAll();
    return buildAll().filter((ch) => ch.hasGenre(tag));
}

export function getFavChannels() {
    return buildAll().filter((ch) => ch.isFav());
}

export function getChannelById(id) {
    const all = buildAll();
    return all.find((ch) => ch.getId() === id) ?? all[0];
}

// Channel after (offset +1) or before (-1) the given one, wrapping around.
// Replaces the old index arithmetic in radio.js, which assumed a fixed list.
export function neighbour(id, offset) {
    const all = buildAll();
    const at = all.findIndex((ch) => ch.getId() === id);
    const next = (at + offset + all.length) % all.length;
    return all[next];
}

export const ChannelBox = GObject.registerClass(
    class ChannelBox extends PopupMenu.PopupBaseMenuItem {
        _init(channel, player, popup) {
            super._init({
                reactive: true,
                can_focus: true,
            });
            this.player = player;
            this.channel = channel;
            this.popup = popup;

            this.vbox = new St.BoxLayout({ vertical: false });
            this.add_child(this.vbox);

            let icon2 = new St.Icon({
                gicon: channel.getGicon(),
                style: "margin-right:10px",
                icon_size: 60,
            });

            let box2 = new St.BoxLayout({ vertical: false });
            let label1 = new St.Label({
                text: channel.getName(),
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            });
            this.vbox.add_child(icon2);
            this.vbox.add_child(box2);
            box2.add_child(label1);

            channel.ensureArt(() => icon2.set_gicon(channel.getGicon()));
        }

        activate(ev) {
            this.player.stop();
            this.player.setChannel(this.channel);
            this.player.play();
            this.popup.channelChanged();
        }
    },
);
