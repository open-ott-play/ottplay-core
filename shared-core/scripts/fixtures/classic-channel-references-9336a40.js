// SPDX-License-Identifier: MIT
// Copyright (c) 2026 open-ott-play
// Frozen test oracle, not a production implementation. TypeScript annotations removed.
// https://github.com/open-ott-play/ottplay-foss/blob/9336a40ccd4e8e0e84571b037c2d2b49e8b0aaaa/src/channels/channel-references.ts
function createChannelReferences(channels, aliases) {
    var numbers = Object.create(null);
    var items = Object.create(null);
    var edges = Object.create(null);
    var uncertain = Object.create(null);
    function owns(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }
    function numberKey(value) {
        if ((typeof value !== "number" && typeof value !== "string") ||
            !/^-?\d+$/.test(String(value)))
            return null;
        var number = Number(value);
        return isFinite(number) ? String(number) : null;
    }
    function edge(previous, next) {
        var key = numberKey(previous), target = numberKey(next);
        if (key === null)
            return;
        if (target === null) {
            uncertain[key] = true;
            return;
        }
        if (!edges[key])
            edges[key] = [];
        if (edges[key].indexOf(target) < 0)
            edges[key].push(target);
    }
    Object.keys(channels || {}).forEach(function (key) {
        var row = channels[key], number = numberKey(key);
        if (!row || number === null)
            return;
        var item = String(row.itemId || "channel:" + number);
        numbers[number] = item;
        items[item] =
            !owns(items, item) || items[item] === Number(number)
                ? Number(number)
                : null;
        if (row.legacyChannelId !== undefined)
            edge(row.legacyChannelId, number);
    });
    Object.keys(aliases || {}).forEach(function (key) {
        edge(key, aliases[key]);
    });
    function resolve(value, origin) {
        var key = numberKey(value);
        var pending = { legacyId: value, origin: origin };
        if (key === null)
            return pending;
        if (origin === "canonical")
            return owns(numbers, key) ? { itemId: numbers[key] } : pending;
        var candidates = Object.create(null);
        var visited = Object.create(null);
        var ambiguous = false;
        function visit(at) {
            if (visited[at] === 1) {
                ambiguous = true;
                return;
            }
            if (visited[at] === 2)
                return;
            visited[at] = 1;
            if (owns(numbers, at))
                candidates[numbers[at]] = true;
            if (uncertain[at])
                ambiguous = true;
            (edges[at] || []).forEach(function (next) {
                // Recording an unchanged hash is an identity edge, not a competing channel.
                if (next === at) {
                    if (!owns(numbers, at))
                        ambiguous = true;
                }
                else
                    visit(next);
            });
            visited[at] = 2;
        }
        visit(key);
        var found = Object.keys(candidates);
        if (found.length === 1 && !ambiguous)
            return { itemId: found[0] };
        if (found.length > 1 || ambiguous)
            pending.ambiguous = true;
        return pending;
    }
    return {
        project: function (reference) {
            return reference &&
                typeof reference.itemId === "string" &&
                owns(items, reference.itemId)
                ? items[reference.itemId]
                : null;
        },
        resolve: resolve,
    };
}
module.exports = createChannelReferences;
