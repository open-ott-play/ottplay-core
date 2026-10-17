"use strict";
const tls = require("node:tls");
const { X509Certificate } = require("node:crypto");

function upstreamCiphers(ciphers = tls.DEFAULT_CIPHERS) {
    // Retain the operator's cipher selection and any stricter explicit policy.
    let level = 2;
    for (const token of ciphers.split(/[: ,;]+/)) {
        const match = /^@SECLEVEL=(\d+)$/.exec(token);
        if (match) level = Math.max(level, Number(match[1]));
    }
    return ciphers + ":@SECLEVEL=" + level;
}

// Node supplies the verified chain, including its trust anchor, to this callback.
// The normal hostname check is retained; this only adds exact public-key floors.
function checkUpstreamIdentity(hostname, certificate) {
    const identityError = tls.checkServerIdentity(hostname, certificate);
    if (identityError) return identityError;
    const seen = new Set();
    let current = certificate;
    try {
        for (let depth = 0; depth < 32; depth++) {
            if (!current || !Buffer.isBuffer(current.raw)) throw new Error("missing chain");
            const fingerprint = current.raw.toString("base64");
            if (seen.has(fingerprint)) throw new Error("cyclic chain");
            seen.add(fingerprint);
            const key = new X509Certificate(current.raw).publicKey;
            const details = key.asymmetricKeyDetails || {};
            let strong = false;
            switch (key.asymmetricKeyType) {
                case "rsa": case "rsa-pss": strong = details.modulusLength >= 2048; break;
                case "dsa": strong = details.modulusLength >= 2048 && details.divisorLength >= 224; break;
                case "ec": strong = ["secp224r1", "prime256v1", "secp256k1", "secp384r1", "secp521r1"].includes(details.namedCurve); break;
                case "ed25519": case "ed448": strong = true; break;
            }
            if (!strong) throw new Error("unsupported or undersized key");
            const issuer = current.issuerCertificate;
            if (issuer && Buffer.isBuffer(issuer.raw) && current.raw.equals(issuer.raw)) return undefined;
            current = issuer;
        }
    } catch { /* Fail closed without exposing certificate or upstream details. */ }
    const error = new Error("Upstream certificate chain does not meet the public-key policy");
    error.code = "ERR_TLS_CERT_KEY_STRENGTH";
    return error;
}

function upstreamTlsOptions() {
    return {
        agent: false,
        rejectUnauthorized: true,
        minVersion: tls.DEFAULT_MIN_VERSION === "TLSv1.3" ? "TLSv1.3" : "TLSv1.2",
        // ECDHE and TLS 1.3 only, with no finite-field or static RSA key exchange.
        ciphers: upstreamCiphers() + ":!kRSA:!kDHE:!kPSK",
        ecdhCurve: "X25519:P-256:P-384:P-521",
        checkServerIdentity: checkUpstreamIdentity,
    };
}

module.exports = { upstreamCiphers, upstreamTlsOptions, checkUpstreamIdentity };
