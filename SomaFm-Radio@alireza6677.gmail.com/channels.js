const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const Data = Extension.imports.data;

const channels =
[
{ name: "Groove Salad",             link: "http://ice3.somafm.com/groovesalad-64-aac",        pic: '/images/groovesalad.png',         num:0},
{ name: "Groove Salad Classic",     link: "http://ice3.somafm.com/gsclassic-64-aac",          pic: '/images/groovesaladclassic.jpg',  num:1},
{ name: "Secret Agent",             link: "http://ice3.somafm.com/secretagent-64-aac",        pic: "/images/secretagent.jpg",         num:2},
{ name: "Lush",                     link: "http://ice3.somafm.com/lush-64-aac",               pic: "/images/lush-x.jpg",              num:3},
{ name: "Fluid",                    link: "http://ice3.somafm.com/fluid-64-aac",              pic: "/images/fluid.jpg",               num:4},
{ name: "Deep Space One",           link: "http://ice3.somafm.com/deepspaceone-64-aac",       pic: "/images/deepspaceone.gif",        num:5},
{ name: "Drone Zone",               link: "http://ice3.somafm.com/dronezone-64-aac",          pic: "/images/dronezone.jpg",           num:6},
{ name: "Space Station Soma",       link: "http://ice3.somafm.com/spacestation-64-aac",       pic: "/images/sss.jpg",                 num:7},
{ name: "DEF CON Radio",            link: "http://ice3.somafm.com/defcon-64-aac",             pic: "/images/defcon.png",              num:8},
{ name: "Sonic Universe",           link: "http://ice3.somafm.com/sonicuniverse-64-aac",      pic: "/images/sonicuniverse.jpg",       num:9},
{ name: "Suburbs of Goa",           link: "http://ice3.somafm.com/suburbsofgoa-64-aac",       pic: "/images/sog.jpg",                 num:10},
{ name: "Beat Blender",             link: "http://ice3.somafm.com/beatblender-64-aac",        pic: "/images/blender.png",             num:11},
{ name: "The Trip",                 link: "http://ice3.somafm.com/thetrip-64-aac",            pic: "/images/thetrip.jpg",             num:12},
{ name: "Illinois Street Lounge",   link: "http://ice3.somafm.com/illstreet-64-aac",          pic: "/images/illstreet.jpg",           num:13},
{ name: "Seven Inch Soul",          link: "http://ice3.somafm.com/7soul-64-aac",              pic: "/images/7soul.png",               num:14},
{ name: "Left Coast 70s",           link: "http://ice3.somafm.com/seventies-64-aac",          pic: "/images/seventies.jpg",           num:15},
{ name: "Underground 80s",          link: "http://ice3.somafm.com/u80s-64-aac",               pic: "/images/u80s-.png",               num:16},
{ name: "Boot Liquor",              link: "http://ice3.somafm.com/bootliquor-64-aac",         pic: "/images/bootliquor.jpg",          num:17},
{ name: "Digitalis",                link: "http://ice3.somafm.com/digitalis-64-aac",          pic: "/images/digitalis.png",           num:18},
{ name: "ThistleRadio",             link: "http://ice3.somafm.com/thistle-64-aac",            pic: "/images/thistle.png",             num:19},
{ name: "Folk Forward",             link: "http://ice3.somafm.com/folkfwd-64-aac",            pic: "/images/folkfwd.jpg",             num:20},
{ name: "cliqhop idm",              link: "http://ice3.somafm.com/cliqhop-64-aac",            pic: "/images/cliqhop.png",             num:21},
{ name: "PopTron",                  link: "http://ice3.somafm.com/poptron-64-aac",            pic: '/images/poptron.png',             num:22},
{ name: "Indie Pop Rocks!",         link: "http://ice3.somafm.com/indiepop-64-aac",           pic: "/images/indychick.jpg",           num:23},
{ name: "BAGeL Radio",              link: "http://ice3.somafm.com/bagel-64-aac",              pic: "/images/bagel.png",               num:24},
{ name: "Metal Detector",           link: "http://ice3.somafm.com/metal-64-aac",              pic: "/images/metal.png",               num:25},
{ name: "Covers",                   link: "http://ice3.somafm.com/covers-64-aac",             pic: "/images/covers.jpg",              num:26},
{ name: "Doomed",                   link: "http://ice3.somafm.com/doomed-64-aac",             pic: "/images/doomed.png",              num:27},
{ name: "Dub Step Beyond",          link: "http://ice3.somafm.com/dubstep-64-aac",            pic: "/images/dubstep.png",             num:28},
{ name: "Black Rock FM",            link: "http://ice3.somafm.com/brfm-64-aac",               pic: "/images/1023brc.jpg",             num:29},
{ name: "Mission Control",          link: "http://ice3.somafm.com/missioncontrol-64-aac",     pic: "/images/missioncontrol.jpg",      num:30},
{ name: "SF 10-33",                 link: "http://ice3.somafm.com/sf1033-64-aac",             pic: "/images/sf1033.png",              num:31},
];

var Channel = new Lang.Class({
    Name: 'Channel',

    _init: function (name, link, pic ,num , fav) {
        this.name = name;
        this.link = link;
        this.pic = pic;
        this.num = num;
        this.fav = fav;
    },
    getName: function () {
        return this.name;
    },
    getLink: function () {
        return this.link;
    },
    getPic: function () {
        return this.pic;
    },
    getNum: function (){
        return this.num;
    },
    isFav: function (){
        return this.fav;
    },
    setFav: function (f){
        this.fav = f;
    },

});

var ChannelBox = new Lang.Class({
    Name: 'Popup',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (channel, player, popup) {
        this.parent({
            reactive: true,
            can_focus: true,
        });
        this.player = player;
        this.channel = channel;
        this.popup = popup;

        this.vbox = new St.BoxLayout({ vertical: false });
        this.actor.add_child(this.vbox);

        let icon2 = new St.Icon({
            gicon: Gio.icon_new_for_string(Extension.path + channel.getPic()),
            style:'margin-right:10px',
            icon_size:60,
        });

        let box2 = new St.BoxLayout({ vertical: false });
        let label1 = new St.Label({ text: channel.getName() });
        this.vbox.add_child(icon2);
        this.vbox.add_child(box2);
        box2.add(label1, { y_fill: false, y_align: St.Align.MIDDLE });

    },

    activate: function (event) {
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
