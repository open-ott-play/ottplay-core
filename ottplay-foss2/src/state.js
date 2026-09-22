OTT2.define("state", function (require) {
    "use strict";
    var key = "ottplay2:state:v1", has = Object.prototype.hasOwnProperty;
    var fonts = ["system", "Roboto", "RobotoCondensed", "Caveat", "Liberation", "Gabriela", "PTSansNarrow"];
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function defaults() {
        return { schema: 1, sources: [], activeSourceId: "", lastChannel: null, previousChannel: null, playbackPreferences: [], channelReferences: [], favorites: { default: [] }, activeFavorites: "default",
            history: [], bookmarks: {}, channelOverrides: {}, favoriteItems: {}, reminders: [], security: require("security").defaults(), settings: { language: "en", interfaceVersion: 2, startupVersion: 1, fontFamily: "RobotoCondensed", playerEngine: "auto", streamFormat: "auto", fontScale: 1, volume: 0.8, muted: false, epgUrl: "", epgUrls: [], restore: true, accent: "amber", aspect: "auto", zoom: 1, relay: false } };
    }
    function safeKey(name) { return typeof name === "string" && name.length > 0 && name.length < 160 && name !== "__proto__" && name !== "constructor" && name !== "prototype"; }
    function channelKey(name) { return typeof name === "string" && name.length > 0 && name.length <= 4096 && name !== "__proto__" && name !== "constructor" && name !== "prototype"; }
    function valid(value) {
        if (!value || value.schema !== 1 || !Array.isArray(value.sources)) throw new Error("Unsupported settings format");
        var result = defaults(), seen = {}, i, source, name, list;
        if (value.sources.length > 100) throw new Error("Too many sources");
        for (i = 0; i < value.sources.length; i++) {
            source = value.sources[i];
            if (!source || !safeKey(source.id) || has.call(seen, source.id) || ["m3u", "xtream", "stalker"].indexOf(source.type) === -1) throw new Error("Invalid source");
            if (typeof source.url !== "string" || (source.url && !/^https?:\/\//i.test(source.url))) throw new Error("Invalid source URL");
            if (has.call(source, "text") && (typeof source.text !== "string" || source.text.length > 10 * 1024 * 1024 || (source.text && source.type !== "m3u"))) throw new Error("Invalid playlist content");
            seen[source.id] = true;
            result.sources.push({ id: source.id, name: String(source.name || source.id).slice(0, 160), type: source.type, url: source.url,
                text: source.text || "", username: String(source.username || ""), password: String(source.password || ""), mac: String(source.mac || ""), timezone: String(source.timezone || "UTC").slice(0, 100), language: String(source.language || "en").slice(0, 10), output: source.output === "ts" ? "ts" : "m3u8" });
        }
        result.activeSourceId = has.call(seen, value.activeSourceId) ? value.activeSourceId : (result.sources[0] ? result.sources[0].id : "");
        function reference(input) {
            if (!input || typeof input !== "object" || Array.isArray(input) || !safeKey(input.sourceId) || !has.call(seen, input.sourceId) || !channelKey(input.id)) return null;
            var owner = input.id.split(":")[0];
            try { owner = decodeURIComponent(owner); } catch (ignore) {}
            if (input.id.indexOf(":") !== -1 && has.call(seen, owner) && owner !== input.sourceId) return null;
            var output = { sourceId: input.sourceId, id: input.id };
            ["tvgId", "tvgName", "name", "group"].forEach(function (field) {
                var metadata = input[field];
                if (typeof metadata === "string") {
                    metadata = metadata.replace(/^\s+|\s+$/g, "").slice(0, 512);
                    if (metadata) output[field] = metadata;
                }
            });
            return output;
        }
        var referenceIds = Object.create(null);
        if (Array.isArray(value.channelReferences)) value.channelReferences.slice(0, 50000).forEach(function (entry) {
            var ref = reference(entry);
            if (!ref || referenceIds[ref.id]) return;
            referenceIds[ref.id] = true;
            if (["live", "vod", "folder"].indexOf(entry.kind) !== -1) ref.kind = entry.kind;
            if (typeof entry.stream === "string" && /^[0-9a-f]{1,8}-[0-9a-f]{1,8}$/.test(entry.stream)) ref.stream = entry.stream;
            result.channelReferences.push(ref);
        });
        result.lastChannel = reference(value.lastChannel);
        result.previousChannel = reference(value.previousChannel);
        function track(input) {
            if (!input || typeof input !== "object" || Array.isArray(input)) return null;
            if (input.off === true) return { off: true };
            var output = { language: typeof input.language === "string" ? input.language.slice(0, 80) : "", label: typeof input.label === "string" ? input.label.slice(0, 160) : "" };
            if (/^\d{1,4}$/.test(String(input.id)) && ["native", "hls.js", "shaka", "mpegts"].indexOf(input.backend) !== -1) { output.id = String(input.id); output.backend = input.backend; }
            return output.language || output.label || output.id ? output : null;
        }
        if (Array.isArray(value.playbackPreferences)) value.playbackPreferences.slice(0, 200).forEach(function (entry) {
            if (!entry || typeof entry !== "object") return;
            var ref = reference(entry.reference), audio = track(entry.audio), subtitle = track(entry.subtitle), output;
            if (!ref || result.playbackPreferences.some(function (item) { return item.reference.sourceId === ref.sourceId && item.reference.id === ref.id; })) return;
            output = { reference: ref };
            if (audio && !audio.off) output.audio = audio;
            if (subtitle) output.subtitle = subtitle;
            if (["auto", "16:9", "4:3", "fill"].indexOf(entry.aspect) !== -1) output.aspect = entry.aspect;
            if ([1, 1.1, 1.25, 1.5].indexOf(entry.zoom) !== -1) output.zoom = entry.zoom;
            result.playbackPreferences.push(output);
        });
        if (value.favorites && typeof value.favorites === "object" && !Array.isArray(value.favorites)) {
            for (name in value.favorites) if (has.call(value.favorites, name) && safeKey(name)) {
                list = value.favorites[name];
                if (!Array.isArray(list) || list.length > 50000) throw new Error("Invalid favorites");
                result.favorites[name] = list.filter(function (id, index, array) { return typeof id === "string" && id.length < 4096 && array.indexOf(id) === index; });
            }
        }
        result.activeFavorites = has.call(result.favorites, value.activeFavorites) ? value.activeFavorites : "default";
        if (Array.isArray(value.history)) result.history = value.history.filter(function (item) { return item && typeof item.id === "string" && typeof item.name === "string" && typeof item.time === "number" && isFinite(item.time); }).slice(0, 100).map(function (item) { return { id: item.id, name: item.name, time: item.time }; });
        if (value.bookmarks && typeof value.bookmarks === "object") for (name in value.bookmarks) {
            if (has.call(value.bookmarks, name) && channelKey(name) && typeof value.bookmarks[name] === "number" && isFinite(value.bookmarks[name]) && value.bookmarks[name] >= 0) result.bookmarks[name] = value.bookmarks[name];
        }
        if (value.security) result.security = require("security").validate(value.security);
        if (value.channelOverrides && typeof value.channelOverrides === "object") Object.keys(value.channelOverrides).slice(0, 50000).forEach(function (id) {
            var entry = value.channelOverrides[id];
            if (!channelKey(id) || !entry || typeof entry !== "object") return;
            var row = { hidden: entry.hidden === true };
            if (typeof entry.name === "string") row.name = entry.name.slice(0, 160);
            if (typeof entry.group === "string") row.group = entry.group.slice(0, 160);
            if (typeof entry.order === "number" && isFinite(entry.order)) row.order = Math.max(0, Math.min(50000, entry.order));
            result.channelOverrides[id] = row;
        });
        if (value.favoriteItems && typeof value.favoriteItems === "object") Object.keys(value.favoriteItems).slice(0, 10000).forEach(function (id) {
            var entry = value.favoriteItems[id];
            if (!channelKey(id) || !entry || !safeKey(entry.sourceId) || typeof entry.name !== "string" || !Array.isArray(entry.parents) || entry.parents.length > 20 || !entry.parents.every(channelKey)) return;
            result.favoriteItems[id] = { name: entry.name.slice(0, 160), sourceId: entry.sourceId, parents: entry.parents.slice() };
        });
        if (Array.isArray(value.reminders)) result.reminders = value.reminders.filter(function (entry) {
            return entry && typeof entry.id === "string" && entry.id.length <= 4130 && channelKey(entry.channelId) && typeof entry.title === "string" && typeof entry.start === "number" && isFinite(entry.start) && typeof entry.end === "number" && isFinite(entry.end) && entry.end > entry.start;
        }).slice(-500).map(function (entry) { return { id: entry.id, channelId: entry.channelId, title: entry.title.slice(0, 500), start: entry.start, end: entry.end }; });
        var settings = value.settings || {};
        result.settings.language = settings.language === "ru" ? "ru" : "en";
        result.settings.fontFamily = fonts.indexOf(settings.fontFamily) !== -1 ? settings.fontFamily : "RobotoCondensed";
        if (!settings.interfaceVersion && result.settings.fontFamily === "system") result.settings.fontFamily = "RobotoCondensed";
        result.settings.playerEngine = ["auto", "native", "hls.js", "shaka", "mpegts"].indexOf(settings.playerEngine) >= 0 ? settings.playerEngine : "auto";
        result.settings.streamFormat = ["auto", "hls", "dash", "mpegts", "flv", "file"].indexOf(settings.streamFormat) >= 0 ? settings.streamFormat : "auto";
        result.settings.fontScale = [0.85, 1, 1.15, 1.3].indexOf(settings.fontScale) !== -1 ? settings.fontScale : 1;
        result.settings.volume = typeof settings.volume === "number" && isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : 0.8;
        result.settings.muted = settings.muted === true;
        // Enable startup playback once for settings saved before this preference became the default.
        result.settings.restore = settings.startupVersion !== 1 || settings.restore !== false;
        result.settings.relay = settings.relay === true;
        result.settings.accent = ["amber", "blue", "green"].indexOf(settings.accent) >= 0 ? settings.accent : "amber";
        result.settings.aspect = ["auto", "16:9", "4:3", "fill"].indexOf(settings.aspect) >= 0 ? settings.aspect : "auto";
        result.settings.zoom = [1, 1.1, 1.25, 1.5].indexOf(settings.zoom) >= 0 ? settings.zoom : 1;
        result.settings.epgUrls = Array.isArray(settings.epgUrls) ? settings.epgUrls.filter(function (url, index, all) { return typeof url === "string" && /^https?:\/\//i.test(url) && all.indexOf(url) === index; }).slice(0, 10) : [];
        result.settings.epgUrl = typeof settings.epgUrl === "string" && /^https?:\/\//i.test(settings.epgUrl) ? settings.epgUrl : "";
        return result;
    }
    function create(storage) {
        var data = defaults(), listeners = [], status = { persistent: true, error: "" };
        try {
            var raw = storage && storage.getItem(key);
            if (raw) data = valid(JSON.parse(raw));
            if (!storage) throw new Error("Storage unavailable");
        } catch (error) { status = { persistent: false, error: "Settings could not be read; defaults are in memory." }; }
        function update(mutate) {
            var next = copy(data); mutate(next);
            // Removing a source removes its namespaced selections and durable records.
            // Other sources and legacy selections without a known source stay intact.
            data.sources.forEach(function (source) {
                if (!Array.isArray(next.sources) || next.sources.some(function (entry) { return entry && entry.id === source.id; })) return;
                var prefix = encodeURIComponent(source.id) + ":", owned = Object.create(null);
                (data.channelReferences || []).forEach(function (ref) { if (ref.sourceId === source.id) owned[ref.id] = true; });
                Object.keys(data.favoriteItems || {}).forEach(function (id) { if (data.favoriteItems[id].sourceId === source.id) owned[id] = true; });
                function keep(id) { return typeof id !== "string" || (id.indexOf(prefix) !== 0 && !owned[id]); }
                Object.keys(next.favorites || {}).forEach(function (name) { if (Array.isArray(next.favorites[name])) next.favorites[name] = next.favorites[name].filter(keep); });
                ["bookmarks", "channelOverrides", "favoriteItems"].forEach(function (field) { Object.keys(next[field] || {}).forEach(function (id) { if (!keep(id)) delete next[field][id]; }); });
                if (Array.isArray(next.history)) next.history = next.history.filter(function (entry) { return keep(entry.id); });
                if (Array.isArray(next.reminders)) next.reminders = next.reminders.filter(function (entry) { return keep(entry.channelId); });
                if (next.security && Array.isArray(next.security.protectedIds)) next.security.protectedIds = next.security.protectedIds.filter(keep);
            });
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
                var result = copy(data);
                if (!includeCredentials) {
                    // Playlist bodies, all source URLs and XMLTV URLs may contain secrets.
                    result.sources = [];
                    result.activeSourceId = "";
                    result.lastChannel = null;
                    result.previousChannel = null;
                    result.playbackPreferences = [];
                    result.channelReferences = [];
                    result.settings.epgUrl = "";
                    result.settings.epgUrls = [];
                }
                return JSON.stringify(result, null, 2);
            }
        };
    }
    return { create: create, validate: valid, defaults: defaults, fonts: fonts, key: key };
});
