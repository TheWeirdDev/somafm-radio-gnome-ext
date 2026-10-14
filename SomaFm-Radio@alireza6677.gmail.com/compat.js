import Clutter from "gi://Clutter";
import * as Config from "resource:///org/gnome/shell/misc/config.js";

// GNOME 51 removed St.BoxLayout's `vertical` property in favour of `orientation`.
const MAJOR = parseInt(Config.PACKAGE_VERSION.split(".")[0]);

// Spread into an St.BoxLayout's init props: { ...boxOrientation(true), width: 250 }
export function boxOrientation(vertical) {
    if (MAJOR >= 51)
        return {
            orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        };
    return { vertical };
}
