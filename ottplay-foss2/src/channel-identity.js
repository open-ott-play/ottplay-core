/* Reconcile source-bound saved selections before any catalog authorization.
 * Descriptors retain provider metadata and URL fingerprints, never stream URLs.
 */
OTT2.define("channel-identity", function (require) {
    "use strict";
    var library = require("library"), has = Object.prototype.hasOwnProperty, limit = 50000;
    function dictionary() { return Object.create(null); }
    function prefix(sourceId) { try { return encodeURIComponent(sourceId) + ":"; } catch (ignore) { return ""; } }
    function belongs(id, sourceId) { var value = prefix(sourceId); return !!value && typeof id === "string" && id.indexOf(value) === 0; }
    function text(value) { return typeof value === "string" ? value.replace(/^\s+|\s+$/g, "").slice(0, 512) : ""; }
    function normalized(value) { return text(value).replace(/\s+/g, " ").toLowerCase(); }
    function fingerprint(value) {
        var a = 2166136261, b = 5381, i;
        for (i = 0; i < value.length; i++) { a ^= value.charCodeAt(i); a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24); b = ((b << 5) + b) ^ value.charCodeAt(i); }
        return (a >>> 0).toString(16) + "-" + (b >>> 0).toString(16);
    }
    function descriptor(item, sourceId) {
        var ref = library.channelReference(item, sourceId);
        ref.kind = item.kind || "live";
        if (typeof item.url === "string" && item.url) ref.stream = fingerprint(item.url);
        return ref;
    }
    function used(state) {
        var result = dictionary();
        function add(id) { if (typeof id === "string" && id && id.length <= 4096) result[id] = true; }
        Object.keys(state.favorites || {}).forEach(function (key) { state.favorites[key].forEach(add); });
        Object.keys(state.channelOverrides || {}).forEach(add);
        Object.keys(state.bookmarks || {}).forEach(add);
        Object.keys(state.favoriteItems || {}).forEach(function (id) { add(id); (state.favoriteItems[id].parents || []).forEach(add); });
        (state.history || []).forEach(function (entry) { add(entry.id); });
        (state.reminders || []).forEach(function (entry) { add(entry.channelId); });
        (state.security.protectedIds || []).forEach(add);
        [state.lastChannel, state.previousChannel].forEach(function (ref) { if (ref) add(ref.id); });
        (state.playbackPreferences || []).forEach(function (entry) { add(entry.reference.id); });
        return result;
    }
    function remember(state, items, sourceId) {
        var needed = used(state), records = [], known = dictionary(), available = dictionary();
        items.forEach(function (item) { if (item && (!item.sourceId || item.sourceId === sourceId)) available[item.id] = item; });
        (state.channelReferences || []).forEach(function (ref) {
            if (!needed[ref.id]) return;
            if (ref.sourceId === sourceId && available[ref.id]) ref = descriptor(available[ref.id], sourceId);
            if (!known[ref.id]) { known[ref.id] = true; records.push(ref); }
        });
        Object.keys(needed).forEach(function (id) { if (!known[id] && available[id]) { known[id] = true; records.push(descriptor(available[id], sourceId)); } });
        // Keep protection descriptors first if unusually large imported stores reach the cap.
        var protectedIds = dictionary(); state.security.protectedIds.forEach(function (id) { protectedIds[id] = true; });
        state.channelReferences = records.filter(function (ref) { return protectedIds[ref.id]; }).concat(records.filter(function (ref) { return !protectedIds[ref.id]; })).slice(0, limit);
    }
    function indexItems(items, sourceId) {
        var result = { id: dictionary(), tvg: dictionary(), name: dictionary(), tvgName: dictionary(), stream: dictionary(), all: [] };
        function put(map, key, item) { if (key) (map[key] || (map[key] = [])).push(item); }
        items.forEach(function (item) {
            if (!item || (item.sourceId && item.sourceId !== sourceId)) return;
            result.all.push(item); put(result.id, item.id, item); put(result.tvg, text(item.tvgId), item);
            put(result.name, normalized(item.name), item); put(result.tvgName, normalized(item.tvgName), item);
            if (typeof item.url === "string" && item.url) put(result.stream, fingerprint(item.url), item);
        });
        return result;
    }
    function legacy(ref) {
        var start = prefix(ref.sourceId) + "m3u:tvg:", value;
        if (ref.id.indexOf(start) !== 0) return "";
        value = ref.id.slice(start.length);
        if (!/^[^:]+(?::[0-9a-f]+-[0-9a-f]+)?$/i.test(value)) return "";
        try { return text(decodeURIComponent(value.replace(/:[0-9a-f]+-[0-9a-f]+$/i, ""))); } catch (ignore) { return ""; }
    }
    function candidates(index, ref) {
        var tvg = text(ref.tvgId) || legacy(ref), rows = tvg && index.tvg[tvg];
        if (!rows || !rows.length) rows = index.name[normalized(ref.name)] || index.tvgName[normalized(ref.tvgName)] || [];
        return rows.filter(function (item) { return !ref.kind || (item.kind || "live") === ref.kind; });
    }
    function resolve(index, ref) {
        var exact = index.id[ref.id], stream = ref.stream && index.stream[ref.stream], rows, copies, matched;
        if (exact && exact.length === 1) return exact[0];
        if (ref.kind === "folder") return null;
        if (stream) {
            stream = stream.filter(function (item) { return !ref.kind || (item.kind || "live") === ref.kind; });
            if (stream.length === 1) return stream[0];
        }
        rows = candidates(index, ref);
        copies = rows.map(function (item) { var copy = {}; Object.keys(item).forEach(function (key) { copy[key] = item[key]; }); copy.kind = "live"; return copy; });
        matched = library.restoreChannel(copies, ref);
        if (!matched) return null;
        return (index.id[matched.id] || []).length === 1 ? index.id[matched.id][0] : null;
    }
    function move(state, mapping, rows) {
        function id(value) { return has.call(mapping, value) ? mapping[value] : value; }
        function ids(values) { var seen = dictionary(); return values.map(id).filter(function (value) { if (seen[value]) return false; seen[value] = true; return true; }); }
        Object.keys(state.favorites).forEach(function (key) { state.favorites[key] = ids(state.favorites[key]); });
        state.security.protectedIds = ids(state.security.protectedIds);
        ["channelOverrides", "bookmarks", "favoriteItems"].forEach(function (field) {
            var target = state[field];
            Object.keys(mapping).forEach(function (old) {
                var next = mapping[old], value = target[old]; if (!has.call(target, old) || old === next) return;
                if (!has.call(target, next)) target[next] = value;
                else if (field === "channelOverrides") {
                    if (value.hidden) target[next].hidden = true;
                    ["name", "group", "order"].forEach(function (key) { if (!has.call(target[next], key) && has.call(value, key)) target[next][key] = value[key]; });
                }
                delete target[old];
            });
        });
        Object.keys(state.favoriteItems).forEach(function (key) { state.favoriteItems[key].parents = state.favoriteItems[key].parents.map(id); });
        var historySeen = dictionary();
        state.history = state.history.filter(function (entry) { entry.id = id(entry.id); if (historySeen[entry.id]) return false; historySeen[entry.id] = true; return true; });
        var reminderSeen = dictionary();
        state.reminders = state.reminders.filter(function (entry) { entry.channelId = id(entry.channelId); entry.id = library.reminderId(entry.channelId, entry.start); if (reminderSeen[entry.id]) return false; reminderSeen[entry.id] = true; return true; });
        function reference(ref) { return ref && mapping[ref.id] ? library.channelReference(rows[mapping[ref.id]], ref.sourceId) : ref; }
        state.lastChannel = reference(state.lastChannel); state.previousChannel = reference(state.previousChannel);
        var preferenceSeen = dictionary();
        state.playbackPreferences = state.playbackPreferences.filter(function (entry) { entry.reference = reference(entry.reference); var key = entry.reference.sourceId + "\n" + entry.reference.id; if (preferenceSeen[key]) return false; preferenceSeen[key] = true; return true; });
        state.channelReferences = (state.channelReferences || []).map(function (ref) { return mapping[ref.id] ? descriptor(rows[mapping[ref.id]], ref.sourceId) : ref; });
    }
    function reconcile(state, items, sourceId) {
        var index = indexItems(items, sourceId), needed = used(state), refs = dictionary(), mapping = dictionary(), targetRows = dictionary();
        var report = { changed: false, aliases: dictionary(), blocked: [], unresolved: 0 }, protectedIds = dictionary();
        state.security.protectedIds.forEach(function (id) { protectedIds[id] = true; });
        (state.channelReferences || []).forEach(function (ref) { if (ref.sourceId === sourceId) refs[ref.id] = ref; });
        [state.lastChannel, state.previousChannel].concat(state.playbackPreferences.map(function (entry) { return entry.reference; })).forEach(function (ref) { if (ref && ref.sourceId === sourceId && !refs[ref.id]) refs[ref.id] = ref; });
        Object.keys(needed).forEach(function (id) {
            if (!refs[id] && belongs(id, sourceId)) {
                var ref = { sourceId: sourceId, id: id };
                // History records predate raw descriptors and may contain custom names.
                // They are a narrowing hint, never grounds for selecting another variant.
                for (var i = 0; i < state.history.length; i++) if (state.history[i].id === id) {
                    var custom = state.channelOverrides[id] && state.channelOverrides[id].name;
                    if (!custom || normalized(custom) !== normalized(state.history[i].name)) ref.name = state.history[i].name;
                    break;
                }
                refs[id] = ref;
            }
        });
        Object.keys(refs).forEach(function (id) {
            if (!needed[id]) return;
            var ref = refs[id], matched = resolve(index, ref), plausible;
            if (matched) {
                if (matched.id !== id) { mapping[id] = matched.id; targetRows[matched.id] = matched; report.changed = true; }
                return;
            }
            if (index.id[id]) return;
            report.unresolved++;
            if (!protectedIds[id]) return;
            plausible = candidates(index, ref);
            // A provider can renumber one variant while retaining its siblings.
            // Protect every named candidate even when the old TVG ID still exists.
            var possibleNames = (index.name[normalized(ref.name)] || []).concat(index.tvgName[normalized(ref.tvgName)] || []);
            possibleNames.forEach(function (item) { if (plausible.indexOf(item) < 0 && (!ref.kind || (item.kind || "live") === ref.kind)) plausible.push(item); });
            if (!plausible.length) report.blocked.push(id);
            plausible.forEach(function (item) { (report.aliases[item.id] || (report.aliases[item.id] = [])).push(id); });
        });
        if (report.changed) move(state, mapping, targetRows);
        var before = JSON.stringify(state.channelReferences || []);
        remember(state, items, sourceId);
        if (before !== JSON.stringify(state.channelReferences)) report.changed = true;
        return report;
    }
    function permission(report, id, protectedIds) {
        if (!report) return id;
        var candidates = (report.aliases[id] || []).concat(report.blocked), i;
        for (i = 0; i < candidates.length; i++) if (protectedIds.indexOf(candidates[i]) !== -1) return candidates[i];
        return id;
    }
    return { remember: remember, reconcile: reconcile, permission: permission, descriptor: descriptor, limit: limit };
});
