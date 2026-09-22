/* Local parental controls, independent from any provider or remote authentication.
 * ES5 SHA-256 with 2048 iterations is a bounded deterrent suitable for old TVs.
 * A short PIN and browser storage do not resist an owner with developer tools.
 * The salt is public; the clock/counter fallback is NOT a random credential.
 */
OTT2.define("security", function () {
    "use strict";
    var has = Object.prototype.hasOwnProperty, serial = 0, iterations = 2048, maxBlock = 300000;
    var scopeNames = ["settings", "source", "import", "restore", "export", "proxy", "remote"];
    var playbackActions = ["playback", "play", "archive", "vod", "history", "bookmark", "preview", "pip"];
    var constants = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
        3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
        3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
        2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
        666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
        2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
        430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
        1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298];
    function rotate(n, bits) { return (n >>> bits) | (n << (32 - bits)); }
    function sha256(text) {
        var bytes = [], words = [], work = [], h = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
        var i, j, n, next, length, a, b, c, d, e, f, g, v, t1, t2, result = "";
        for (i = 0; i < text.length; i++) {
            n = text.charCodeAt(i);
            if (n >= 55296 && n <= 56319) {
                next = text.charCodeAt(i + 1);
                if (next >= 56320 && next <= 57343) { n = 65536 + ((n - 55296) << 10) + next - 56320; i++; }
                else n = 65533;
            } else if (n >= 56320 && n <= 57343) n = 65533;
            if (n < 128) bytes.push(n);
            else if (n < 2048) bytes.push(192 | (n >>> 6), 128 | (n & 63));
            else if (n < 65536) bytes.push(224 | (n >>> 12), 128 | ((n >>> 6) & 63), 128 | (n & 63));
            else bytes.push(240 | (n >>> 18), 128 | ((n >>> 12) & 63), 128 | ((n >>> 6) & 63), 128 | (n & 63));
        }
        length = bytes.length;
        bytes.push(128);
        while (bytes.length % 64 !== 56) bytes.push(0);
        for (i = 7; i >= 0; i--) bytes.push(i >= 4 ? Math.floor(length / Math.pow(2, i * 8 - 3)) & 255 : ((length * 8) >>> (i * 8)) & 255);
        for (i = 0; i < bytes.length; i += 4) words.push((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]);
        for (i = 0; i < words.length; i += 16) {
            for (j = 0; j < 64; j++) {
                if (j < 16) work[j] = words[i + j];
                else {
                    n = work[j - 15]; next = work[j - 2];
                    work[j] = (work[j - 16] + (rotate(n, 7) ^ rotate(n, 18) ^ (n >>> 3)) + work[j - 7] + (rotate(next, 17) ^ rotate(next, 19) ^ (next >>> 10))) | 0;
                }
            }
            a = h[0]; b = h[1]; c = h[2]; d = h[3]; e = h[4]; f = h[5]; g = h[6]; v = h[7];
            for (j = 0; j < 64; j++) {
                t1 = (v + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[j] + work[j]) | 0;
                t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                v = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
            h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + v) | 0;
        }
        for (i = 0; i < h.length; i++) result += ("00000000" + (h[i] >>> 0).toString(16)).slice(-8);
        return result;
    }
    function hashPin(pin, salt, count) {
        var digest = sha256(salt + ":" + pin), i;
        for (i = 1; i < count; i++) digest = sha256(salt + ":" + digest);
        return digest;
    }
    function defaults() {
        return { schema: 1, enabled: false, salt: "", hash: "", iterations: iterations, protectedIds: [],
            scopes: { settings: true, source: true, import: true, restore: true, export: true, proxy: true, remote: true },
            sessionMinutes: 5, failures: 0, blockedUntil: 0 };
    }
    function validate(value) {
        var result = defaults(), i, id;
        if (value === undefined || value === null) return result;
        if (typeof value !== "object" || Array.isArray(value) || value.schema !== 1 || typeof value.enabled !== "boolean") throw new Error("Unsupported parental-control format");
        result.enabled = value.enabled === true;
        if (result.enabled) {
            if (typeof value.salt !== "string" || !/^[a-z0-9:.-]{16,160}$/i.test(value.salt) || typeof value.hash !== "string" || !/^[a-f0-9]{64}$/i.test(value.hash)) throw new Error("Invalid parental-control hash");
            if (typeof value.iterations !== "number" || value.iterations % 1 || value.iterations < 1024 || value.iterations > 8192) throw new Error("Invalid parental-control work factor");
            result.salt = value.salt; result.hash = value.hash.toLowerCase(); result.iterations = value.iterations;
        }
        if (value.protectedIds !== undefined && (!Array.isArray(value.protectedIds) || value.protectedIds.length > 50000)) throw new Error("Invalid protected channels");
        for (i = 0; i < (value.protectedIds || []).length; i++) {
            id = value.protectedIds[i];
            if (typeof id !== "string" || !id || id.length > 4096) throw new Error("Invalid protected channel ID");
            if (result.protectedIds.indexOf(id) === -1) result.protectedIds.push(id);
        }
        if (value.scopes !== undefined && (!value.scopes || typeof value.scopes !== "object" || Array.isArray(value.scopes))) throw new Error("Invalid protection scopes");
        for (i = 0; i < scopeNames.length; i++) if (value.scopes && has.call(value.scopes, scopeNames[i])) result.scopes[scopeNames[i]] = value.scopes[scopeNames[i]] !== false;
        result.sessionMinutes = typeof value.sessionMinutes === "number" && value.sessionMinutes >= 1 && value.sessionMinutes <= 30 ? Math.floor(value.sessionMinutes) : 5;
        result.failures = typeof value.failures === "number" && isFinite(value.failures) ? Math.max(0, Math.min(30, Math.floor(value.failures))) : 0;
        result.blockedUntil = typeof value.blockedUntil === "number" && isFinite(value.blockedUntil) ? Math.max(0, value.blockedUntil) : 0;
        return result;
    }
    function validPin(pin) { return typeof pin === "string" && /^[0-9]{4,12}$/.test(pin); }
    function equal(left, right) {
        var different = left.length ^ right.length, i;
        for (i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
        return different === 0;
    }
    function create(options) {
        options = options || {};
        var local = defaults(), grantUntil = 0, lastClock = 0, identity = "", source = null;
        function clock() {
            var value = options.now ? options.now() : new Date().getTime();
            if (typeof value !== "number" || !isFinite(value) || value < 0) { grantUntil = 0; return lastClock; }
            if (value < lastClock) grantUntil = 0;
            lastClock = value;
            return value;
        }
        function save(config) {
            local = validate(config);
            if (options.persist) options.persist(validate(local));
            return local;
        }
        function read() {
            var state = options.getState ? options.getState() : local;
            var config = validate(state && has.call(state, "security") ? state.security : state);
            var currentIdentity = config.enabled + ":" + config.salt + ":" + config.hash;
            var currentSource = state && typeof state.activeSourceId === "string" ? state.activeSourceId : null;
            if (identity !== currentIdentity || (source !== null && currentSource !== source)) grantUntil = 0;
            identity = currentIdentity; source = currentSource;
            return config;
        }
        function lock() { grantUntil = 0; }
        function status() {
            var config = read(), time = clock();
            if (config.blockedUntil > time + maxBlock) { config.blockedUntil = time + maxBlock; save(config); }
            return { enabled: config.enabled, unlocked: config.enabled && grantUntil > time, expiresAt: grantUntil > time ? grantUntil : 0,
                retryAfter: Math.max(0, Math.ceil((config.blockedUntil - time) / 1000)), failures: config.failures };
        }
        function verify(pin) {
            var config = read(), time = clock(), wait, correct;
            if (!config.enabled) return { ok: true, code: "DISABLED" };
            if (config.blockedUntil > time + maxBlock) { config.blockedUntil = time + maxBlock; save(config); }
            wait = Math.max(0, Math.ceil((config.blockedUntil - time) / 1000));
            if (wait) return { ok: false, code: "RATE_LIMIT", retryAfter: wait };
            correct = validPin(pin) && equal(hashPin(pin, config.salt, config.iterations), config.hash);
            if (!correct) {
                lock(); config.failures = Math.min(30, config.failures + 1);
                if (config.failures >= 5) config.blockedUntil = time + Math.min(maxBlock, 30000 * Math.pow(2, Math.min(4, config.failures - 5)));
                save(config);
                return { ok: false, code: config.blockedUntil > time ? "RATE_LIMIT" : "WRONG_PIN", retryAfter: Math.max(0, Math.ceil((config.blockedUntil - time) / 1000)) };
            }
            config.failures = 0; config.blockedUntil = 0; save(config);
            grantUntil = time + config.sessionMinutes * 60000;
            return { ok: true, code: "AUTHORIZED", expiresAt: grantUntil };
        }
        function isProtected(channelId, action) {
            var config = read();
            if (!config.enabled) return false;
            action = action || "playback";
            if (playbackActions.indexOf(action) !== -1) return !channelId || config.protectedIds.indexOf(channelId) !== -1;
            return !has.call(config.scopes, action) || config.scopes[action];
        }
        function authorize(action, channelId, pin) {
            if (!isProtected(channelId, action)) return { ok: true, code: "UNPROTECTED" };
            if (pin !== undefined) return verify(pin);
            var current = status();
            if (current.retryAfter) return { ok: false, code: "RATE_LIMIT", retryAfter: current.retryAfter };
            return current.unlocked ? { ok: true, code: "SESSION", expiresAt: current.expiresAt } : { ok: false, code: "PIN_REQUIRED" };
        }
        function salt() {
            var bytes, i, text = "", host = typeof window !== "undefined" ? window : {}, crypto = host.crypto || host.msCrypto;
            try {
                if (options.randomBytes) bytes = options.randomBytes(16);
                else if (crypto && crypto.getRandomValues && host.Uint8Array) { bytes = new host.Uint8Array(16); crypto.getRandomValues(bytes); }
                if (bytes && bytes.length >= 16) {
                    for (i = 0; i < 16; i++) {
                        if (typeof bytes[i] !== "number" || bytes[i] < 0 || bytes[i] > 255 || bytes[i] % 1) throw new Error("Invalid salt byte");
                        text += ("0" + bytes[i].toString(16)).slice(-2);
                    }
                    return text;
                }
            } catch (ignore) { /* A salt is public and need not be unpredictable. */ }
            serial++;
            return "clock-" + clock().toString(36) + "-" + serial.toString(36) + "-public-salt";
        }
        function configure(currentPin, newPin, callback) {
            var config = read(), result;
            if (!validPin(newPin)) result = { ok: false, code: "PIN_FORMAT" };
            else if (config.enabled && !(result = verify(currentPin)).ok) { /* Keep existing configuration. */ }
            else {
                config.enabled = true; config.salt = salt(); config.iterations = iterations;
                config.hash = hashPin(newPin, config.salt, config.iterations); config.failures = 0; config.blockedUntil = 0;
                save(config); lock(); result = { ok: true, code: "CONFIGURED" };
            }
            if (callback) callback(result);
            return result;
        }
        function setProtected(id, protect, pin) {
            if (typeof id !== "string" || !id || id.length > 4096) return { ok: false, code: "CHANNEL_ID" };
            if (!read().enabled) return { ok: false, code: "PIN_NOT_CONFIGURED" };
            var result = authorize("security", "", pin), config, index;
            if (!result.ok) return result;
            config = read(); index = config.protectedIds.indexOf(id);
            if (protect && index === -1) config.protectedIds.push(id);
            else if (!protect && index !== -1) config.protectedIds.splice(index, 1);
            save(config); return { ok: true, code: "UPDATED" };
        }
        function setScopes(scopes, pin) {
            var result = authorize("security", "", pin), config;
            if (!result.ok) return result;
            config = read(); config.scopes = scopes; save(config); lock();
            return { ok: true, code: "UPDATED" };
        }
        function disable(pin) {
            var result = verify(pin);
            if (!result.ok) return result;
            save(defaults()); lock(); return { ok: true, code: "DISABLED" };
        }
        return { configure: configure, verify: verify, isProtected: isProtected, authorize: authorize, lock: lock,
            resetSession: lock, status: status, setProtected: setProtected, setScopes: setScopes, disable: disable };
    }
    return { create: create, defaults: defaults, validate: validate, sha256: sha256, hashPin: hashPin };
});
