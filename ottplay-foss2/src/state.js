OTT2.define("state", function (require) {
    "use strict";
    var key = "ottplay2:state:v1", secureKey = "ottplay2:state:secure-v2", has = Object.prototype.hasOwnProperty;
    var core = OttPlayCore, fonts = core.browserStateFonts();
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function defaults() { return core.browserStateDefaults(require("security").defaults()); }
    function valid(value) { return core.validateBrowserState(value, require("security").defaults, require("security").validate); }
    function create(storage) {
        var data = defaults(), listeners = [], status = { persistent: true, error: "" }, canonical = false, canonicalRaw = "", legacyRaw = "", recovering = false;
        function guard() {
            var locked = defaults();
            locked.security.enabled = true;
            locked.security.salt = "upgraded-use-current-player";
            locked.security.hash = new Array(65).join("0");
            // A valid, deliberately unmatchable legacy verifier. No source data
            // remains in the old key, and every configuration scope stays locked.
            locked.security.iterations = 8192;
            return locked;
        }
        function writeChecked(name, value) {
            if (!storage) throw new Error("Storage unavailable");
            storage.setItem(name, value);
            if (storage.getItem(name) !== value) throw new Error("Storage read-back differed");
        }
        function envelope(value) { return JSON.stringify({ storageSchema: 2, state: value }); }
        function secureStorage() {
            if (recovering) throw new Error("Reload is required before modifying recovered settings");
            if (canonical && storage.getItem(secureKey) !== canonicalRaw) throw new Error("Settings changed in another tab; reload before writing");
            if (!canonical) {
                if (storage.getItem(secureKey) || (storage.getItem(key) || "") !== legacyRaw) throw new Error("Settings changed in another tab; reload before writing");
                // Preserve the unchanged PIN/state before modifying the old key.
                canonicalRaw = envelope(data);
                writeChecked(secureKey, canonicalRaw);
                canonical = true;
            }
            var locked = JSON.stringify(guard());
            if (!storage || storage.getItem(key) !== locked) writeChecked(key, locked);
        }
        try {
            var modern = storage && storage.getItem(secureKey), raw = storage && storage.getItem(key), parsed;
            legacyRaw = raw || "";
            if (modern) {
                parsed = JSON.parse(modern);
                if (!parsed || parsed.storageSchema !== 2 || !parsed.state) throw new Error("Unsupported secure storage");
                data = valid(parsed.state); canonical = true; canonicalRaw = modern;
                secureStorage();
            } else if (raw) data = valid(JSON.parse(raw));
            if (!modern && data.security.schema === 2) secureStorage();
            if (!storage) throw new Error("Storage unavailable");
        } catch (error) {
            // A failed read cannot prove the store is empty. Preserve a locked
            // recovery state even when the very first getItem throws.
            data = guard(); recovering = true;
            status = { persistent: false, error: "Settings require recovery; existing protection stays locked." };
        }
        function update(mutate, requireDurable) {
            var next = copy(data); mutate(next);
            next = core.pruneBrowserSources(data, next);
            next = valid(next);
            try {
                if (recovering) throw new Error("Reload is required before modifying recovered settings");
                if (canonical || requireDurable || next.security.schema === 2) {
                    secureStorage();
                    var nextRaw = envelope(next);
                    writeChecked(secureKey, nextRaw); canonicalRaw = nextRaw;
                } else {
                    if ((storage.getItem(key) || "") !== legacyRaw) throw new Error("Settings changed in another tab; reload before writing");
                    var legacyNext = JSON.stringify(next);
                    writeChecked(key, legacyNext); legacyRaw = legacyNext;
                }
                status = { persistent: true, error: "" };
            } catch (error) {
                status = { persistent: false, error: requireDurable ? "PIN change was not confirmed; reload before retrying." : "Settings are in memory; storage is unavailable or full." };
                if (requireDurable) throw error;
            }
            data = next;
            listeners.slice().forEach(function (listener) { listener(copy(data)); });
            return copy(data);
        }
        return {
            snapshot: function () { return copy(data); },
            status: function () { return copy(status); },
            update: update,
            updateSecurity: function (config) { update(function (next) { next.security = config; }, true); return true; },
            subscribe: function (listener) {
                listeners.push(listener);
                return function () { var i = listeners.indexOf(listener); if (i !== -1) listeners.splice(i, 1); };
            },
            importJSON: function (text) {
                var incoming = valid(JSON.parse(text));
                return update(function (next) { Object.keys(next).forEach(function (name) { delete next[name]; }); Object.keys(incoming).forEach(function (name) { next[name] = incoming[name]; }); }, true);
            },
            exportJSON: function (includeCredentials) {
                var result = core.exportBrowserState(data, !!includeCredentials);
                return JSON.stringify(result, null, 2);
            }
        };
    }
    return { create: create, validate: valid, defaults: defaults, fonts: fonts, key: key, secureKey: secureKey };
});
