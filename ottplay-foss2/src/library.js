OTT2.define("library", function () {
    "use strict";
    var has = Object.prototype.hasOwnProperty;
    function key(value) { return typeof value === "string" && value.length > 0 && value.length < 160 && ["__proto__", "constructor", "prototype"].indexOf(value) < 0; }
    function name(value) { var text = String(value || "").replace(/^\s+|\s+$/g, ""); if (!key(text)) throw new Error("Invalid name"); return text; }
    function copy(item) { var result = {}; Object.keys(item).forEach(function (field) { result[field] = item[field]; }); return result; }
    function referenceText(value) { return typeof value === "string" ? value.replace(/^\s+|\s+$/g, "").slice(0, 512) : ""; }
    function matchName(value) { return referenceText(value).replace(/\s+/g, " ").toLowerCase(); }
    function channelReference(channel, sourceId) {
        var result = { sourceId: sourceId || channel.sourceId, id: channel.id };
        ["tvgId", "tvgName", "name", "group"].forEach(function (field) {
            var value = referenceText(channel[field]);
            if (value) result[field] = value;
        });
        return result;
    }
    function legacyTvgId(reference) {
        var prefix, value;
        try {
            prefix = encodeURIComponent(reference.sourceId) + ":m3u:tvg:";
            if (reference.id.indexOf(prefix) !== 0) return "";
            value = reference.id.slice(prefix.length);
            // Colons in a provider ID are escaped; only variant hashes add a delimiter.
            if (!/^[^:]+(?::[0-9a-f]+-[0-9a-f]+)?$/i.test(value)) return "";
            return referenceText(decodeURIComponent(value.replace(/:[0-9a-f]+-[0-9a-f]+$/i, "")));
        } catch (ignore) { return ""; }
    }
    function restoreChannel(items, reference) {
        if (!reference || typeof reference.sourceId !== "string" || typeof reference.id !== "string") return null;
        var available = items.filter(function (item) {
            return item && item.kind === "live" && (!item.sourceId || item.sourceId === reference.sourceId);
        });
        var matches = available.filter(function (item) { return item.id === reference.id; });
        var legacyId = legacyTvgId(reference), tvgId = referenceText(reference.tvgId) || legacyId, names = ["name", "tvgName"], i;
        var wasVariant = !!legacyId && /:[0-9a-f]+-[0-9a-f]+$/i.test(reference.id);
        if (matches.length) return matches.length === 1 ? matches[0] : null;
        var variantField = matchName(reference.name) ? "name" : "tvgName";
        var variantName = matchName(reference[variantField]);
        if (wasVariant && !variantName) return null;
        function equivalentCopy(candidates) {
            if (candidates.length < 2 || !legacyId || !tvgId || !matchName(reference.name)) return null;
            var first = candidates[0], fields = Object.keys(first).filter(function (field) { return field !== "id" && field !== "url"; }).sort();
            if (matchName(first.name) !== matchName(reference.name)) return null;
            for (var c = 0; c < candidates.length; c++) {
                var item = candidates[c], keys = Object.keys(item).filter(function (field) { return field !== "id" && field !== "url"; }).sort();
                if (referenceText(item.tvgId) !== tvgId || legacyTvgId({ sourceId: reference.sourceId, id: item.id }) !== tvgId || keys.length !== fields.length) return null;
                for (var k = 0; k < fields.length; k++) {
                    var field = fields[k];
                    if (keys[k] !== field || typeof item[field] !== typeof first[field]) return null;
                    try { if (JSON.stringify(item[field]) !== JSON.stringify(first[field])) return null; }
                    catch (ignore) { return null; }
                }
            }
            // A playlist may publish several URLs for the same broadcast. All
            // other metadata must agree, including future playback attributes.
            return first;
        }
        function narrow(candidates) {
            var value, selected, field;
            for (var n = 0; n < names.length && candidates.length > 1; n++) {
                field = names[n]; value = matchName(reference[field]);
                if (!value) continue;
                selected = candidates.filter(function (item) { return matchName(item[field]) === value; });
                if (selected.length) candidates = selected;
            }
            value = matchName(reference.group);
            if (value && candidates.length > 1) {
                selected = candidates.filter(function (item) { return matchName(item.group) === value; });
                if (selected.length) candidates = selected;
            }
            return candidates.length === 1 ? candidates[0] : equivalentCopy(candidates);
        }
        if (tvgId) {
            matches = available.filter(function (item) { return referenceText(item.tvgId) === tvgId; });
            if (matches.length) {
                if (wasVariant) {
                    // A shared TVG ID can outlive the selected HD or regional stream.
                    // Its remaining variants must still match the saved station name.
                    matches = matches.filter(function (item) { return matchName(item[variantField]) === variantName; });
                }
                return narrow(matches);
            }
        }
        // A source may rotate proxy IDs together with its stream URLs. Names retain
        // quality and regional suffixes, and ambiguous matches never pick a row.
        for (i = 0; i < names.length; i++) {
            var field = names[i], value = matchName(reference[field]);
            if (wasVariant && field !== variantField) continue;
            if (!value) continue;
            matches = available.filter(function (item) { return matchName(item[field]) === value; });
            if (matches.length) return narrow(matches);
        }
        return null;
    }
    function decorate(items, overrides, includeHidden) {
        return items.map(function (item, index) {
            var result = copy(item), change = has.call(overrides, item.id) ? overrides[item.id] : {};
            result.name = change.name || item.name; result.group = typeof change.group === "string" ? change.group : item.group;
            result.hidden = change.hidden === true; result.order = typeof change.order === "number" ? change.order : index;
            result.originalIndex = index; return result;
        }).filter(function (item) { return includeHidden || !item.hidden; }).sort(function (a, b) { return a.order - b.order || a.originalIndex - b.originalIndex; });
    }
    function renameList(state, oldName, newName) {
        newName = name(newName);
        if (!has.call(state.favorites, oldName)) throw new Error("Unknown list");
        if (newName === oldName) return;
        if (has.call(state.favorites, newName)) throw new Error("List already exists");
        state.favorites[newName] = state.favorites[oldName].slice();
        if (oldName === "default") state.favorites.default = []; else delete state.favorites[oldName];
        state.activeFavorites = newName;
    }
    function removeList(state, selected) {
        if (selected === "default") state.favorites.default = []; else delete state.favorites[selected];
        if (state.activeFavorites === selected) state.activeFavorites = "default";
    }
    function moveFavorite(state, id, delta) {
        var items = state.favorites[state.activeFavorites], from = items.indexOf(id), to = from + delta;
        if (from < 0 || to < 0 || to >= items.length) return;
        items.splice(from, 1); items.splice(to, 0, id);
    }
    function edit(state, id, values) {
        if (typeof id !== "string" || !id || id.length > 4096 || ["__proto__", "constructor", "prototype"].indexOf(id) >= 0) throw new Error("Invalid channel ID");
        state.channelOverrides[id] = { name: String(values.name || "").slice(0, 160), group: String(values.group || "").slice(0, 160), hidden: values.hidden === true, order: Math.max(0, Math.min(50000, Number(values.order) || 0)) };
    }
    function reminderId(channelId, start) { return channelId + "@" + start; }
    function toggleReminder(state, channel, programme) {
        var id = reminderId(channel.id, programme.start), removed = false;
        state.reminders = state.reminders.filter(function (item) { if (item.id === id) { removed = true; return false; } return true; });
        if (!removed) state.reminders.push({ id: id, channelId: channel.id, title: programme.title, start: programme.start, end: programme.end });
        state.reminders = state.reminders.slice(-500);
    }
    return { decorate: decorate, channelReference: channelReference, restoreChannel: restoreChannel, renameList: renameList, removeList: removeList, moveFavorite: moveFavorite, edit: edit, name: name, toggleReminder: toggleReminder, reminderId: reminderId };
});
