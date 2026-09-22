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
        var state = require("state");
        return OttPlayCore.previewLegacySettings(incoming, isXML, state.defaults, state.validate, parseJSON, require("providers").httpUrl);

    }
    return { preview: preview };
});
