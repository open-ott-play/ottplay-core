OTT2.define("state", function (require) {
    "use strict";
    var key = "ottplay2:state:v1", has = Object.prototype.hasOwnProperty;
    var core = OttPlayCore, fonts = core.browserStateFonts();
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function defaults() { return core.browserStateDefaults(require("security").defaults()); }
    function valid(value) { return core.validateBrowserState(value, require("security").defaults, require("security").validate); }
    function create(storage) {
        var data = defaults(), listeners = [], status = { persistent: true, error: "" };
        try {
            var raw = storage && storage.getItem(key);
            if (raw) data = valid(JSON.parse(raw));
            if (!storage) throw new Error("Storage unavailable");
        } catch (error) { status = { persistent: false, error: "Settings could not be read; defaults are in memory." }; }
        function update(mutate) {
            var next = copy(data); mutate(next);
            next = core.pruneBrowserSources(data, next);
            next = valid(next);
            try {
                if (!storage) throw new Error("Storage unavailable");
                storage.setItem(key, JSON.stringify(next)); status = { persistent: true, error: "" };
            } catch (error) { status = { persistent: false, error: "Settings are in memory; storage is unavailable or full." }; }
            data = next;
            listeners.slice().forEach(function (listener) { listener(copy(data)); });
            return copy(data);
        }
        return {
            snapshot: function () { return copy(data); },
            status: function () { return copy(status); },
            update: update,
            subscribe: function (listener) {
                listeners.push(listener);
                return function () { var i = listeners.indexOf(listener); if (i !== -1) listeners.splice(i, 1); };
            },
            importJSON: function (text) {
                var incoming = valid(JSON.parse(text));
                return update(function (next) { Object.keys(next).forEach(function (name) { delete next[name]; }); Object.keys(incoming).forEach(function (name) { next[name] = incoming[name]; }); });
            },
            exportJSON: function (includeCredentials) {
                var result = core.exportBrowserState(data, !!includeCredentials);
                return JSON.stringify(result, null, 2);
            }
        };
    }
    return { create: create, validate: valid, defaults: defaults, fonts: fonts, key: key };
});
