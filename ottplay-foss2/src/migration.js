/* Read-only migration preview. Old storage is interpreted as data, never code.
 * Supported contracts were documented from settings/index.ts, settings/cloud.ts,
 * and the M3U/Xtream parameter DTOs. No legacy player implementation is reused.
 */
OTT2.define("migration", function (require) {
    "use strict";
    var has = Object.prototype.hasOwnProperty, maxSize = 12 * 1024 * 1024;
    function plain(value) { return value && typeof value === "object" && !Array.isArray(value); }
    function safeKey(key) { return key !== "__proto__" && key !== "prototype" && key !== "constructor"; }
    function inspect(value, depth, budget) {
        var keys, i;
        if (depth > 32 || --budget.remaining < 0) throw new Error("Settings nesting or item count is too large");
        if (!value || typeof value !== "object") return;
        keys = Object.keys(value);
        for (i = 0; i < keys.length; i++) {
            if (!safeKey(keys[i])) throw new Error("Unsafe settings key");
            inspect(value[keys[i]], depth + 1, budget);
        }
    }
    function parseJSON(text) {
        var result;
        try { result = JSON.parse(text); } catch (ignore) { throw new Error("Invalid settings JSON"); }
        inspect(result, 0, { remaining: 200000 });
        return result;
    }
    function decodeXML(text) {
        return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, function (all, entity) {
            var value;
            if (entity === "amp") return "&";
            if (entity === "lt") return "<";
            if (entity === "gt") return ">";
            if (entity === "quot") return '"';
            if (entity === "apos") return "'";
            value = entity.charAt(1).toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            if (!value || value > 1114111 || (value >= 55296 && value <= 57343)) throw new Error("Invalid XML character");
            return value <= 65535 ? String.fromCharCode(value) : String.fromCharCode(55296 + ((value - 65536) >>> 10), 56320 + ((value - 65536) & 1023));
        });
    }
    function parseXML(text) {
        var source = text.replace(/^\s*<\?xml\s+[^?]*\?>\s*/i, "");
        var result = {}, body, expression, match, consumed = 0, count = 0, key;
        // This exact legacy declaration is metadata only; no DTD is fetched.
        source = source.replace(/^\s*<!DOCTYPE\s+properties\s+SYSTEM\s+"http:\/\/java\.sun\.com\/dtd\/properties\.dtd"\s*>\s*/i, "");
        if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source)) throw new Error("Unsupported XML declaration");
        body = /^\s*<properties>\s*<comment>OTT-Play Preferences<\/comment>([\s\S]*)<\/properties>\s*$/.exec(source);
        if (!body) throw new Error("Not an OTT-Play settings XML export");
        expression = /\s*<entry\s+key="([^"]+)">([^<]*)<\/entry>/g;
        while ((match = expression.exec(body[1]))) {
            if (match.index !== consumed || ++count > 10000) throw new Error("Malformed settings XML");
            consumed = expression.lastIndex; key = decodeXML(match[1]);
            if (!safeKey(key) || has.call(result, key)) throw new Error("Unsafe or duplicate settings key");
            result[key] = decodeXML(match[2]);
        }
        if (/\S/.test(body[1].slice(consumed))) throw new Error("Malformed settings XML");
        return result;
    }
    function preview(text) {
        if (typeof text !== "string" || text.length > maxSize || !/\S/.test(text)) throw new Error("Settings file is empty or too large");
        text = text.replace(/^\ufeff/, "");
        var isXML = /^\s*</.test(text), incoming = isXML ? parseXML(text) : parseJSON(text);
        var state = require("state"), proposed = state.defaults(), warnings = [], format, legacy = false, recognized = 0, settings, key, i;
        var sourceCount = 0, legacySources = {}, parentalReview = false;
        function warn(message) { if (warnings.indexOf(message) === -1) warnings.push(message); }
        function language(value) {
            if (value === "ru" || value === "_rus") proposed.settings.language = "ru";
            else if (value === "en" || value === "_eng") proposed.settings.language = "en";
            else if (value) warn("This language is not available yet; English will be used.");
        }
        function font(value) {
            var index = typeof value === "string" && /^[0-6]$/.test(value) ? Number(value) : value;
            if (typeof index === "number" && index % 1 === 0 && index >= 0 && index < state.fonts.length) proposed.settings.fontFamily = state.fonts[index];
            else if (value !== undefined) warn("An unknown legacy font was replaced with the system font.");
        }
        function embedded(value, label) {
            if (typeof value === "string" && value.slice(0, 4) === "\u0001LZ\u0001") { warn("Compressed legacy " + label + " was skipped; export it as JSON in the old player first."); return null; }
            if (typeof value === "string") return parseJSON(value);
            return value;
        }
        function addSource(type, url, name, username, password, suffix) {
            url = require("providers").httpUrl(url);
            if (!url) { warn("A source with an unsupported or invalid URL was skipped."); return; }
            if (sourceCount >= 100) throw new Error("Too many sources in legacy export");
            var id = "legacy-" + type + "-" + suffix;
            proposed.sources.push({ id: id, name: typeof name === "string" && name ? name.slice(0, 160) : type.toUpperCase() + " " + (sourceCount + 1),
                type: type, url: url, text: "", username: typeof username === "string" ? username : "", password: typeof password === "string" ? password : "", mac: "" });
            sourceCount++; legacySources["$" + type + suffix] = id;
        }
        function oldIds(value, parental) {
            value = embedded(value, parental ? "parental selections" : "favorites");
            if (value === null) return;
            if (!Array.isArray(value)) throw new Error("Invalid legacy channel selections");
            if (value.length > 50000) throw new Error("Too many legacy channel selections");
            if (value.length) {
                if (parental) parentalReview = true;
                warn(parental ? "Legacy protected-channel IDs cannot be matched safely. Set a new PIN and review protected channels before playback." : "Legacy favorite IDs are provider-specific and were not guessed. Re-select favorites after loading the source.");
            }
        }
        function m3u(value) {
            value = embedded(value, "M3U sources");
            if (value === null) return;
            if (!plain(value) || !Array.isArray(value.M3Us)) throw new Error("Invalid legacy M3U settings");
            if (value.M3Us.length > 100) throw new Error("Too many legacy M3U sources");
            var j, row;
            for (j = 0; j < value.M3Us.length; j++) {
                row = value.M3Us[j];
                if (!plain(row)) throw new Error("Invalid legacy M3U source");
                if (row.www) addSource("m3u", row.www, row.name, "", "", j);
                if (row.rechours || row.medUrl) warn("Legacy archive-hour overrides and VPortal links need manual review and were not imported.");
            }
            if (has.call(legacySources, "$m3u" + value.active)) proposed.activeSourceId = legacySources["$m3u" + value.active];
        }
        function xtream(value) {
            value = embedded(value, "Xtream source");
            if (value === null) return;
            if (!plain(value)) throw new Error("Invalid legacy Xtream settings");
            if (value.server) addSource("xtream", value.server, "Xtream", value.username, value.password, 0);
        }
        if (!plain(incoming)) throw new Error("Unsupported settings format");
        if (has.call(incoming, "schema")) {
            proposed = state.validate(incoming); format = "ottplay-foss2-v1";
        } else if (incoming.version === 1 && plain(incoming.settings)) {
            format = "ottplay-foss-v1"; legacy = true; settings = incoming.settings;
            font(settings.fontSize); language(settings.language);
            if (incoming.favoritesArray !== undefined) oldIds(incoming.favoritesArray, false);
            if (incoming.parentalArray !== undefined) oldIds(incoming.parentalArray, true);
            if (settings.parentPin) warn("The old plaintext parental PIN was omitted. Set a new PIN in Parental controls.");
            warn("The old JSON export contains no provider source credentials. Add your source separately.");
            warn("Only preferences with an exact new equivalent were migrated; old key bindings and device-specific options were omitted.");
        } else {
            if (has.call(incoming, "version")) throw new Error("Unsupported legacy settings envelope");
            format = isXML ? "ottplay-properties-xml" : "ottplay-storage-json"; legacy = true;
            for (key in incoming) if (has.call(incoming, key)) {
                if (key === "ottplaylang") { language(incoming[key]); recognized++; }
                else if (key === "sFont") { font(incoming[key]); recognized++; }
                else if (key === "m3um3uArr") { m3u(incoming[key]); recognized++; }
                else if (key === "xtreamxtream_data") { xtream(incoming[key]); recognized++; }
                else if (/^(?:m3u|xtream)?favoritesArray[0-9]*$/.test(key)) { oldIds(incoming[key], false); recognized++; }
                else if (/^(?:m3u|xtream)?parentalArray[0-9]*$/.test(key)) { oldIds(incoming[key], true); recognized++; }
                else if (key === "parentPIN") { warn("The old plaintext parental PIN was omitted. Set a new PIN in Parental controls."); recognized++; }
                else if (key === "ottplayprov") recognized++;
            }
            if (!recognized) throw new Error("No recognized OTT-Play settings were found");
            if (incoming.ottplayprov === "xtream" && has.call(legacySources, "$xtream0")) proposed.activeSourceId = legacySources.$xtream0;
            warn("Unknown legacy storage keys, local-server access settings and device credentials were omitted.");
            proposed = state.validate(proposed);
        }
        var containsSecrets = proposed.sources.length > 0 || !!proposed.settings.epgUrl || !!(proposed.settings.epgUrls && proposed.settings.epgUrls.length);
        if (containsSecrets) warn("Source URLs and provider credentials are included. Confirm before replacing local settings.");
        if (legacy) warn("Migration is a preview. Existing settings are unchanged until you confirm the import.");
        // This module never writes storage or starts a provider or network request.
        return { format: format, proposed: proposed, warnings: warnings, containsSecrets: containsSecrets,
            requiresSourceConfirmation: containsSecrets, requiresParentalReview: parentalReview, legacy: legacy,
            summary: { sources: proposed.sources.length, language: proposed.settings.language, fontFamily: proposed.settings.fontFamily } };
    }
    return { preview: preview };
});
