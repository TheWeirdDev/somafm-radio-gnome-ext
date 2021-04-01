const Lang = imports.lang;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const PopupMenu = imports.ui.popupMenu;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Data = Extension.imports.data;

const channels = 
[
{ name: "Groove Salad",             link: "http://ice3.somafm.com/groovesalad-128-aac",        pic: '/images/groovesalad.png',       num:0},
{ name: "Secret Agent",             link: "http://ice3.somafm.com/secretagent-128-aac",        pic: "/images/secretagent.jpg",       num:1},
{ name: "Lush",                     link: "http://ice3.somafm.com/lush-128-aac",               pic: "/images/lush-x.jpg",            num:2},
{ name: "Fluid",                    link: "http://ice3.somafm.com/fluid-128-aac",              pic: "/images/fluid.jpg",             num:3},
{ name: "Deep Space One",           link: "http://ice3.somafm.com/deepspaceone-128-aac",       pic: "/images/deepspaceone.gif",      num:4},
{ name: "Drone Zone",               link: "http://ice3.somafm.com/dronezone-128-aac",          pic: "/images/dronezone.jpg",         num:5},
{ name: "Space Station Soma",       link: "http://ice3.somafm.com/spacestation-128-aac",       pic: "/images/sss.jpg",               num:6},
{ name: "DEF CON Radio",            link: "http://ice3.somafm.com/defcon-128-aac",             pic: "/images/defcon.png",            num:7},
{ name: "Sonic Universe",           link: "http://ice3.somafm.com/sonicuniverse-128-aac",      pic: "/images/sonicuniverse.jpg",     num:8},
{ name: "Suburbs of Goa",           link: "http://ice3.somafm.com/suburbsofgoa-128-aac",       pic: "/images/sog.jpg",               num:9},
{ name: "Beat Blender",             link: "http://ice3.somafm.com/beatblender-128-aac",        pic: "/images/blender.png",           num:10},
{ name: "The Trip",                 link: "http://ice3.somafm.com/thetrip-128-aac",            pic: "/images/thetrip.jpg",           num:11},
{ name: "Illinois Street Lounge",   link: "http://ice3.somafm.com/illstreet-128-aac",          pic: "/images/illstreet.jpg",         num:12},
{ name: "Seven Inch Soul",          link: "http://ice3.somafm.com/7soul-128-aac",              pic: "/images/7soul.png",             num:13},
{ name: "Left Coast 70s",           link: "http://ice3.somafm.com/seventies-128-aac",          pic: "/images/seventies.jpg",         num:14},
{ name: "Underground 80s",          link: "http://ice3.somafm.com/u80s-128-aac",               pic: "/images/u80s-.png",             num:15},
{ name: "Boot Liquor",              link: "http://ice3.somafm.com/bootliquor-128-aac",         pic: "/images/bootliquor.jpg",        num:16},
{ name: "Digitalis",                link: "http://ice3.somafm.com/digitalis-128-aac",          pic: "/images/digitalis.png",         num:17},
{ name: "ThistleRadio",             link: "http://ice3.somafm.com/thistle-128-aac",            pic: "/images/thistle.png",           num:18},
{ name: "Folk Forward",             link: "http://ice3.somafm.com/folkfwd-128-aac",            pic: "/images/folkfwd.jpg",           num:19},
{ name: "cliqhop idm",              link: "http://ice3.somafm.com/cliqhop-128-aac",            pic: "/images/cliqhop.png",           num:20},
{ name: "PopTron",                  link: "http://ice3.somafm.com/poptron-128-aac",            pic: '/images/poptron.png',           num:21},
{ name: "Indie Pop Rocks!",         link: "http://ice3.somafm.com/indiepop-128-aac",           pic: "/images/indychick.jpg",         num:22},
{ name: "BAGeL Radio",              link: "http://ice3.somafm.com/bagel-128-aac",              pic: "/images/bagel.png",             num:23},
{ name: "Metal Detector",           link: "http://ice3.somafm.com/metal-128-aac",              pic: "/images/metal.png",             num:24},
{ name: "Covers",                   link: "http://ice3.somafm.com/covers-128-aac",             pic: "/images/covers.jpg",            num:25},
{ name: "Doomed",                   link: "http://ice3.somafm.com/doomed-128-aac",             pic: "/images/doomed.png",            num:26},
{ name: "Dub Step Beyond",          link: "http://ice3.somafm.com/dubstep-128-aac",            pic: "/images/dubstep.png",           num:27},
{ name: "Black Rock FM",            link: "http://ice3.somafm.com/brfm-128-aac",               pic: "/images/1023brc.jpg",           num:28},
{ name: "Mission Control",          link: "http://ice3.somafm.com/missioncontrol-128-aac",     pic: "/images/missioncontrol.jpg",    num:29},
{ name: "SF 10-33",                 link: "http://ice3.somafm.com/sf1033-128-aac",             pic: "/images/sf1033.png",            num:30},
{ name: "Groove Salad Classic",     link: "http://ice2.somafm.com/gsclassic-128-aac",          pic: "/images/gsclassic400.jpg",      num:31},
{ name: "Vaporwaves",               link: "http://ice3.somafm.com/vaporwaves-128-aac",         pic: "/images/vaporwaves400.png",     num:32},
{ name: "Heavyweight Reggae",       link: "http://ice2.somafm.com/reggae-128-aac",             pic: '/images/reggae400.png',         num:33},
];

var Channel = class Channel{

    constructor(name, link, pic ,num , fav) {
        this.name = name;
        this.link = link;
        this.pic = pic;
        this.num = num;
        this.fav = fav;
    }

    getName() {
        return this.name;
    }

    getLink() {
        return this.link;
    }

    getPic() {
        return this.pic;
    }

    getNum(){
        return this.num;
    }

    isFav(){
        return this.fav;
    }

    setFav(f){
        this.fav = f;
    }

};

var ChannelBox = GObject.registerClass(class ChannelBox extends PopupMenu.PopupBaseMenuItem {

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
            gicon: Gio.icon_new_for_string(Extension.path + channel.getPic()),
            style:'margin-right:10px',
            icon_size:60,
        });

        let box2 = new St.BoxLayout({ vertical: false });
        let label1 = new St.Label({
            text: channel.getName(),
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        this.vbox.add_child(icon2);
        this.vbox.add_child(box2);
        box2.add(label1);

    }

    activate(ev) {
        this.player.stop();
        this.player.setChannel(this.channel);
        this.player.play();
        this.popup.channelChanged();
    }
});

function getChannels() {
    return channels.map(ch => new Channel(ch.name, ch.link, ch.pic, ch.num , Data.isFav(ch.num)));
}

function getFavChannels() {
    return channels.filter(ch => Data.isFav(ch.num)).map(ch => new Channel(ch.name, ch.link, ch.pic, ch.num , true));
}

function getChannel(index) {
    let item = channels[index];
    return new Channel(item.name, item.link, item.pic , item.num , Data.isFav(item.num));
}
