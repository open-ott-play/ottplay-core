"use strict";
const tls = require("node:tls");

function upstreamCiphers(ciphers = tls.DEFAULT_CIPHERS) {
    // Retain the operator's cipher selection and any stricter explicit policy.
    let level = 2;
    for (const token of ciphers.split(/[: ,;]+/)) {
        const match = /^@SECLEVEL=(\d+)$/.exec(token);
        if (match) level = Math.max(level, Number(match[1]));
    }
    return ciphers + ":@SECLEVEL=" + level;
}

module.exports = { upstreamCiphers };
