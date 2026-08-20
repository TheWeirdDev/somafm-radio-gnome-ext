import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import { DEFAULT_QUALITY } from "./streams.js";
import { extPath } from "./extension.js";

const FILE_NAME = "prefs.json";
const DIR_NAME = ".somafm-radio";
const SCHEMA_VERSION = 2;

// Frozen snapshot of the channel order used by schema v1, which keyed
// lastChannel and favs by array index. Needed to translate those indices into
// the channel ids v2 uses. Never reorder or extend this: the live channel list
// moved to channels.js, and changing this table would silently remap the
// favorites of anyone upgrading.
const LEGACY_CHANNEL_IDS = [
	"groovesalad",
	"secretagent",
	"lush",
	"fluid",
	"deepspaceone",
	"dronezone",
	"spacestation",
	"defcon",
	"sonicuniverse",
	"suburbsofgoa",
	"beatblender",
	"thetrip",
	"illstreet",
	"7soul",
	"seventies",
	"u80s",
	"bootliquor",
	"digitalis",
	"thistle",
	"folkfwd",
	"cliqhop",
	"poptron",
	"indiepop",
	"bagel",
	"metal",
	"covers",
	"doomed",
	"dubstep",
	"brfm",
	"missioncontrol",
	"sf1033",
	"gsclassic",
	"vaporwaves",
	"reggae",
	"n5md",
	"deptstore",
	"christmas",
	"xmasrocks",
	"xmasinfrisko",
	"jollysoul",
];

const DEFAULTS = {
	schemaVersion: SCHEMA_VERSION,
	lastChannel: "groovesalad",
	favs: [],
	lastVol: 0.5,
	quality: DEFAULT_QUALITY,
};

// prefs used to be re-read from disk by every getter, which meant one file read
// per channel while building the menus. Cache it and write through on save().
let cache = null;

function filePath() {
	return GLib.get_home_dir() + "/" + DIR_NAME + "/" + FILE_NAME;
}

function clampVol(value) {
	const n = typeof value === "string" ? parseFloat(value) : value;
	if (typeof n !== "number" || !isFinite(n)) return DEFAULTS.lastVol;
	return Math.min(1, Math.max(0, n));
}

// v1 stored channel references as indices into the old channel array.
function migrate(raw) {
	if (raw.schemaVersion === SCHEMA_VERSION) {
		return {
			schemaVersion: SCHEMA_VERSION,
			lastChannel:
				typeof raw.lastChannel === "string"
					? raw.lastChannel
					: DEFAULTS.lastChannel,
			favs: Array.isArray(raw.favs)
				? raw.favs.filter((f) => typeof f === "string")
				: [],
			lastVol: clampVol(raw.lastVol),
			quality:
				typeof raw.quality === "string" ? raw.quality : DEFAULTS.quality,
		};
	}

	const toId = (i) =>
		Number.isInteger(i) && i >= 0 && i < LEGACY_CHANNEL_IDS.length
			? LEGACY_CHANNEL_IDS[i]
			: null;

	const migrated = {
		schemaVersion: SCHEMA_VERSION,
		lastChannel: toId(raw.lastChannel) ?? DEFAULTS.lastChannel,
		favs: Array.isArray(raw.favs)
			? [...new Set(raw.favs.map(toId).filter((id) => id != null))]
			: [],
		lastVol: clampVol(raw.lastVol),
		quality: DEFAULTS.quality,
	};

	console.log(
		`SomaFM: migrated prefs to schema v${SCHEMA_VERSION} ` +
			`(channel ${migrated.lastChannel}, ${migrated.favs.length} favorites)`,
	);
	write(migrated);
	return migrated;
}

export function load() {
	if (cache != null) return cache;

	create(GLib.get_home_dir() + "/" + DIR_NAME);

	let content;
	try {
		content = Shell.get_file_contents_utf8_sync(filePath());
	} catch (e) {
		console.error("SomaFM: failed to load json: " + e);
		cache = { ...DEFAULTS };
		return cache;
	}

	let raw;
	try {
		raw = JSON.parse(content);
	} catch (e) {
		console.error("SomaFM: Failed to parse json: " + e);
		cache = { ...DEFAULTS };
		return cache;
	}

	cache = migrate(raw);
	return cache;
}

// Called on disable() so a re-enable picks up any external edits.
export function invalidate() {
	cache = null;
}

export function getLastChannelId() {
	return load().lastChannel;
}

export function getLastVol() {
	return load().lastVol;
}

export function getQuality() {
	return load().quality;
}

export function getFavs() {
	return load().favs;
}

export function isFav(id) {
	return getFavs().indexOf(id) >= 0;
}

export function create(dir_path) {
	let dir = Gio.file_new_for_path(dir_path);
	let source_file = Gio.file_new_for_path(extPath).get_child(FILE_NAME);
	if (!dir.query_exists(null)) {
		try {
			dir.make_directory(null);
			let file = dir.get_child(FILE_NAME);
			source_file.copy(file, Gio.FileCopyFlags.NONE, null, null);
		} catch (e) {
			console.error("SomaFM: Failed to create directory and/or file! " + e);
		}
	} else {
		let file = dir.get_child(FILE_NAME);
		if (!file.query_exists(null)) {
			try {
				source_file.copy(file, Gio.FileCopyFlags.NONE, null, null);
			} catch (e) {
				console.error("SomaFM: Failed to create file! " + e);
			}
		}
	}
}

function write(data) {
	try {
		let file = Gio.file_new_for_path(filePath());
		let raw = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
		let out = Gio.BufferedOutputStream.new_sized(raw, 4096);
		Shell.write_string_to_stream(out, JSON.stringify(data, null, 4));
		out.close(null);
	} catch (e) {
		console.error("SomaFM: Failed to save prefs: " + e);
	}
}

export function save(channel, lastVol, favs, quality) {
	const current = load();
	const data = {
		schemaVersion: SCHEMA_VERSION,
		lastChannel: channel ? channel.getId() : current.lastChannel,
		favs: Array.isArray(favs) ? favs : current.favs,
		lastVol: clampVol(lastVol),
		quality: typeof quality === "string" ? quality : current.quality,
	};
	cache = data;
	write(data);
}
