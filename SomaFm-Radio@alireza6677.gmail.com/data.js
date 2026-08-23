import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { DEFAULT_QUALITY } from "./streams.js";

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
	// Genre filter for the channel list; "" means all genres.
	genre: "",
};

// prefs used to be re-read from disk by every getter, which meant one file read
// per channel while building the menus. Now the file is read once, off the main
// loop, and every getter answers from this snapshot.
let cache = null;

// Saves are frequent -- the volume slider writes on every step -- so only one
// write is ever in flight and a newer payload replaces a waiting one.
let pending = null;
let writing = false;
let dirReady = false;

function dirPath() {
	return GLib.build_filenamev([GLib.get_home_dir(), DIR_NAME]);
}

function filePath() {
	return GLib.build_filenamev([dirPath(), FILE_NAME]);
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
			// Added after v2 shipped, so a file without it is not a migration.
			genre: typeof raw.genre === "string" ? raw.genre : DEFAULTS.genre,
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
		genre: DEFAULTS.genre,
	};

	console.log(
		`SomaFM: migrated prefs to schema v${SCHEMA_VERSION} ` +
			`(channel ${migrated.lastChannel}, ${migrated.favs.length} favorites)`,
	);
	queue(migrated);
	return migrated;
}

// Reads the prefs without blocking the shell, then calls onDone(). enable()
// builds nothing until this lands, so no getter has to answer before the file
// has been read.
export function load(cancellable, onDone) {
	if (cache != null) {
		onDone();
		return;
	}

	Gio.File.new_for_path(filePath()).load_contents_async(
		cancellable,
		(file, res) => {
			let raw = null;
			try {
				const [ok, bytes] = file.load_contents_finish(res);
				if (ok) raw = JSON.parse(new TextDecoder().decode(bytes));
			} catch (e) {
				// Having no file yet is the normal first run, not an error.
				if (
					!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
					!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
				)
					console.error(`SomaFM: cannot read prefs: ${e}`);
			}

			cache = raw != null ? migrate(raw) : { ...DEFAULTS };
			onDone();
		},
	);
}

// Called on disable() so a re-enable picks up any external edits.
export function invalidate() {
	cache = null;
}

function current() {
	return cache ?? DEFAULTS;
}

export function getLastChannelId() {
	return current().lastChannel;
}

export function getLastVol() {
	return current().lastVol;
}

export function getQuality() {
	return current().quality;
}

export function getGenre() {
	return current().genre;
}

export function getFavs() {
	return current().favs;
}

export function isFav(id) {
	return getFavs().indexOf(id) >= 0;
}

// ~/.somafm-radio, created on the first save. make_directory_async() only
// creates one level, which is all this needs.
function ensureDir(onDone) {
	if (dirReady) {
		onDone();
		return;
	}

	Gio.File.new_for_path(dirPath()).make_directory_async(
		GLib.PRIORITY_DEFAULT,
		null,
		(dir, res) => {
			try {
				dir.make_directory_finish(res);
			} catch (e) {
				if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
					console.error(`SomaFM: cannot create ${dirPath()}: ${e}`);
			}
			dirReady = true;
			onDone();
		},
	);
}

function flush() {
	if (writing || pending == null) return;

	const payload = pending;
	pending = null;
	writing = true;

	Gio.File.new_for_path(filePath()).replace_contents_async(
		new TextEncoder().encode(payload),
		null,
		false,
		Gio.FileCreateFlags.REPLACE_DESTINATION,
		null,
		(file, res) => {
			writing = false;
			try {
				file.replace_contents_finish(res);
			} catch (e) {
				// First save of a fresh install: the directory is missing.
				if (
					!dirReady &&
					e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
				) {
					pending ??= payload;
					ensureDir(flush);
					return;
				}
				console.error(`SomaFM: failed to save prefs: ${e}`);
			}
			dirReady = true;
			flush();
		},
	);
}

function queue(data) {
	pending = JSON.stringify(data, null, 4);
	flush();
}

export function save(channel, lastVol, favs, quality) {
	const data = {
		schemaVersion: SCHEMA_VERSION,
		lastChannel: channel ? channel.getId() : current().lastChannel,
		favs: Array.isArray(favs) ? favs : current().favs,
		lastVol: clampVol(lastVol),
		quality: typeof quality === "string" ? quality : current().quality,
		genre: current().genre,
	};
	cache = data;
	queue(data);
}

// The genre filter is the only setting not tied to playback, so it writes
// through on its own rather than joining save()'s argument list.
export function setGenre(tag) {
	const data = { ...current(), genre: typeof tag === "string" ? tag : "" };
	cache = data;
	queue(data);
}
