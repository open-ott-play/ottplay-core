/* Source-bound playback choices, independent of temporary engine track IDs. */
OTT2.define("playback-preferences", function (require) {
    "use strict";
    function text(value) { return String(value || "").replace(/^\s+|\s+$/g, "").toLowerCase(); }
    function language(value) {
        var aliases = { eng: "en", rus: "ru", deu: "de", ger: "de", fra: "fr", fre: "fr", spa: "es", ita: "it", ukr: "uk", pol: "pl", por: "pt" };
        value = text(value).replace(/_/g, "-");
        return aliases[value] || value;
    }
    function matchTrack(tracks, choice, backend) {
        var lang = language(choice.language), label = text(choice.label), candidates = tracks.slice(), exact;
        if (lang) {
            candidates = candidates.filter(function (track) { return language(track.language) === lang; });
            if (!candidates.length) return null;
        }
        if (label) {
            exact = candidates.filter(function (track) { return text(track.label) === label; });
            if (exact.length === 1) return exact[0];
            if (exact.length) candidates = exact;
            else if (!lang) return null;
        }
        if ((lang || label) && candidates.length === 1) return candidates[0];
        if (!lang && !label && choice.backend === backend) {
            for (var i = 0; i < tracks.length; i++) if (tracks[i].id === choice.id) return tracks[i];
        }
        return null;
    }
    function create(context) {
        var media = context.media, active = null, preferred = null, previousReference = null, busy = false, applied = {};
        function session(snapshot) { return snapshot.backend + ":" + (typeof snapshot.session === "number" ? snapshot.session : ""); }
        function begin(channel, reference, items) {
            active = reference; preferred = null; previousReference = null; applied = {};
            if (!active) return;
            var entries = context.state().playbackPreferences || [], candidates = [], i;
            for (i = 0; i < entries.length; i++) {
                var entry = entries[i], ref = entry.reference;
                if (ref.sourceId !== active.sourceId) continue;
                if (ref.id === active.id) { preferred = entry; break; }
                if (channel.kind !== "vod") {
                    var restored = require("library").restoreChannel(items, ref);
                    if (restored && restored.id === channel.id) candidates.push(entry);
                }
            }
            if (!preferred && candidates.length === 1) preferred = candidates[0];
            if (preferred) previousReference = preferred.reference;
        }
        function save(field, value) {
            if (!active) return;
            var entry = { reference: active }, old = previousReference;
            if (preferred) ["audio", "subtitle", "aspect", "zoom"].forEach(function (name) { if (preferred[name] !== undefined) entry[name] = preferred[name]; });
            entry[field] = value;
            context.persist(function (state) {
                state.playbackPreferences = (state.playbackPreferences || []).filter(function (item) {
                    var ref = item.reference;
                    return !(ref.sourceId === active.sourceId && (ref.id === active.id || old && ref.id === old.id));
                });
                state.playbackPreferences.unshift(entry);
                state.playbackPreferences = state.playbackPreferences.slice(0, 200);
            });
            preferred = entry; previousReference = active;
        }
        function select(kind, id) {
            var snapshot = media.getState(), tracks = media.listTracks(), list = kind === "audio" ? tracks.audio : tracks.subtitles, selected = null, i;
            for (i = 0; i < list.length; i++) if (list[i].id === String(id)) selected = list[i];
            if (!selected && !(kind === "subtitle" && id === "off")) return false;
            busy = true;
            var success;
            try { success = kind === "audio" ? media.selectAudio(id) : media.selectSubtitle(id); }
            finally { busy = false; }
            if (success) {
                var choice = selected ? { language: selected.language || "", label: /^(?:Audio|Subtitles) \d+$/.test(selected.label || "") ? "" : selected.label || "", id: selected.id, backend: snapshot.backend } : { off: true };
                save(kind, choice); applied[kind] = session(snapshot);
            }
            return success;
        }
        function restore(snapshot, eventType) {
            if (!active || !preferred || busy || !snapshot.channel || snapshot.channel.id !== active.id) return;
            if (eventType === "loading" || eventType === "switching" || eventType === "retry") { applied = {}; return; }
            if (!snapshot.ready || ["metadata", "tracks", "playing"].indexOf(eventType) === -1) return;
            var tracks = media.listTracks();
            busy = true;
            try {
                ["audio", "subtitle"].forEach(function (kind) {
                    var choice = preferred[kind];
                    if (!choice || applied[kind] === session(snapshot) && (!choice.off || tracks.subtitlesOff)) return;
                    if (choice.off && !tracks.subtitles.length) return;
                    var target = choice.off ? null : matchTrack(kind === "audio" ? tracks.audio : tracks.subtitles, choice, snapshot.backend);
                    if (!choice.off && !target) return;
                    var success = choice.off ? tracks.subtitlesOff || media.selectSubtitle("off") : target.selected || (kind === "audio" ? media.selectAudio(target.id) : media.selectSubtitle(target.id));
                    if (success) applied[kind] = session(snapshot);
                });
            } finally { busy = false; }
        }
        function picture(field, value) {
            var success = field === "aspect" ? media.setAspect(value === "auto" ? "fit" : value) : media.setZoom(Number(value));
            if (success) {
                if (active) save(field, field === "zoom" ? Number(value) : value);
                else context.persist(function (state) { state.settings[field] = field === "zoom" ? Number(value) : value; });
            }
            return success;
        }
        return {
            begin: begin, select: select, restore: restore, picture: picture,
            settings: function () { var defaults = context.state().settings; return { aspect: preferred && preferred.aspect || defaults.aspect, zoom: preferred && preferred.zoom || defaults.zoom }; },
            reset: function () { active = preferred = previousReference = null; applied = {}; }
        };
    }
    return { create: create, matchTrack: matchTrack };
});
