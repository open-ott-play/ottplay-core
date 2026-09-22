/* Independent ES5 device adapter. Numeric profile facts are documented in
 * docs/DEVICE-CONTRACTS.md; no original player code is executed or imported. */
(function (root) {
    "use strict";
    root.OTT2.define("devices", function () {
        var facts = {
            "android": { label: "Android", keys: {"ASPECT":0,"AUDIO":0,"BLUE":186,"CH_DOWN":168,"CH_LIST":0,"CH_UP":167,"DOWN":20,"ENTER":66,"EPG":0,"EXIT":4,"FF":90,"GREEN":184,"INFO":165,"LANG":0,"LEFT":21,"MUTE":91,"N0":7,"N1":8,"N2":9,"N3":10,"N4":11,"N5":12,"N6":13,"N7":14,"N8":15,"N9":16,"NEXT":87,"PAUSE":85,"PIP":0,"PLAY":85,"POWER":26,"PRECH":0,"PREV":88,"REC":0,"RED":183,"RETURN":4,"RIGHT":22,"RW":89,"SETUP":82,"STOP":86,"TOOLS":82,"UP":19,"VOL_DOWN":25,"VOL_UP":24,"YELLOW":185,"ZOOM":0} },
            "dune": { label: "Dune HD", keys: {"ASPECT":0,"AUDIO":0,"BLUE":115,"CH_DOWN":34,"CH_LIST":0,"CH_UP":33,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":113,"INFO":73,"LANG":0,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":0,"PLAY":80,"POWER":0,"PRECH":0,"PREV":188,"REC":0,"RED":112,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":84,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":109,"VOL_UP":107,"YELLOW":114,"ZOOM":0} },
            "e2": { label: "Enigma2", keys: {"ASPECT":0,"AUDIO":0,"BLUE":115,"CH_DOWN":34,"CH_LIST":0,"CH_UP":33,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":113,"INFO":73,"LANG":0,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":0,"PLAY":80,"POWER":0,"PRECH":0,"PREV":188,"REC":0,"RED":112,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":84,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":114,"ZOOM":0} },
            "edem": { label: "Edem", keys: {"ASPECT":65,"AUDIO":83,"BLUE":86,"CH_DOWN":189,"CH_LIST":0,"CH_UP":187,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":88,"INFO":73,"LANG":16,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":87,"PLAY":80,"POWER":81,"PRECH":191,"PREV":188,"REC":0,"RED":90,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":192,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":67,"ZOOM":69} },
            "hbbtv": { label: "HbbTV", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "hisense": { label: "Hisense", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "inext": { label: "Inext", keys: {"ASPECT":0,"AUDIO":0,"BLUE":115,"CH_DOWN":34,"CH_LIST":0,"CH_UP":33,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":113,"INFO":73,"LANG":0,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":0,"PLAY":80,"POWER":0,"PRECH":0,"PREV":188,"REC":0,"RED":112,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":84,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":114,"ZOOM":0} },
            "lg/netcast": { label: "LG NetCast", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":188,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "lg/webos": { label: "LG webOS", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":461,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "mag": { label: "MAG", keys: {"ASPECT":0,"AUDIO":0,"BLUE":115,"CH_DOWN":34,"CH_LIST":0,"CH_UP":33,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":113,"INFO":73,"LANG":16,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":0,"PLAY":68,"POWER":0,"PRECH":191,"PREV":188,"REC":0,"RED":112,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":122,"STOP":83,"TOOLS":122,"UP":38,"VOL_DOWN":109,"VOL_UP":107,"YELLOW":114,"ZOOM":0} },
            "nodejs": { label: "NodeJS / Electron", keys: {"ASPECT":65,"AUDIO":83,"BLUE":86,"CH_DOWN":189,"CH_LIST":0,"CH_UP":187,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":88,"INFO":73,"LANG":16,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":87,"PLAY":80,"POWER":81,"PRECH":191,"PREV":188,"REC":0,"RED":90,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":192,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":67,"ZOOM":69} },
            "panasonic": { label: "Panasonic Viera", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "pc": { label: "PC browser", keys: {"ASPECT":65,"AUDIO":83,"BLUE":86,"CH_DOWN":189,"CH_LIST":0,"CH_UP":187,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":88,"INFO":73,"LANG":16,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":87,"PLAY":80,"POWER":81,"PRECH":191,"PREV":188,"REC":0,"RED":90,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":192,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":67,"ZOOM":69} },
            "pc2": { label: "PC browser 2", keys: {"ASPECT":65,"AUDIO":83,"BLUE":86,"CH_DOWN":189,"CH_LIST":0,"CH_UP":187,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":88,"INFO":73,"LANG":16,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":87,"PLAY":80,"POWER":81,"PRECH":191,"PREV":188,"REC":0,"RED":90,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":192,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":67,"ZOOM":69} },
            "philips": { label: "Philips", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "samsung/maple": { label: "Samsung Maple / Orsay", keys: {"ASPECT":0,"AUDIO":0,"BLUE":33,"CH_DOWN":19,"CH_LIST":107,"CH_UP":18,"DOWN":5,"ENTER":12,"EPG":0,"EXIT":45,"FF":72,"GREEN":30,"INFO":99,"LANG":0,"LEFT":4,"MUTE":82,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":69,"PAUSE":75,"PIP":0,"PLAY":71,"POWER":0,"PRECH":108,"PREV":68,"REC":0,"RED":29,"RETURN":88,"RIGHT":6,"RW":74,"SETUP":31,"STOP":73,"TOOLS":31,"UP":8,"VOL_DOWN":17,"VOL_UP":16,"YELLOW":32,"ZOOM":0} },
            "samsung/tizen": { label: "Samsung Tizen", keys: {"ASPECT":10140,"AUDIO":10195,"BLUE":406,"CH_DOWN":428,"CH_LIST":10073,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":458,"EXIT":10182,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":10233,"PAUSE":19,"PIP":0,"PLAY":415,"PLAYPAUSE":10252,"POWER":10005,"PRECH":10190,"PREV":10232,"REC":416,"RED":403,"RETURN":10009,"RIGHT":39,"RW":412,"SETUP":18,"STOP":413,"TOOLS":10135,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":10122} },
            "sharp": { label: "Sharp", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "skyworth": { label: "Skyworth", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "sony": { label: "Sony", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "spark": { label: "Spark", keys: {"ASPECT":0,"AUDIO":0,"BLUE":115,"CH_DOWN":34,"CH_LIST":0,"CH_UP":33,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":70,"GREEN":113,"INFO":73,"LANG":0,"LEFT":37,"MUTE":77,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":190,"PAUSE":80,"PIP":0,"PLAY":80,"POWER":0,"PRECH":0,"PREV":188,"REC":0,"RED":112,"RETURN":8,"RIGHT":39,"RW":82,"SETUP":84,"STOP":83,"TOOLS":84,"UP":38,"VOL_DOWN":0,"VOL_UP":0,"YELLOW":114,"ZOOM":0} },
            "tcl": { label: "TCL", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "toshiba": { label: "Toshiba", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} },
            "vewd": { label: "Vewd", keys: {"ASPECT":0,"AUDIO":0,"BLUE":406,"CH_DOWN":428,"CH_LIST":0,"CH_UP":427,"DOWN":40,"ENTER":13,"EPG":0,"EXIT":27,"FF":417,"GREEN":404,"INFO":457,"LANG":0,"LEFT":37,"MUTE":449,"N0":48,"N1":49,"N2":50,"N3":51,"N4":52,"N5":53,"N6":54,"N7":55,"N8":56,"N9":57,"NEXT":425,"PAUSE":19,"PIP":0,"PLAY":415,"POWER":0,"PRECH":0,"PREV":424,"REC":416,"RED":403,"RETURN":8,"RIGHT":39,"RW":412,"SETUP":458,"STOP":413,"TOOLS":459,"UP":38,"VOL_DOWN":448,"VOL_UP":447,"YELLOW":405,"ZOOM":0} }
        };
        var own = Object.prototype.hasOwnProperty;
        var registrations = [];
        var names = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            "VolumeUp", "VolumeDown", "VolumeMute", "ChannelUp", "ChannelDown",
            "ChannelList", "PreviousChannel", "MediaPlayPause", "MediaRewind",
            "MediaFastForward", "MediaPlay", "MediaPause", "MediaStop", "MediaRecord",
            "MediaTrackPrevious", "MediaTrackNext", "ColorF0Red", "ColorF1Green",
            "ColorF2Yellow", "ColorF3Blue", "Menu", "Tools", "Info", "Exit",
            "PictureSize", "MTS", "Guide"];
        var actions = [
            ["up", "UP"], ["down", "DOWN"], ["left", "LEFT"], ["right", "RIGHT"],
            ["ok", "ENTER"], ["back", "RETURN"], ["exit", "EXIT"], ["quit", "POWER"],
            ["fullscreen", "FULLSCREEN"], ["menu", "SETUP", "TOOLS", "CH_LIST", "CONTEXT_MENU"],
            ["info", "INFO"], ["guide", "EPG"], ["red", "RED"], ["green", "GREEN"],
            ["yellow", "YELLOW"], ["blue", "BLUE"], ["playPause", "PLAYPAUSE", "SPACE", "MEDIA_PLAY_PAUSE"], ["play", "PLAY"],
            ["pause", "PAUSE"], ["stop", "STOP", "MEDIA_STOP"], ["forward", "FF"], ["rewind", "RW"],
            ["previousChannel", "PRECH"], ["next", "NEXT", "MEDIA_NEXT"], ["previous", "PREV", "MEDIA_PREVIOUS"],
            ["channelUp", "CH_UP"], ["channelDown", "CH_DOWN"],
            ["volumeUp", "VOL_UP", "MEDIA_VOLUME_UP"], ["volumeDown", "VOL_DOWN", "MEDIA_VOLUME_DOWN"], ["mute", "MUTE", "MEDIA_MUTE"],
            ["tab", "TAB"], ["pageUp", "PAGE_UP"], ["pageDown", "PAGE_DOWN"], ["home", "HOME"], ["end", "END"],
            ["audio", "AUDIO"], ["subtitle", "SUBTITLE"], ["aspect", "ASPECT"], ["zoom", "ZOOM"], ["pip", "PIP"]
        ];
        var desktopKeys = { FULLSCREEN: 76, SPACE: 32, CONTEXT_MENU: 93,
            TAB: 9, PAGE_UP: 33, PAGE_DOWN: 34, HOME: 36, END: 35,
            MEDIA_PLAY_PAUSE: 179, MEDIA_STOP: 178, MEDIA_NEXT: 176, MEDIA_PREVIOUS: 177,
            MEDIA_VOLUME_UP: 175, MEDIA_VOLUME_DOWN: 174, MEDIA_MUTE: 173 };
        var profiles = {};
        var id;
        var i;
        var j;

        function read(object, key) {
            try { return object == null ? undefined : object[key]; }
            catch (error) { return undefined; }
        }

        function known(value) {
            return typeof value === "string" && own.call(profiles, value);
        }

        function text(value) { return typeof value === "string" ? value : ""; }

        function contains(list, value) {
            for (var at = 0; at < list.length; at += 1) {
                if (list[at] === value) { return true; }
            }
            return false;
        }

        function decoded(value) {
            try { return decodeURIComponent(value.replace(/\+/g, " ")); }
            catch (error) { return ""; }
        }

        for (id in facts) {
            if (!own.call(facts, id)) { continue; }
            var map = {};
            var entry = facts[id];
            var desktop = id === "pc" || id === "pc2" || id === "nodejs" || id === "edem";
            // Desktop conveniences are explicit profile data, never global aliases.
            if (desktop) {
                for (var name in desktopKeys) {
                    if (own.call(desktopKeys, name)) { entry.keys[name] = desktopKeys[name]; }
                }
            }
            for (i = 0; i < actions.length; i += 1) {
                var codes = [];
                for (j = 1; j < actions[i].length; j += 1) {
                    var code = entry.keys[actions[i][j]];
                    if (code && !contains(codes, code)) { codes.push(code); }
                }
                map[actions[i][0]] = codes;
            }
            if (entry.keys.PLAY && entry.keys.PLAY === entry.keys.PAUSE) {
                if (!contains(map.playPause, entry.keys.PLAY)) { map.playPause.push(entry.keys.PLAY); }
                map.play = [];
                map.pause = [];
            }
            for (i = 0; i < 10; i += 1) {
                map["digit" + i] = [entry.keys["N" + i]];
                if (desktop) { entry.keys["NUMPAD" + i] = 96 + i; map["digit" + i].push(entry.keys["NUMPAD" + i]); }
            }
            profiles[id] = { id: id, label: entry.label, keyMap: map, keys: entry.keys, keyReleaseTimeout: desktop ? 0 : 350 };
        }

        // Android WebViews dispatch DOM codes unless a native profile is explicitly selected.
        var androidDOM = { id: "android", label: "Android (browser input)", inputTransport: "dom", keyMap: profiles.pc.keyMap, keys: profiles.pc.keys, keyReleaseTimeout: 350 };
        profiles.android.inputTransport = "native";
        function routeProfile(path) {
            var parts = text(path).split("/"), route, offset = 3;
            if (parts[1] !== "f") return "";
            route = decoded(parts[2] || "");
            if (route === "lg" || route === "samsung") { route += "/" + decoded(parts[3] || ""); offset = 4; }
            if (!known(route)) return "";
            var tail = parts.slice(offset).join("/");
            // Only clean directory names and HTML documents are application routes.
            if (tail && !/^(?:[a-zA-Z0-9_-]+\/)*(?:[a-zA-Z0-9_-]+(?:\.html?)?)?$/.test(tail)) return "";
            return route;
        }

        function detect(env) {
            env = env || {};
            var i;
            var location = read(env, "location");
            var path = text(read(location, "pathname"));
            var route = routeProfile(path), query, item, split;
            if (route) return profiles[route];
            query = text(read(location, "search")).replace(/^\?/, "").split("&");
            for (i = 0; i < query.length; i += 1) {
                item = query[i];
                split = item.indexOf("=");
                if (split >= 0 && decoded(item.slice(0, split)) === "device") {
                    route = decoded(item.slice(split + 1));
                    if (known(route)) { return profiles[route]; }
                }
            }
            var ua = text(read(read(env, "navigator"), "userAgent")).toLowerCase();
            if (/web[0o]s/.test(ua)) { return profiles["lg/webos"]; }
            if (ua.indexOf("netcast") >= 0) { return profiles["lg/netcast"]; }
            if (ua.indexOf("android") >= 0) { return androidDOM; }
            if (ua.indexOf("lg") >= 0) { return profiles["lg/webos"]; }
            var bridge = read(env, "gSTB");
            var bridgeMethods = ["GetDeviceModel", "GetDeviceMacAddress", "GetMACAddress"];
            for (i = 0; i < bridgeMethods.length; i += 1) {
                if (typeof read(bridge, bridgeMethods[i]) === "function") { return profiles.mag; }
            }
            var tokens = ua.split(/[^a-z0-9]+/);
            for (i = 0; i < tokens.length; i += 1) {
                if (/^mag[0-9]+(?:[rw][0-9]+)?$/.test(tokens[i])) { return profiles.mag; }
            }
            if (ua.indexOf("infomir") >= 0 && ua.indexOf("stb") >= 0) { return profiles.mag; }
            var hints = [["tizen", "samsung/tizen"], ["maple", "samsung/maple"],
                ["dune", "dune"], ["android", "android"], ["hbbtv", "hbbtv"],
                ["oipf", "hbbtv"], ["viera", "panasonic"], ["philips", "philips"],
                ["hisense", "hisense"], ["sony", "sony"], ["tcl", "tcl"],
                ["sharp", "sharp"], ["toshiba", "toshiba"], ["skyworth", "skyworth"],
                ["vewd", "vewd"], ["spark", "spark"], ["nodejs", "nodejs"], ["electron", "nodejs"]];
            for (i = 0; i < hints.length; i += 1) {
                if (ua.indexOf(hints[i][0]) >= 0) { return profiles[hints[i][1]]; }
            }
            return profiles.pc;
        }

        function keyCode(event) {
            var code = read(event, "keyCode");
            if (typeof code === "number" && isFinite(code) && code > 0 && Math.floor(code) === code) return code;
            code = read(event, "which");
            return typeof code === "number" && isFinite(code) && code > 0 && Math.floor(code) === code ? code : 0;
        }

        function normalize(event, profile) {
            if (typeof profile === "string") { profile = known(profile) ? profiles[profile] : profiles.pc; }
            profile = profile || profiles.pc;
            var map = profile.keyMap || {};
            var code = keyCode(event);
            var a;
            var n;
            if (code) {
                for (a = 0; a < actions.length; a += 1) {
                    if (contains(map[actions[a][0]] || [], code)) { return actions[a][0]; }
                }
                for (n = 0; n < 10; n += 1) {
                    if (contains(map["digit" + n] || [], code)) { return "digit" + n; }
                }
            }
            return null;
        }

        function init(env, profile) {
            var selected = typeof profile === "string" ? profiles[profile] : profile;
            if (!selected || selected.id !== "samsung/tizen") { return function () {}; }
            var input = read(read(env, "tizen"), "tvinputdevice");
            var register = read(input, "registerKey");
            if (typeof register !== "function") { return function () {}; }
            var state = null;
            var n;
            for (n = 0; n < registrations.length; n += 1) {
                if (registrations[n].input === input) { state = registrations[n]; break; }
            }
            if (!state) {
                state = { input: input, refs: 0, registered: [] };
                registrations.push(state);
            }
            if (state.refs === 0) {
                for (n = 0; n < names.length; n += 1) {
                    if (contains(state.registered, names[n])) { continue; }
                    try { register.call(input, names[n]); state.registered.push(names[n]); }
                    catch (error) { /* Remaining supported keys still register. */ }
                }
            }
            state.refs += 1;
            var disposed = false;
            return function () {
                if (disposed) { return; }
                disposed = true;
                state.refs -= 1;
                if (state.refs > 0) { return; }
                var unregister = read(input, "unregisterKey");
                if (typeof unregister !== "function") { return; }
                var retained = [];
                for (var at = 0; at < state.registered.length; at += 1) {
                    try { unregister.call(input, state.registered[at]); }
                    catch (error) { retained.push(state.registered[at]); }
                }
                state.registered = retained;
            };
        }

        return { routeDocument: function (path) { return !!routeProfile(path) || /^\/f\/(?:lg|samsung)\/?$/.test(path); }, routeProfile: routeProfile, detect: detect, normalize: normalize, keyCode: keyCode, init: init, profiles: profiles };
    });
}(window));
