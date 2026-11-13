// Characterization fixture only; not a production runtime.
// Source: open-ott-play/ottplay-foss@9336a40ccd4e8e0e84571b037c2d2b49e8b0aaaa:src/channels/library.ts
// Source port: candidate; SHA-256 bfe5a2b2e9bdc148bac6def69576da06dd0255b3726e737ef83386bead1e3aa9
// Transpiler: TypeScript 5.9.3, target ES5, module CommonJS (script has no imports or exports).
function createChannelLibrary(ports, catalog) {
    var key = "channelLibrary:" + ports.sourceId;
    var libraryCore = window.OttPlayCore;
    if (!libraryCore || libraryCore.classicChannelLibraryApiVersion() !== 1)
        throw new Error("Classic channel library core API is unavailable");
    var items = Object.create(null);
    var ids = Object.create(null);
    var aliases = Object.create(null);
    var provider = [];
    var providerById = Object.create(null);
    var providerMembers = Object.create(null);
    var writable = true;
    var readFailed = false;
    function raw(name) {
        try {
            return ports.get(name);
        }
        catch (_) {
            readFailed = true;
            return null;
        }
    }
    function addProviderMemberships(row) {
        var memberships = row.groups && row.groups.length
            ? row.groups
            : [{ id: row.groupId, label: row.groupLabel }];
        var seen = Object.create(null);
        memberships.forEach(function (membership) {
            if (!membership ||
                typeof membership.id !== "string" ||
                (row.groups &&
                    (!membership.id ||
                        membership.id.indexOf("system:") === 0)) ||
                typeof membership.label !== "string" ||
                seen[membership.id])
                return;
            seen[membership.id] = true;
            var group = providerById[membership.id];
            if (!group) {
                group = {
                    id: membership.id,
                    label: membership.label,
                    members: [],
                };
                providerById[membership.id] = group;
                providerMembers[membership.id] = Object.create(null);
                provider.push(group);
            }
            if (!providerMembers[membership.id][row.itemId]) {
                providerMembers[membership.id][row.itemId] = true;
                group.members.push(row.itemId);
            }
        });
    }
    catalog.forEach(function (row) {
        if (items[row.itemId])
            return;
        items[row.itemId] = { id: row.id };
        ids[String(row.id)] = row.itemId;
        if (row.legacyId !== undefined) {
            var alias = String(row.legacyId);
            aliases[alias] =
                aliases[alias] === undefined || aliases[alias] === row.itemId
                    ? row.itemId
                    : null;
        }
        addProviderMemberships(row);
    });
    provider.unshift({
        id: "system:all",
        label: "",
        members: catalog.map(function (row) {
            return row.itemId;
        }),
    });
    providerById["system:all"] = provider[0];
    function groupById(values, id) {
        for (var i = 0; i < values.length; i++)
            if (values[i].id === id)
                return values[i];
        return undefined;
    }
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }
    function unique(value, excluded) {
        var seen = Object.create(null);
        if (excluded)
            excluded.forEach(function (id) {
                seen[id] = true;
            });
        return Array.isArray(value)
            ? value.filter(function (id) {
                if (typeof id !== "string" || seen[id])
                    return false;
                seen[id] = true;
                return true;
            })
            : [];
    }
    function read(name) {
        try {
            return JSON.parse(raw(name) || "null");
        }
        catch (_) {
            return null;
        }
    }
    function translateIds(values) {
        return unique(Array.isArray(values)
            ? values.map(function (id) {
                return resolve("unresolved:" + String(id));
            })
            : []);
    }
    function resolve(id) {
        if (id.indexOf("unresolved:") !== 0)
            return id;
        var previous = id.slice(11);
        var current = ids[previous];
        var alias = aliases[previous];
        // Old storage may already contain migrated numbers; neither namespace wins a collision.
        if (alias === null || (alias && current && alias !== current))
            return id;
        return alias || current || id;
    }
    function catalogLocks() {
        return catalog.filter(function (row) { return row.locked; })
            .map(function (row) { return row.itemId; });
    }
    function empty() {
        return libraryCore.classicChannelLibraryEmpty(ports.sourceId, catalogLocks());
    }
    function decode(value) {
        return libraryCore.classicChannelLibraryDecode(value, ports.sourceId, catalogLocks());
    }
    var stored = raw(key);
    var state = stored ? decode(read(key)) : null;
    if (!state) {
        state = empty();
        writable = !stored;
        var claim = raw("channelLibrarySource");
        if (writable && (!claim || claim === ports.sourceId)) {
            var oldGroups = read("cats");
            var order = read("catsArray");
            var selection = ports.legacySelection;
            var virtual = ["All", "Favorites", "Все", "Усе"].concat(selection ? selection.virtualLabels : []);
            if (oldGroups && Array.isArray(order))
                order.forEach(function (name) {
                    if (typeof name !== "string" ||
                        virtual.indexOf(name) >= 0 ||
                        !Array.isArray(oldGroups[name]))
                        return;
                    var known = provider.filter(function (group) {
                        return group.label === name;
                    });
                    state.groups.push({
                        id: known.length === 1
                            ? known[0].id
                            : "user:" + state.nextGroup++,
                        inheritsMembers: known.length === 1 &&
                            JSON.stringify(translateIds(oldGroups[name])) ===
                                JSON.stringify(known[0].members),
                        known: known.length === 1 ? known[0].members.slice() : [],
                        label: known.length === 1 ? "" : name,
                        members: translateIds(oldGroups[name]),
                    });
                });
            var oldOrder = Array.isArray(order)
                ? order.filter(function (name) {
                    return virtual.indexOf(name) < 0;
                })
                : [];
            if (!oldOrder.length)
                oldOrder = provider.slice(1).map(function (group) {
                    return group.label;
                });
            oldOrder.unshift("All");
            if (selection && selection.favorites)
                oldOrder.unshift("Favorites");
            var storedCategory = read("catIndex");
            var storedIndex = read("primaryIndex");
            var oldCategory = oldOrder[Number(storedCategory === null && selection
                ? selection.category
                : storedCategory) || 0];
            var oldIndex = Number(storedIndex === null && selection
                ? selection.index
                : storedIndex) || 0;
            var oldMembers = oldCategory === "All"
                ? provider[0].members
                : oldCategory === "Favorites" && selection
                    ? translateIds(selection.favorites)
                    : oldGroups && Array.isArray(oldGroups[oldCategory])
                        ? translateIds(oldGroups[oldCategory])
                        : (provider.filter(function (group) {
                            return group.label === oldCategory;
                        })[0] || { members: [] }).members;
            var oldMember = oldMembers[oldIndex];
            var oldGroup = state.groups.filter(function (group) {
                return (group.label === oldCategory ||
                    provider.some(function (live) {
                        return (live.id === group.id && live.label === oldCategory);
                    }));
            })[0];
            if (oldMember)
                state.selected = {
                    groupId: oldGroup
                        ? oldGroup.id
                        : oldCategory === "Favorites"
                            ? "system:favorites"
                            : (provider.filter(function (group) {
                                return group.label === oldCategory;
                            })[0] || { id: "system:all" }).id,
                    itemId: oldMember,
                };
            var priorLocks = read("parentalArray");
            state.locks =
                Array.isArray(priorLocks) && priorLocks.length
                    ? translateIds(priorLocks)
                    : catalog
                        .filter(function (row) {
                        return row.locked;
                    })
                        .map(function (row) {
                        return row.itemId;
                    });
            var locked = Object.create(null);
            state.locks.forEach(function (id) {
                locked[id] = true;
            });
            state.unlocks = catalog
                .filter(function (row) {
                return row.locked && !locked[row.itemId];
            })
                .map(function (row) {
                return row.itemId;
            });
            // Returned methods share this scope; release the temporary index.
            locked = null;
            [
                ["aAspects", "aspect"],
                ["aAudios", "audio"],
                ["aSubs", "subtitle"],
                ["aZooms", "zoom"],
            ].forEach(function (mapping) {
                var old = read(mapping[0]);
                var pref = Object.create(null);
                if (old && typeof old === "object")
                    Object.keys(old).forEach(function (id) {
                        if (typeof old[id] === "number" && isFinite(old[id]))
                            pref[id === "-1media"
                                ? "media"
                                : resolve("unresolved:" + id)] = old[id];
                    });
                state.preferences[mapping[1]] = pref;
            });
        }
    }
    state.unlocks = unique(state.unlocks.map(resolve));
    state.locks = unique(state.locks.map(resolve), state.unlocks);
    Object.keys(state.preferences).forEach(function (kind) {
        var preferences = state.preferences[kind];
        Object.keys(preferences).forEach(function (id) {
            var resolved = resolve(id);
            if (resolved !== id) {
                if (preferences[resolved] === undefined)
                    preferences[resolved] = preferences[id];
                delete preferences[id];
            }
        });
    });
    if (state.selected)
        state.selected.itemId = resolve(state.selected.itemId);
    // Unedited provider groups follow new catalog names and membership. User copies remain independent.
    function groups() {
        return libraryCore.classicChannelLibraryGroups(state, provider, resolve);
    }
    function metadata(text) {
        if (text === null)
            return null;
        var value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value))
            return null;
        // Local playback and preview can shadow the selected cursor. Every
        // other field must still match the physical document after saving.
        delete value.selected;
        return JSON.stringify(value);
    }
    function commit(change, durable) {
        if (durable === void 0) { durable = false; }
        if (!writable || readFailed || !ports.current())
            return false;
        var draft = clone(state);
        change(draft);
        var text = JSON.stringify(draft);
        try {
            var expectedMetadata = durable ? metadata(text) : null;
            var prior = ports.get(key);
            if (!ports.current())
                return false;
            var claim = ports.get("channelLibrarySource");
            if (!ports.current())
                return false;
            // Reserve the one-time import before saving its source document.
            if (!claim) {
                ports.set("channelLibrarySource", ports.sourceId);
                if (!ports.current() ||
                    ports.get("channelLibrarySource") !== ports.sourceId ||
                    !ports.current())
                    return false;
            }
            if (prior !== text ||
                (durable &&
                    ports.getPersisted &&
                    metadata(ports.getPersisted(key)) !== expectedMetadata))
                ports.set(key, text);
            if (!ports.current() || ports.get(key) !== text || !ports.current())
                return false;
            if (durable &&
                (!ports.getPersisted ||
                    metadata(ports.getPersisted(key)) !== expectedMetadata ||
                    !ports.current()))
                return false;
            state = draft;
            return true;
        }
        catch (_) {
            return false;
        }
    }
    function numeric(members) {
        var result = [];
        members.forEach(function (id) {
            if (items[id])
                result.push(items[id].id);
        });
        return result;
    }
    function libraryProvider(request) {
        // Core owns action dependencies. Do not re-serialize the full catalogue
        // for an action whose admission and reduction are catalogue-independent.
        return libraryCore.classicChannelLibraryNeedsProviderContext(request) ? provider : [];
    }
    function reduceLibraryDraft(draft, request) {
        var next = libraryCore.classicChannelLibraryReduce(draft, libraryProvider(request), request, resolve, Math.random);
        Object.keys(draft).forEach(function (field) { delete draft[field]; });
        Object.keys(next).forEach(function (field) { draft[field] = next[field]; });
    }
    function libraryAction(request, durable) {
        if (durable === void 0) { durable = false; }
        request.version = 1;
        var decision = libraryCore.classicChannelLibraryDecision(state, libraryProvider(request), request, resolve);
        if (!decision.accepted)
            return request.action === "create" ? null : false;
        if (!decision.commit)
            return decision.result;
        return commit(function (draft) { reduceLibraryDraft(draft, request); }, durable)
            ? decision.result : request.action === "create" ? null : false;
    }
    return {
        active: ports.current,
        adoptPlaybackOrder: function (order) {
            return libraryAction({ action: "adoptOrder", order: order.map(function (id) {
                    return ids[String(id)];
                }) });
        },
        append: function (rows) {
            if (!ports.current())
                return;
            var addedLocks = [];
            rows.forEach(function (row) {
                if (row.locked)
                    addedLocks.push(row.itemId);
                if (items[row.itemId]) {
                    addProviderMemberships(row);
                    return;
                }
                catalog.push(row);
                items[row.itemId] = { id: row.id };
                ids[String(row.id)] = row.itemId;
                addProviderMemberships(row);
                providerById["system:all"].members.push(row.itemId);
            });
            if (addedLocks.length)
                state.locks = libraryCore.classicChannelLibraryAddedLocks(state.locks, addedLocks, state.unlocks);
        },
        browse: function (groupId, durable) {
            var _a;
            if (durable === void 0) { durable = false; }
            if (!ports.current())
                return false;
            var request = { version: 1, action: "browse", groupId: groupId, durable: durable };
            var decision = libraryCore.classicChannelLibraryDecision(state, libraryProvider(request), request, resolve);
            if (!decision.accepted)
                return false;
            if (!decision.commit)
                return decision.result;
            function change(draft) {
                reduceLibraryDraft(draft, request);
            }
            if (!durable)
                return commit(change);
            var before = state;
            var prior = null;
            var written = null;
            try {
                prior = ports.get(key);
                var persisted = (_a = ports.getPersisted) === null || _a === void 0 ? void 0 : _a.call(ports, key);
                if (prior === null ||
                    persisted === undefined ||
                    metadata(prior) === null ||
                    metadata(prior) !== metadata(persisted) ||
                    !ports.current())
                    return false;
                var draft = clone(state);
                change(draft);
                written = JSON.stringify(draft);
                if (!commit(change))
                    throw new Error("Category was not saved");
                if (metadata(ports.getPersisted(key)) === metadata(written) &&
                    ports.current())
                    return true;
            }
            catch (_) { }
            // Restore both the live model and a session-memory fallback;
            // never overwrite a replacement source or a concurrent edit.
            if (ports.current()) {
                state = before;
                try {
                    if (prior !== null &&
                        written !== null &&
                        ports.get(key) === written)
                        ports.set(key, prior);
                }
                catch (_) { }
            }
            return false;
        },
        browsedGroup: function () {
            return ports.current() ? state.browsedGroup || null : null;
        },
        changeMember: function (groupId, channelId, action, delta) {
            return libraryAction({ action: "member", groupId: groupId,
                itemId: ids[String(channelId)], memberAction: action, delta: delta });
        },
        createGroup: function (label, copy) {
            return libraryAction({ action: "create", label: label, copyId: copy });
        },
        document: function () {
            if (!writable || readFailed || !ports.current())
                throw new Error("Channel library is unavailable for backup");
            return clone(state);
        },
        isShuffled: function (groupId) {
            var group = groupById(state.groups, groupId);
            return !!(group && group.shuffleBefore);
        },
        itemId: function (id) {
            return ids[String(id)] || null;
        },
        lock: function (channelId, locked) {
            return libraryAction({ action: "lock", itemId: ids[String(channelId)], locked: locked });
        },
        moveGroup: function (id, delta) {
            return libraryAction({ action: "move", groupId: id, delta: delta });
        },
        persist: function () {
            return commit(function () { });
        },
        preference: function (kind, channelId) {
            var id = channelId === null ? "media" : ids[String(channelId)];
            return id && state.preferences[kind]
                ? state.preferences[kind][id]
                : undefined;
        },
        removeGroup: function (id) {
            return libraryAction({ action: "remove", groupId: id });
        },
        renameGroup: function (id, label) {
            return libraryAction({ action: "rename", groupId: id, label: label });
        },
        resetShuffle: function (groupId) {
            return libraryAction({ action: "resetShuffle", groupId: groupId });
        },
        savedPreference: function (kind, channelId) {
            if (!ports.current() || !ports.getPersisted)
                return undefined;
            var id = channelId === null ? "media" : ids[String(channelId)];
            if (!id)
                return undefined;
            try {
                var saved = decode(JSON.parse(ports.getPersisted(key) || "null"));
                return ports.current() && saved && saved.preferences[kind]
                    ? saved.preferences[kind][id]
                    : undefined;
            }
            catch (_) {
                return undefined;
            }
        },
        select: function (groupId, channelId) {
            return libraryAction({ action: "select", groupId: groupId, itemId: ids[String(channelId)] });
        },
        setPreference: function (kind, channelId, value, durable) {
            if (durable === void 0) { durable = false; }
            return libraryAction({ action: "preference", kind: kind,
                itemId: channelId === null ? "media" : ids[String(channelId)], value: value }, durable);
        },
        shuffleGroup: function (groupId) {
            return libraryAction({ action: "shuffle", groupId: groupId });
        },
        snapshot: function () {
            var visible = groups();
            return {
                all: numeric((groupById(visible, "system:all") || { members: [] })
                    .members),
                groups: visible
                    .filter(function (group) {
                    return group.id !== "system:all";
                })
                    .map(function (group) {
                    return {
                        id: group.id,
                        label: group.label,
                        members: numeric(group.members),
                    };
                }),
                locks: numeric(state.locks),
                selected: clone(state.selected),
            };
        },
        sourceId: ports.sourceId,
    };
}
window.__ottChannelLibrary = { create: createChannelLibrary };
