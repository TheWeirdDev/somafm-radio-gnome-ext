import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import * as Channels from "./channels.js";
import { extPath } from "./extension.js";

const FILE_NAME = "prefs.json";
const DIR_NAME = ".somafm-radio";

export function load() {
	let dir_path = GLib.get_home_dir() + "/" + DIR_NAME;
	create(dir_path);
	let file_path = GLib.get_home_dir() + "/" + DIR_NAME + "/" + FILE_NAME;
	let content;
	let channelList;
	try {
		content = Shell.get_file_contents_utf8_sync(file_path);
	} catch (e) {
		global.logError("Failed to load json: " + e);
		return null;
	}
	// parse json file
	try {
		channelList = JSON.parse(content);
	} catch (e) {
		global.logError("Failed to parse json: " + e);
		return null;
	}
	return channelList;
}

export function getLastChannel() {
	return Channels.getChannel(load().lastChannel);
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
			global.logError("Failed to create directory and/or file! " + e);
		}
	} else {
		let file = dir.get_child(FILE_NAME);
		if (!file.query_exists(null)) {
			try {
				source_file.copy(file, Gio.FileCopyFlags.NONE, null, null);
			} catch (e) {
				global.logError("Failed to create file! " + e);
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
		lastChannel: lastChannel.getNum(),
		favs: Array.isArray(favs) ? favs : [],
		lastVol: lastVol.toFixed(2),
	};
	Shell.write_string_to_stream(out, JSON.stringify(saveData, null, 4));
	out.close(null);
}
