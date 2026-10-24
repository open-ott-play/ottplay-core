OTT2.define("library", function () {
    "use strict";
    var core = OttPlayCore;
    function name(value) { return core.favoriteListName(value); }
    function channelReference(channel, sourceId) { return core.channelReference(channel, sourceId); }
    function restoreChannel(items, reference) { var index = core.restoreChannelIndex(items, reference); return index < 0 ? null : items[index]; }
    function decorate(items, overrides, includeHidden) { return core.libraryDecorate(items, overrides, !!includeHidden); }
    function renameList(state, oldName, newName) { core.favoriteListChange(state, "browser", "rename", oldName, newName); }
    function removeList(state, selected) { core.favoriteListChange(state, "browser", "delete", selected); }
    function moveFavorite(state, id, delta) { core.moveFavoriteSelection(state.favorites[state.activeFavorites], id, delta); }
    function edit(state, id, values) { state.channelOverrides[id] = core.libraryEdit(id, values); }
    function reminderId(channelId, start) { return core.libraryReminderId(channelId, start); }
    function toggleReminder(state, channel, programme) { state.reminders = core.libraryToggleReminder(state.reminders, channel, programme); }
    /* Input arrays are immutable snapshots; callers replace them or advance version after edits. */
    function createIndex() {
        var source = null, version, rows = [], visible = [], byId = Object.create(null), selections = Object.create(null);
        function update(items, overrides, revision) {
            if (source === items && version === revision) return;
            source = items; version = revision; rows = decorate(items, overrides, true);
            visible = rows.filter(function (row) { return !row.hidden; });
            byId = Object.create(null); selections = Object.create(null);
            rows.forEach(function (row) { if (!Object.prototype.hasOwnProperty.call(byId, row.id)) byId[row.id] = row; });
        }
        function select(screen, group, search, favorites) {
            var key = JSON.stringify([screen, group, search, favorites]), result, order = Object.create(null);
            if (Object.prototype.hasOwnProperty.call(selections, key)) return selections[key];
            (favorites || []).forEach(function (id, index) { order[id] = index; });
            result = rows.filter(function (row) {
                return !row.hidden && (screen === "favorites" ? Object.prototype.hasOwnProperty.call(order, row.id) :
                    screen === "vod" ? row.kind === "vod" || row.kind === "folder" : row.kind !== "vod" && row.kind !== "folder") &&
                    (!group || row.group === group) && (!search || row.name.toLowerCase().indexOf(search) >= 0);
            });
            if (screen === "favorites") result.sort(function (a, b) { return order[a.id] - order[b.id]; });
            /* Bound search history while retaining the current selection across page changes. */
            if (Object.keys(selections).length >= 16) selections = Object.create(null);
            selections[key] = result;
            return result;
        }
        return { update: update, select: select, get: function (id) { return byId[id] || null; },
            all: function (hidden) { return hidden ? rows : visible; } };
    }
    function createGuideSnapshot(lookup, identity) {
        var source, revision, catalog, snapshot, expires = 0, created = 0, records = Object.create(null);
        return function (rows, guide, now) {
            if (snapshot && catalog === rows && source === guide && revision === (guide && guide.version) && now >= created && now < expires) return snapshot;
            if (source !== guide || revision !== (guide && guide.version) || now < created) records = Object.create(null);
            source = guide; revision = guide && guide.version; catalog = rows; created = now; expires = Infinity;
            var retained = Object.create(null);
            snapshot = { now: {}, next: {}, logos: {}, matched: 0, current: 0, entries: [] };
            if (!guide) return snapshot;
            rows.forEach(function (row) {
                var record = records[row.id], key = identity ? identity(row) : row, info, entries, i, entry;
                if (!record || record.key !== key || now >= record.expires) {
                    info = lookup(row, now); entries = info.entries || [];
                    record = { key: key, info: info, expires: Infinity };
                    for (i = 0; i < entries.length; i++) {
                        entry = entries[i];
                        if (entry.start > now) record.expires = Math.min(record.expires, entry.start);
                        if (entry.end > now) record.expires = Math.min(record.expires, entry.end);
                    }
                    records[row.id] = record;
                }
                retained[row.id] = record;
                info = record.info; entries = info.entries || [];
                expires = Math.min(expires, record.expires);
                if (entries.length) snapshot.matched++;
                if (info.current) { snapshot.now[row.id] = info.current; snapshot.current++; }
                if (info.next) snapshot.next[row.id] = info.next;
                if (info.metadata && info.metadata.logo) snapshot.logos[row.id] = info.metadata.logo;
                snapshot.entries.push({ channel: row, programmes: entries });
            });
            records = retained;
            return snapshot;
        };
    }
    return { createIndex: createIndex, createGuideSnapshot: createGuideSnapshot, decorate: decorate, channelReference: channelReference, restoreChannel: restoreChannel, renameList: renameList, removeList: removeList, moveFavorite: moveFavorite, edit: edit, name: name, toggleReminder: toggleReminder, reminderId: reminderId };
});
