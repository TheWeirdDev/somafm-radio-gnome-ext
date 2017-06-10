const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Channels = Extension.imports.channels;

const Shell = imports.gi.Shell;

const FILE_NAME = 'prefs.json'
const DIR_NAME = '.somafm-radio'

function load(){
	let dir_path = GLib.get_home_dir() + "/" + DIR_NAME ;
	create(dir_path);
	let file_path = GLib.get_home_dir() + "/" + DIR_NAME + "/" + FILE_NAME;
	let content;
	let channelList;
	try {
		content = Shell.get_file_contents_utf8_sync(file_path);
	} catch (e) {
		global.logError('Failed to load json: ' + e);
		return null;
	}
	// parse json file
	try {
		channelList = JSON.parse(content);
	} catch (e) {
		global.logError('Failed to parse json: ' + e);
		return null;
	}
	return channelList;
}

function getLastChannel(){
    var data = load();
    var ch = data.lastChannel;
    return new Channels.Channel(ch.name , ch.link , ch.pic, ch.num , ch.fav);
}

function getLastVol(){
    return load().lastVol;
}

function getFavs(){
    return load().favs;
}

function isFav(ch){
    return getFavs().indexOf(ch) >= 0;
}

function create(dir_path) {
	let dir = Gio.file_new_for_path(dir_path);
	let source_file = Gio.file_new_for_path(Extension.path).get_child(FILE_NAME);
	if (!dir.query_exists(null)) {
		try {
			dir.make_directory(null);
			let file = dir.get_child(FILE_NAME);
			source_file.copy(file, Gio.FileCopyFlags.NONE, null, null);
		} catch (e) {
			global.logError('Failed to create directory and/or file! ' + e);
		}
	} else {
		let file = dir.get_child(FILE_NAME);
		if (!file.query_exists(null)) {
			try {
				source_file.copy(file, Gio.FileCopyFlags.NONE, null, null);
			} catch (e) {
				global.logError('Failed to create file! ' + e);
			}
		}
	}
}

function save(lastChannel , lastVol , favs) {
    let filepath = GLib.get_home_dir() + "/" + DIR_NAME + "/" + FILE_NAME;
    let file = Gio.file_new_for_path(filepath);
    let raw = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    let out = Gio.BufferedOutputStream.new_sized(raw, 4096);
    Shell.write_string_to_stream(out, "{ \"lastChannel\":");
    Shell.write_string_to_stream(out, JSON.stringify({
        name: lastChannel.getName(),
        link: lastChannel.getLink(),
        pic:  lastChannel.getPic(),
        num:  lastChannel.getNum(),
        fav:  lastChannel.isFav(),
    }, null, "\t"));

    Shell.write_string_to_stream(out, ",\n \"favs\":");
    if(favs != null && favs.length > 0){
        Shell.write_string_to_stream(out, JSON.stringify(favs, null, "\t"));
    }else{
        // If array is empty, write '[]' instead 
        Shell.write_string_to_stream(out,"[]");
    }

    Shell.write_string_to_stream(out, ", \"lastVol\":" + lastVol);
    Shell.write_string_to_stream(out, "\n}");
    out.close(null);

}