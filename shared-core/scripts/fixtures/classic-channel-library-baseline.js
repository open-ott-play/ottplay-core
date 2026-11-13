// Characterization fixture only; not a production runtime.
// Source: open-ott-play/ottplay-foss@9336a40ccd4e8e0e84571b037c2d2b49e8b0aaaa:src/channels/library.ts
// Source port: baseline; SHA-256 e796b2de498cb8f464d46ad7345ba461e4a764e544919dd7a25785a47c895c26
// Transpiler: TypeScript 5.9.3, target ES5, module CommonJS (script has no imports or exports).
function createChannelLibrary(ports, catalog) {
    var key = "channelLibrary:" + ports.sourceId;
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
    function empty() {
        return {
            groups: [],
            hidden: [],
            locks: catalog
                .filter(function (row) {
                return row.locked;
            })
                .map(function (row) {
                return row.itemId;
            }),
            nextGroup: 1,
            preferences: {},
            selected: null,
            sourceId: ports.sourceId,
            unlocks: [],
            version: 1,
        };
    }
    function decode(value) {
        if (!value ||
            value.version !== 1 ||
            value.sourceId !== ports.sourceId ||
            !Array.isArray(value.groups) ||
            !Array.isArray(value.hidden) ||
            !Array.isArray(value.locks) ||
            !value.preferences ||
            typeof value.preferences !== "object")
            return null;
        var result = empty();
        if (typeof value.browsedGroup === "string" && value.browsedGroup)
            result.browsedGroup = value.browsedGroup;
        var seen = Object.create(null);
        value.groups.forEach(function (group) {
            if (!group ||
                typeof group.id !== "string" ||
                typeof group.label !== "string" ||
                seen[group.id])
                return;
            seen[group.id] = true;
            result.groups.push({
                id: group.id,
                inheritsMembers: group.inheritsMembers === true,
                known: unique(group.known),
                label: group.label,
                members: unique(group.members),
                shuffleBefore: Array.isArray(group.shuffleBefore)
                    ? unique(group.shuffleBefore)
                    : undefined,
            });
        });
        result.hidden = unique(value.hidden);
        result.unlocks = unique(value.unlocks);
        result.locks = unique(value.locks.concat(result.locks), result.unlocks);
        ["aspect", "audio", "subtitle", "zoom"].forEach(function (kind) {
            var source = value.preferences[kind];
            var target = Object.create(null);
            if (source && typeof source === "object")
                Object.keys(source).forEach(function (id) {
                    if (typeof source[id] === "number" && isFinite(source[id]))
                        target[id] = source[id];
                });
            result.preferences[kind] = target;
        });
        if (value.selected &&
            typeof value.selected.groupId === "string" &&
            typeof value.selected.itemId === "string")
            result.selected = clone(value.selected);
        if (Number.isInteger(value.nextGroup) && value.nextGroup > 0)
            result.nextGroup = value.nextGroup;
        return result;
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
        var seen = Object.create(null);
        var hidden = Object.create(null);
        state.hidden.forEach(function (id) {
            hidden[id] = true;
        });
        var result = state.groups.map(function (group) {
            seen[group.id] = true;
            var live = providerById[group.id];
            var members = group.members;
            if (live && group.inheritsMembers)
                members = live.members;
            else if (live && group.known) {
                var known = Object.create(null);
                group.known.concat(members).forEach(function (id) {
                    known[id] = true;
                });
                members = members.concat(live.members.filter(function (id) {
                    return !known[id];
                }));
            }
            return {
                id: group.id,
                label: live && group.label === "" ? live.label : group.label,
                members: members.map(resolve),
            };
        });
        provider.forEach(function (group) {
            if (!hidden[group.id] && !seen[group.id]) {
                seen[group.id] = true;
                result.push({
                    id: group.id,
                    label: group.label,
                    members: group.members.slice(),
                });
            }
        });
        return result.filter(function (group) {
            return !hidden[group.id];
        });
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
    function editGroup(draft, id) {
        var group = groupById(draft.groups, id);
        if (!group) {
            var live = groupById(groups(), id);
            if (live) {
                group = clone(live);
                if (providerById[id])
                    group.label = "";
                group.inheritsMembers = !!providerById[id];
                draft.groups.push(group);
            }
        }
        return group;
    }
    return {
        active: ports.current,
        adoptPlaybackOrder: function (order) {
            var all = providerById["system:all"].members;
            if (order.length !== all.length ||
                order.some(function (id, index) {
                    return ids[String(id)] !== all[index];
                }))
                return false;
            return commit(function (draft) {
                // The local provider owns its compact seeded order. Drop only
                // obsolete provider membership overrides; retain names, custom
                // groups, visibility, preferences and parental locks.
                draft.groups.forEach(function (group) {
                    if (!providerById[group.id])
                        return;
                    group.inheritsMembers = true;
                    group.members = [];
                    delete group.known;
                    delete group.shuffleBefore;
                });
                draft.selected = all.length
                    ? { groupId: "system:all", itemId: all[0] }
                    : null;
            });
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
                state.locks = unique(state.locks.concat(addedLocks), state.unlocks);
        },
        browse: function (groupId, durable) {
            var _a;
            if (durable === void 0) { durable = false; }
            if (!ports.current() ||
                (groupId !== "system:favorites" &&
                    !groupById(groups(), groupId)))
                return false;
            if (state.browsedGroup === groupId && !durable)
                return true;
            function change(draft) {
                draft.browsedGroup = groupId;
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
            var id = ids[String(channelId)];
            if (!id)
                return false;
            return commit(function (draft) {
                var group = editGroup(draft, groupId);
                if (!group)
                    return;
                var visible = groupById(groups(), groupId);
                if (visible)
                    group.members = visible.members.slice();
                var live = providerById[groupId];
                group.inheritsMembers = false;
                group.known = unique((group.known || []).concat(live ? live.members : []));
                var at = group.members.indexOf(id);
                if (action === "add" && at < 0)
                    group.members.push(id);
                if (action === "remove" && at >= 0)
                    group.members.splice(at, 1);
                if (action === "move" && at >= 0) {
                    group.members.splice(at, 1);
                    group.members.splice((at + (delta || 0) + group.members.length + 1) %
                        (group.members.length + 1), 0, id);
                }
            });
        },
        createGroup: function (label, copy) {
            label = label.trim();
            if (!label ||
                groups().some(function (group) {
                    return group.label === label;
                }))
                return null;
            var id = "user:" + state.nextGroup;
            return commit(function (draft) {
                var original = groupById(groups(), copy);
                draft.nextGroup++;
                draft.groups.push({
                    id: id,
                    label: label,
                    members: original ? original.members.slice() : [],
                });
            })
                ? id
                : null;
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
            var id = ids[String(channelId)];
            if (!id)
                return false;
            return commit(function (draft) {
                draft.locks = draft.locks.filter(function (value) {
                    return value !== id;
                });
                draft.unlocks = draft.unlocks.filter(function (value) {
                    return value !== id;
                });
                if (locked)
                    draft.locks.push(id);
                else
                    draft.unlocks.push(id);
            });
        },
        moveGroup: function (id, delta) {
            if (id.indexOf("system:") === 0)
                return false;
            var ordered = groups().filter(function (group) {
                return group.id.indexOf("system:") !== 0;
            });
            var at = ordered
                .map(function (group) {
                return group.id;
            })
                .indexOf(id);
            if (at < 0 || !ordered.length)
                return false;
            var item = ordered.splice(at, 1)[0];
            ordered.splice((at + delta + ordered.length + 1) % (ordered.length + 1), 0, item);
            return commit(function (draft) {
                draft.groups = ordered.map(function (group) {
                    var stored = groupById(draft.groups, group.id);
                    return {
                        id: group.id,
                        inheritsMembers: stored ? stored.inheritsMembers : true,
                        known: stored && stored.known,
                        label: stored ? stored.label : "",
                        members: group.members,
                    };
                });
            });
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
            if (id.indexOf("system:") === 0)
                return false;
            return commit(function (draft) {
                draft.groups = draft.groups.filter(function (group) {
                    return group.id !== id;
                });
                draft.hidden.push(id);
            });
        },
        renameGroup: function (id, label) {
            if (id.indexOf("system:") === 0)
                return false;
            label = label.trim();
            if (!label ||
                groups().some(function (group) {
                    return group.id !== id && group.label === label;
                }))
                return false;
            return commit(function (draft) {
                var group = editGroup(draft, id);
                if (group)
                    group.label = label;
            });
        },
        resetShuffle: function (groupId) {
            var stored = groupById(state.groups, groupId);
            var visible = groupById(groups(), groupId);
            if (!stored || !stored.shuffleBefore || !visible)
                return false;
            var current = unique(visible.members);
            var membership = Object.create(null);
            current.forEach(function (id) {
                membership[id] = true;
            });
            var restored = unique(stored.shuffleBefore.map(resolve)).filter(function (id) {
                return membership[id];
            });
            var members = restored.concat(unique(current, restored));
            return commit(function (draft) {
                var group = editGroup(draft, groupId);
                group.members = members;
                delete group.shuffleBefore;
                group.inheritsMembers = false;
                var live = providerById[groupId];
                group.known = unique((group.known || []).concat(live ? live.members : []));
            });
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
            var id = ids[String(channelId)];
            if (!id)
                return false;
            if (state.selected &&
                state.selected.groupId === groupId &&
                state.selected.itemId === id)
                return true;
            return commit(function (draft) {
                draft.selected = { groupId: groupId, itemId: id };
            });
        },
        setPreference: function (kind, channelId, value, durable) {
            if (durable === void 0) { durable = false; }
            var id = channelId === null ? "media" : ids[String(channelId)];
            if (!id ||
                ["aspect", "audio", "subtitle", "zoom"].indexOf(kind) < 0 ||
                (value != null && !isFinite(value)))
                return false;
            return commit(function (draft) {
                var prefs = draft.preferences[kind] || (draft.preferences[kind] = {});
                if (value == null)
                    delete prefs[id];
                else
                    prefs[id] = value;
            }, durable);
        },
        shuffleGroup: function (groupId) {
            var visible = groupById(groups(), groupId);
            if (!visible || visible.members.length < 2)
                return false;
            var members = visible.members.slice();
            return commit(function (draft) {
                var group = editGroup(draft, groupId);
                if (!group.shuffleBefore)
                    group.shuffleBefore = members.slice();
                group.members = members;
                for (var i = group.members.length - 1; i > 0; i--) {
                    var j = Math.floor(Math.random() * (i + 1));
                    var value = group.members[i];
                    group.members[i] = group.members[j];
                    group.members[j] = value;
                }
                group.inheritsMembers = false;
                var live = providerById[groupId];
                group.known = unique((group.known || []).concat(live ? live.members : []));
            });
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
