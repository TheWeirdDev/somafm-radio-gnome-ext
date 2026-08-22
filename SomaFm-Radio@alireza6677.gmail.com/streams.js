// Stream URL resolution. Nothing else in the extension builds stream URLs.
//
// The tiers a channel actually serves are not the same everywhere: most top out
// at 128k MP3, some at 256k or 320k, and one serves 80k AAC+ where the rest
// serve 64k. Asking for a tier a channel does not have returns 404 from every
// Icecast node, so the tier list comes from the "playlists" array of
// https://somafm.com/channels.json (see qualitiesFromPlaylists) rather than
// from a fixed table.
//
// A handful of experimental HLS renditions exist too, but only for Groove
// Salad -- see HLS_EXTRAS below.

const ICE_HOSTS = ["ice2", "ice5", "ice6", "ice3"];
const HLS_BASE = "https://hls.somafm.com/hls";

// Every channel serves 128k AAC, so this is always a safe landing point.
export const DEFAULT_QUALITY = "aac-128";

// Offered until the live channel list lands (first run, or offline with no
// cache): the four tiers the extension assumed before availability was known.
// On a channel that lacks one of them playback degrades at the first error.
const ASSUMED_TIERS = ["mp3-256", "aac-128", "aac-64", "aac-32"];

// channels.json advertises a playlist per tier, and the bitrate is in the file
// name: groovesalad256.pls is the 256k MP3 stream, groovesalad130.pls the 128k
// AAC one, and a bare groovesalad.pls the plain 128k MP3 stream.
const PLS_BITRATES = new Map([
    ["", 128],
    ["130", 128],
]);

// Tier ids are `<codec>-<kbps>`; they are stored in prefs.json, so the spelling
// has to stay stable.
function parseTierId(qualityId) {
    const m = /^(mp3|aac)-(\d+)$/.exec(qualityId ?? "");
    return m == null ? null : { codec: m[1], kbps: Number(m[2]) };
}

// Best first: higher bitrate wins, and MP3 comes before AAC at equal bitrate,
// which is the order channels.json itself lists them in.
function compareTiers(a, b) {
    const pa = parseTierId(a);
    const pb = parseTierId(b);
    if (pa == null || pb == null) return 0;
    if (pa.kbps !== pb.kbps) return pb.kbps - pa.kbps;
    return (pa.codec === "mp3" ? 0 : 1) - (pb.codec === "mp3" ? 0 : 1);
}

// Label and Icecast path suffix are both derived from the id, so a bitrate
// SomaFM adds later needs no new table entry. SomaFM brands its low-bitrate
// AAC streams as AAC+ (HE-AAC).
export function tierFor(qualityId) {
    const p = parseTierId(qualityId);
    if (p == null) return null;

    const codec = p.codec === "mp3" ? "MP3" : p.kbps >= 128 ? "AAC" : "AAC+";
    return {
        id: qualityId,
        label: `${p.kbps}k ${codec}`,
        suffix: `-${p.kbps}-${p.codec}`,
    };
}

function bitrateFromPlaylistUrl(channelId, url) {
    if (typeof url !== "string") return null;

    const base = url.split("/").pop().replace(/\.(pls|m3u)$/, "");
    if (!base.startsWith(channelId)) return null;

    const digits = base.slice(channelId.length);
    if (PLS_BITRATES.has(digits)) return PLS_BITRATES.get(digits);
    return /^\d+$/.test(digits) ? Number(digits) : null;
}

function codecFromPlaylist(entry) {
    switch (entry?.format) {
        case "mp3":
            return "mp3";
        // "aac" is the 128k stream, "aacp" the HE-AAC ones below it.
        case "aac":
        case "aacp":
            return "aac";
        default:
            return null;
    }
}

// The tier ids one channels.json entry advertises, best first. Returns [] when
// the shape is unrecognised, which callers read as "availability unknown".
export function qualitiesFromPlaylists(channelId, playlists) {
    if (typeof channelId !== "string" || !Array.isArray(playlists)) return [];

    const ids = new Set();
    for (const entry of playlists) {
        const codec = codecFromPlaylist(entry);
        const kbps = bitrateFromPlaylistUrl(channelId, entry?.url);
        if (codec != null && kbps != null) ids.add(`${codec}-${kbps}`);
    }
    return [...ids].sort(compareTiers);
}

// channelId -> tier ids, populated from the live (or cached) channel list.
const availability = new Map();

export function registerQualities(descriptors) {
    if (!Array.isArray(descriptors)) return;

    for (const d of descriptors) {
        if (typeof d?.id !== "string" || !Array.isArray(d.qualities)) continue;

        const ids = d.qualities.filter((id) => parseTierId(id) != null);
        if (ids.length > 0) availability.set(d.id, ids.sort(compareTiers));
    }
}

export function resetQualities() {
    availability.clear();
}

// HLS is only available where listed. SomaFM calls it experimental and as of
// 2026-08 has published it for Groove Salad alone; probing the other 30+ slugs
// returns 404. Each entry names the Icecast tier to fall back to when the user
// switches to a channel that has no HLS.
export const HLS_EXTRAS = {
    groovesalad: [
        {
            id: "hls-flac",
            label: "FLAC lossless (beta)",
            url: `${HLS_BASE}/groovesalad/FLAC/program.m3u8`,
            fallback: "mp3-256",
        },
        {
            id: "hls-320",
            label: "320k AAC (beta)",
            url: `${HLS_BASE}/groovesalad/320k/program.m3u8`,
            fallback: "mp3-256",
        },
        {
            id: "hls-64",
            label: "64k AAC-HE (beta)",
            url: `${HLS_BASE}/groovesalad/64k/program.m3u8`,
            fallback: "aac-64",
        },
        {
            id: "hls-surround",
            label: "320k Surround (beta)",
            url: `${HLS_BASE}/gs-surround/program.m3u8`,
            fallback: "mp3-256",
        },
        {
            id: "hls-unproc",
            label: "FLAC unprocessed (beta)",
            url: `${HLS_BASE}/gs-unprocessed/FLAC/program.m3u8`,
            fallback: "mp3-256",
        },
    ],
};

export function isHls(qualityId) {
    return typeof qualityId === "string" && qualityId.startsWith("hls-");
}

export function hostCount() {
    return ICE_HOSTS.length;
}

// The HLS tiers available for a channel, or [] for the vast majority.
export function hlsTiersFor(channelId) {
    return HLS_EXTRAS[channelId] ?? [];
}

function iceIdsFor(channelId) {
    return availability.get(channelId) ?? ASSUMED_TIERS;
}

// The Icecast tiers this channel serves, best first.
export function iceTiersFor(channelId) {
    return iceIdsFor(channelId)
        .map(tierFor)
        .filter((t) => t != null);
}

// Every tier playable on this channel, in menu order.
export function tiersFor(channelId) {
    return [...iceTiersFor(channelId), ...hlsTiersFor(channelId)];
}

export function getTier(channelId, qualityId) {
    return tiersFor(channelId).find((t) => t.id === qualityId) ?? null;
}

export function labelFor(channelId, qualityId) {
    return (
        getTier(channelId, qualityId)?.label ??
        tierFor(qualityId)?.label ??
        qualityId
    );
}

// The Icecast tier an HLS entry degrades to, for channels without HLS or for
// GStreamer builds that cannot play it.
function hlsFallback(qualityId) {
    for (const tiers of Object.values(HLS_EXTRAS)) {
        const orphan = tiers.find((t) => t.id === qualityId);
        if (orphan != null) return orphan.fallback;
    }
    return null;
}

// The best tier this channel serves that is no better than the one asked for,
// or its lowest tier when even that is missing.
function degrade(channelId, qualityId) {
    const ids = iceIdsFor(channelId);
    if (ids.includes(qualityId)) return qualityId;

    if (parseTierId(qualityId) != null) {
        return (
            ids.find((id) => compareTiers(id, qualityId) >= 0) ??
            // Nothing this low here: take the channel's lowest.
            ids[ids.length - 1] ??
            DEFAULT_QUALITY
        );
    }
    // Not a tier id at all, e.g. hand-edited prefs.
    if (ids.includes(DEFAULT_QUALITY)) return DEFAULT_QUALITY;
    return ids[0] ?? DEFAULT_QUALITY;
}

// A quality the user picked on one channel may not exist on the next one, and
// HLS needs a streams-aware playbin that may be unavailable. Degrade instead of
// building a URL that cannot play.
export function coerceQuality(channelId, qualityId, allowHls = true) {
    if (isHls(qualityId)) {
        const playable =
            allowHls && hlsTiersFor(channelId).some((t) => t.id === qualityId);
        if (playable) return qualityId;

        return degrade(channelId, hlsFallback(qualityId) ?? DEFAULT_QUALITY);
    }
    return degrade(channelId, qualityId);
}

// One tier down, for when a stream that channels.json advertised still fails.
// Returns null at the bottom of the channel's list, where there is nothing
// left to try.
export function lowerQuality(channelId, qualityId, allowHls = true) {
    const current = coerceQuality(channelId, qualityId, allowHls);
    if (isHls(current)) return degrade(channelId, hlsFallback(current));

    const ids = iceIdsFor(channelId);
    const at = ids.indexOf(current);
    return at >= 0 && at + 1 < ids.length ? ids[at + 1] : null;
}

export function resolveUri(channelId, qualityId, hostIndex = 0) {
    const id = coerceQuality(channelId, qualityId);
    const tier = getTier(channelId, id);

    if (tier == null) {
        // coerceQuality guarantees a tier the channel serves, so this is
        // unreachable unless the channel has no tiers at all.
        console.error(`SomaFM: no tier for ${channelId}/${qualityId}`);
        return null;
    }
    if (tier.url != null) return tier.url;

    const host = ICE_HOSTS[hostIndex % ICE_HOSTS.length];
    return `https://${host}.somafm.com/${channelId}${tier.suffix}`;
}
