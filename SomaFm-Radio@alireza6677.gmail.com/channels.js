const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const Data = Extension.imports.data;

const channels = 
[
{ name: "Groove Salad",             link: "http://ice3.somafm.com/groovesalad-32-aac",        pic: '/images/groovesalad.png',       num:0},
{ name: "Secret Agent",             link: "http://ice3.somafm.com/secretagent-32-aac",        pic: "/images/secretagent.jpg",       num:1},
{ name: "Lush",                     link: "http://ice3.somafm.com/lush-32-aac",               pic: "/images/lush-x.jpg",            num:2},
{ name: "Fluid",                    link: "http://ice3.somafm.com/fluid-32-aac",              pic: "/images/fluid.jpg",             num:3},
{ name: "Deep Space One",           link: "http://ice3.somafm.com/deepspaceone-32-aac",       pic: "/images/deepspaceone.gif",      num:4},
{ name: "Drone Zone",               link: "http://ice3.somafm.com/dronezone-32-aac",          pic: "/images/dronezone.jpg",         num:5},
{ name: "Space Station Soma",       link: "http://ice3.somafm.com/spacestation-32-aac",       pic: "/images/sss.jpg",               num:6},
{ name: "DEF CON Radio",            link: "http://ice3.somafm.com/defcon-32-aac",             pic: "/images/defcon.png",            num:7},
{ name: "Sonic Universe",           link: "http://ice3.somafm.com/sonicuniverse-32-aac",      pic: "/images/sonicuniverse.jpg",     num:8},
{ name: "Suburbs of Goa",           link: "http://ice3.somafm.com/suburbsofgoa-32-aac",       pic: "/images/sog.jpg",               num:9},
{ name: "Beat Blender",             link: "http://ice3.somafm.com/beatblender-32-aac",        pic: "/images/blender.png",           num:10},
{ name: "The Trip",                 link: "http://ice3.somafm.com/thetrip-32-aac",            pic: "/images/thetrip.jpg",           num:11},
{ name: "Illinois Street Lounge",   link: "http://ice3.somafm.com/illstreet-32-aac",          pic: "/images/illstreet.jpg",         num:12},
{ name: "Seven Inch Soul",          link: "http://ice3.somafm.com/7soul-32-aac",              pic: "/images/7soul.png",             num:13},
{ name: "Left Coast 70s",           link: "http://ice3.somafm.com/seventies-32-aac",          pic: "/images/seventies.jpg",         num:14},
{ name: "Underground 80s",          link: "http://ice3.somafm.com/u80s-32-aac",               pic: "/images/u80s-.png",             num:15},
{ name: "Boot Liquor",              link: "http://ice3.somafm.com/bootliquor-32-aac",         pic: "/images/bootliquor.jpg",        num:16},
{ name: "Digitalis",                link: "http://ice3.somafm.com/digitalis-32-aac",          pic: "/images/digitalis.png",         num:17},
{ name: "ThistleRadio",             link: "http://ice3.somafm.com/thistle-32-aac",            pic: "/images/thistle.png",           num:18},
{ name: "Folk Forward",             link: "http://ice3.somafm.com/folkfwd-32-aac",            pic: "/images/folkfwd.jpg",           num:19},
{ name: "cliqhop idm",              link: "http://ice3.somafm.com/cliqhop-32-aac",            pic: "/images/cliqhop.png",           num:20},
{ name: "PopTron",                  link: "http://ice3.somafm.com/poptron-32-aac",            pic: '/images/poptron.png',           num:21},
{ name: "Indie Pop Rocks!",         link: "http://ice3.somafm.com/indiepop-32-aac",           pic: "/images/indychick.jpg",         num:22},
{ name: "BAGeL Radio",              link: "http://ice3.somafm.com/bagel-32-aac",              pic: "/images/bagel.png",             num:23},
{ name: "Metal Detector",           link: "http://ice3.somafm.com/metal-32-aac",              pic: "/images/metal.png",             num:24},
{ name: "Covers",                   link: "http://ice3.somafm.com/covers-32-aac",             pic: "/images/covers.jpg",            num:25},
{ name: "Doomed",                   link: "http://ice3.somafm.com/doomed-32-aac",             pic: "/images/doomed.png",            num:26},
{ name: "Dub Step Beyond",          link: "http://ice3.somafm.com/dubstep-32-aac",            pic: "/images/dubstep.png",           num:27},
{ name: "Black Rock FM",            link: "http://ice3.somafm.com/brfm-32-aac",               pic: "/images/1023brc.jpg",           num:28},
{ name: "Mission Control",          link: "http://ice3.somafm.com/missioncontrol-32-aac",     pic: "/images/missioncontrol.jpg",    num:30},
{ name: "SF 10-33",                 link: "http://ice3.somafm.com/sf1033-32-aac",             pic: "/images/sf1033.png",            num:31},
];

const Channel = new Lang.Class({
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

const ChannelBox = new Lang.Class({
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
    let array = [];
    channels.forEach(function (item, index) {
        array.push(new Channel(item.name, item.link, item.pic, item.num , Data.isFav(item.num)));
    });
    return array;
}

function getFavChannels() {
    let array = [];
    channels.forEach(function (item, index) {
        if(Data.isFav(item.num))
            array.push(new Channel(item.name, item.link, item.pic, item.num , true));
    });
    return array;
}

function getChannel(index) {
    let item = channels[index];
    return new Channel(item.name, item.link, item.pic , item.num , Data.isFav(item.num));
}
