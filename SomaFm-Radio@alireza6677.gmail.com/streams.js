// Stream URL resolution. Nothing else in the extension builds stream URLs.
//
// SomaFM exposes every channel over Icecast at four bitrates (see
// https://somafm.com/channels.json). A handful of experimental HLS renditions
// exist too, but only for Groove Salad -- see HLS_EXTRAS below.

const ICE_HOSTS = ["ice2", "ice5", "ice6", "ice3"];
const HLS_BASE = "https://hls.somafm.com/hls";

// Order here is the order shown in the Quality menu.
export const QUALITY_TIERS = [
    { id: "mp3-256", label: "256k MP3", suffix: "-256-mp3" },
    { id: "aac-128", label: "128k AAC", suffix: "-128-aac" },
    { id: "aac-64", label: "64k AAC+", suffix: "-64-aac" },
    { id: "aac-32", label: "32k AAC+", suffix: "-32-aac" },
];

// Matches the stream the extension used before quality was selectable.
export const DEFAULT_QUALITY = "aac-128";

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

// Every tier playable on this channel, in menu order.
export function tiersFor(channelId) {
    return [...QUALITY_TIERS, ...hlsTiersFor(channelId)];
}

export function getTier(channelId, qualityId) {
    return tiersFor(channelId).find((t) => t.id === qualityId) ?? null;
}

export function labelFor(channelId, qualityId) {
    return getTier(channelId, qualityId)?.label ?? qualityId;
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

// A quality the user picked on one channel may not exist on the next one, and
// HLS needs a streams-aware playbin that may be unavailable. Degrade instead of
// building a URL that cannot play.
export function coerceQuality(channelId, qualityId, allowHls = true) {
    if (isHls(qualityId) && !allowHls)
        return hlsFallback(qualityId) ?? DEFAULT_QUALITY;

    if (getTier(channelId, qualityId) != null) return qualityId;

    return hlsFallback(qualityId) ?? DEFAULT_QUALITY;
}

export function resolveUri(channelId, qualityId, hostIndex = 0) {
    const id = coerceQuality(channelId, qualityId);
    const tier = getTier(channelId, id);

    if (tier == null) {
        // coerceQuality guarantees a valid id, so this is unreachable unless
        // QUALITY_TIERS and DEFAULT_QUALITY disagree.
        console.error(`SomaFM: no tier for ${channelId}/${qualityId}`);
        return null;
    }
    if (tier.url != null) return tier.url;

    const host = ICE_HOSTS[hostIndex % ICE_HOSTS.length];
    return `https://${host}.somafm.com/${channelId}${tier.suffix}`;
}
