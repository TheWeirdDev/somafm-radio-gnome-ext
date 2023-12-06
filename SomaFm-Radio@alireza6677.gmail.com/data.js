import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import * as Channels from "./channels.js";
import { extPath } from "./extension.js";

const FILE_NAME = "prefs.json";
const DIR_NAME = ".somafm-radio";

export function load() {
	let dir_path = GLib.get_home_dir() + "/" + DIR_NAME;
	const defaultData = {
		lastChannel: 0,
		favs: [],
		lastVol: 0.5,
	};

	create(dir_path);
	let file_path = GLib.get_home_dir() + "/" + DIR_NAME + "/" + FILE_NAME;
	let content;
	let channelList;
	try {
		content = Shell.get_file_contents_utf8_sync(file_path);
	} catch (e) {
		console.error("SomaFM: failed to load json: " + e);
		return defaultData;
	}
	// parse json file
	try {
		channelList = JSON.parse(content);
	} catch (e) {
		console.error("SomaFM: Failed to parse json: " + e);
		return defaultData;
	}
	return channelList;
}

export function getLastChannel() {
	return Channels.getChannel(load().lastChannel) ?? Channels.getChannel(0);
}

export function getLastVol() {
	return load().lastVol;
}

export function getFavs() {
	return load().favs;
}

export function isFav(ch) {
	return getFavs().indexOf(ch) >= 0;
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

export function save(lastChannel, lastVol, favs) {
	let filepath = GLib.get_home_dir() + "/" + DIR_NAME + "/" + FILE_NAME;
	let file = Gio.file_new_for_path(filepath);
	let raw = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
	let out = Gio.BufferedOutputStream.new_sized(raw, 4096);
	const saveData = {
		lastChannel: lastChannel ? lastChannel.getNum() : 0,
		favs: Array.isArray(favs) ? favs : [],
		lastVol:
			typeof lastVol === "number" && isFinite(lastVol)
				? lastVol.toFixed(2)
				: 0.5,
	};
	Shell.write_string_to_stream(out, JSON.stringify(saveData, null, 4));
	out.close(null);
}
