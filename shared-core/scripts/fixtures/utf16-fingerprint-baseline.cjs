"use strict";
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 open-ott-play
// Frozen pre-extraction scalar loops; source paths and hashes are in utf16-fingerprint-vectors.json.
function oracle_foss_source(input) { var namespace = "fingerprint";
var first = 2166136261;
var second = 5381;
for (var i = 0; i < input.length; i++) {
        first ^= input.charCodeAt(i);
        first +=
            (first << 1) +
            (first << 4) +
            (first << 7) +
            (first << 8) +
            (first << 24);
        second = ((second << 5) + second) ^ input.charCodeAt(i);
    }
return (
        namespace +
        "@" +
        (first >>> 0).toString(16) +
        "." +
        (second >>> 0).toString(16)
    );
}
function oracle_foss2_identity(value) {
        var a = 2166136261, b = 5381, i;
        for (i = 0; i < value.length; i++) { a ^= value.charCodeAt(i); a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24); b = ((b << 5) + b) ^ value.charCodeAt(i); }
        return (a >>> 0).toString(16) + "-" + (b >>> 0).toString(16);
    }
function oracle_foss2_provider(value) {
            var a = 2166136261;
            var b = 5381;
            var i;
            for (i = 0; i < value.length; i += 1) {
                a ^= value.charCodeAt(i);
                a += (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
                b = ((b << 5) + b) ^ value.charCodeAt(i);
            }
            return (a >>> 0).toString(16) + "-" + (b >>> 0).toString(16);
        }
module.exports = { source: oracle_foss_source, identity: oracle_foss2_identity, provider: oracle_foss2_provider };
