/* Local parental controls, not provider authentication or a device-owner boundary.
 * New PINs use native Web Crypto PBKDF2. Legacy hashes are read only to migrate
 * after successful authentication. No weak crypto or entropy fallback exists.
 */
OTT2.define("security", function () {
    "use strict";
    var has = Object.prototype.hasOwnProperty, iterations = 600000, algorithm = "PBKDF2-HMAC-SHA256";
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function defaults() { return OttPlayCore.parentalDefaults(); }
    function finiteInteger(value, minimum, maximum) {
        return typeof value === "number" && isFinite(value) && value % 1 === 0 && value >= minimum && value <= maximum;
    }
    function validate(value) {
        var modern = value && value.schema === 2, base, result;
        if (value && value.enabled && !finiteInteger(value.iterations, modern ? iterations : 1024, modern ? 2000000 : 8192)) throw new Error("Invalid parental-control work factor");
        if (!modern) return OttPlayCore.parentalValidate(value);
        if (value.enabled !== true || value.algorithm !== algorithm || typeof value.salt !== "string" || typeof value.hash !== "string" || !/^[0-9a-f]{32}$/.test(value.salt) || !/^[0-9a-f]{64}$/.test(value.hash)) throw new Error("Invalid parental-control KDF");
        // Crypto parameters are host effects. Reuse the same pure domain rules
        // even with an older pinned core; candidate-core CI checks both versions.
        base = copy(value); base.schema = 1; base.salt = "crypto-parameters-validated"; base.hash = new Array(65).join("0"); base.iterations = 2048;
        result = OttPlayCore.parentalValidate(base);
        result.schema = 2; result.algorithm = algorithm; result.salt = value.salt; result.hash = value.hash; result.iterations = value.iterations;
        return result;
    }
    function validPin(pin) { return OttPlayCore.parentalValidPin(pin); }
    function equal(left, right) {
        var different = left.length ^ right.length, i;
        for (i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
        return different === 0;
    }
    function environment(options) {
        var host = typeof window !== "undefined" ? window : {}, crypto = options.crypto || host.crypto;
        var Bytes = options.Uint8Array || host.Uint8Array;
        if (!crypto || !crypto.subtle || !crypto.subtle.importKey || !crypto.subtle.deriveBits || !crypto.subtle.digest || !Bytes) return null;
        return { crypto: crypto, Bytes: Bytes };
    }
    function hex(bytes) {
        var result = "", i;
        for (i = 0; i < bytes.length; i++) result += ("0" + bytes[i].toString(16)).slice(-2);
        return result;
    }
    function ascii(api, text) {
        var bytes = new api.Bytes(text.length), i;
        for (i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
        return bytes;
    }
    function saltBytes(api, text) {
        var bytes = new api.Bytes(16), i;
        for (i = 0; i < 16; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
        return bytes;
    }
    function freshSalt(api, options) {
        var bytes = new api.Bytes(16), i, supplied;
        if (options.randomBytes) {
            supplied = options.randomBytes(16);
            if (!supplied || supplied.length !== 16) throw new Error("Random bytes unavailable");
            for (i = 0; i < 16; i++) {
                if (!finiteInteger(supplied[i], 0, 255)) throw new Error("Invalid random byte");
                bytes[i] = supplied[i];
            }
        } else api.crypto.getRandomValues(bytes);
        return hex(bytes);
    }
    function derive(api, pin, salt, count) {
        return api.crypto.subtle.importKey("raw", ascii(api, pin), "PBKDF2", false, ["deriveBits"]).then(function (key) {
            return api.crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes(api, salt), iterations: count, hash: "SHA-256" }, key, 256);
        }).then(function (bytes) { return hex(new api.Bytes(bytes)); });
    }
    function legacy(api, pin, config) {
        var round = 0;
        function next(text) {
            return api.crypto.subtle.digest("SHA-256", ascii(api, config.salt + ":" + text)).then(function (bytes) {
                var digest = hex(new api.Bytes(bytes));
                return ++round < config.iterations ? next(digest) : digest;
            });
        }
        return next(pin);
    }
    function create(options) {
        options = options || {};
        var local = defaults(), session = new OttPlayCore.BrowserParentalSession(), generation = 0, pending = null, observed = "", currentSource = null, lastClock = 0;
        function lock() { generation++; pending = null; session.lock(); }
        function clock() {
            var value = options.now ? options.now() : new Date().getTime();
            if (typeof value !== "number" || !isFinite(value) || value < lastClock) lock();
            else lastClock = value;
            return session.clock(value);
        }
        function read() {
            var state = options.getState ? options.getState() : local;
            var config = validate(state && has.call(state, "security") ? state.security : state);
            var source = state && typeof state.activeSourceId === "string" ? state.activeSourceId : null;
            currentSource = source;
            var identity = config.enabled + ":" + config.schema + ":" + config.salt + ":" + config.hash;
            var signature = identity + ":" + source;
            if (observed && signature !== observed) lock();
            observed = signature; session.observe(identity, source);
            return config;
        }
        function save(config) {
            var validated = validate(config);
            if (!options.persist || options.persist(copy(validated)) !== true) throw new Error("Durable storage unavailable");
            local = validated;
        }
        function reply(callback, result) { if (callback) callback(result); return result; }
        function begin(callback) {
            var config = read(), time = clock(), api = environment(options);
            if (pending) return { result: reply(callback, { ok: false, code: "BUSY" }) };
            if (!api) { lock(); return { result: reply(callback, { ok: false, code: "CRYPTO_UNAVAILABLE" }) }; }
            var operation = { config: config, time: time, api: api, generation: generation, source: currentSource, stamp: JSON.stringify(config), callback: callback, done: false };
            pending = operation;
            return operation;
        }
        function current(operation) {
            try {
                var config = read(); clock();
                return pending === operation && operation.generation === generation && JSON.stringify(config) === operation.stamp;
            } catch (error) { lock(); return false; }
        }
        function finish(operation, result) {
            if (operation.done) return result;
            operation.done = true;
            if (pending === operation) pending = null;
            return reply(operation.callback, result);
        }
        function failed(operation, code) {
            if (!current(operation)) return finish(operation, { ok: false, code: "CANCELLED" });
            session.lock();
            return finish(operation, { ok: false, code: code });
        }
        function status() {
            var config = read(), time = clock();
            return { enabled: config.enabled, unlocked: config.enabled && session.expires(time) > 0, expiresAt: session.expires(time),
                retryAfter: OttPlayCore.parentalRetry(OttPlayCore.parentalBlock(config.blockedUntil, time), time), failures: config.failures, busy: !!pending };
        }
        function savedFor(operation, config) {
            // Persistence adapters can notify observers synchronously. Do not
            // turn a source switch/cancellation during that write into a grant.
            var time = clock();
            if (pending !== operation || operation.generation !== generation) return null;
            var latest = read();
            return currentSource === operation.source && JSON.stringify(latest) === JSON.stringify(validate(config)) ? time : null;
        }
        function storeAuthorized(operation, config) {
            if (!current(operation)) return finish(operation, { ok: false, code: "CANCELLED" });
            config.failures = 0; config.blockedUntil = 0;
            try { save(config); } catch (error) { return failed(operation, "STORAGE_UNAVAILABLE"); }
            var savedAt = savedFor(operation, config);
            if (savedAt === null) { lock(); return finish(operation, { ok: false, code: "CANCELLED" }); }
            var grantUntil = session.grant(savedAt, config.sessionMinutes);
            return finish(operation, { ok: true, code: "AUTHORIZED", expiresAt: grantUntil });
        }
        function verify(pin, callback) {
            var config = read(), time = clock(), wait, operation;
            if (!config.enabled) return reply(callback, { ok: true, code: "DISABLED" });
            wait = OttPlayCore.parentalRetry(OttPlayCore.parentalBlock(config.blockedUntil, time), time);
            if (wait) return reply(callback, { ok: false, code: "RATE_LIMIT", retryAfter: wait });
            operation = begin(callback);
            if (operation.result) return operation.result;
            function checked(digest) {
                if (!current(operation)) return finish(operation, { ok: false, code: "CANCELLED" });
                if (!validPin(pin) || !equal(digest, config.hash)) {
                    session.lock(); config.failures = OttPlayCore.parentalFailedCount(config.failures);
                    config.blockedUntil = OttPlayCore.parentalFailedBlock(config.failures, OttPlayCore.parentalBlock(config.blockedUntil, time), time);
                    try { save(config); } catch (error) { return failed(operation, "STORAGE_UNAVAILABLE"); }
                    return finish(operation, { ok: false, code: config.blockedUntil > time ? "RATE_LIMIT" : "WRONG_PIN", retryAfter: OttPlayCore.parentalRetry(config.blockedUntil, time) });
                }
                if (config.schema === 2) return storeAuthorized(operation, config);
                var salt;
                try { salt = freshSalt(operation.api, options); } catch (error) { return failed(operation, "RANDOM_UNAVAILABLE"); }
                return derive(operation.api, pin, salt, iterations).then(function (hash) {
                    config.schema = 2; config.algorithm = algorithm; config.salt = salt; config.iterations = iterations; config.hash = hash;
                    return storeAuthorized(operation, config);
                });
            }
            if (!validPin(pin)) { checked(""); return { ok: false, code: "PENDING" }; }
            var calculation;
            try { calculation = config.schema === 2 ? derive(operation.api, pin, config.salt, config.iterations) : legacy(operation.api, pin, config); }
            catch (error) { return failed(operation, "CRYPTO_UNAVAILABLE"); }
            calculation.then(checked).then(null, function () { failed(operation, "CRYPTO_UNAVAILABLE"); });
            return { ok: false, code: "PENDING" };
        }
        function configure(currentPin, newPin, callback) {
            if (!validPin(newPin)) return reply(callback, { ok: false, code: "PIN_FORMAT" });
            if (pending) return reply(callback, { ok: false, code: "BUSY" });
            function change() {
                lock();
                var operation = begin(callback), salt, calculation;
                if (operation.result) return operation.result;
                try { salt = freshSalt(operation.api, options); } catch (error) { return failed(operation, "RANDOM_UNAVAILABLE"); }
                try { calculation = derive(operation.api, newPin, salt, iterations); }
                catch (error) { return failed(operation, "CRYPTO_UNAVAILABLE"); }
                calculation.then(function (hash) {
                    if (!current(operation)) return finish(operation, { ok: false, code: "CANCELLED" });
                    var config = operation.config;
                    config.enabled = true; config.schema = 2; config.algorithm = algorithm; config.salt = salt; config.iterations = iterations; config.hash = hash;
                    config.failures = 0; config.blockedUntil = 0;
                    try { save(config); } catch (error) { return failed(operation, "STORAGE_UNAVAILABLE"); }
                    if (savedFor(operation, config) === null) { lock(); return finish(operation, { ok: false, code: "CANCELLED" }); }
                    session.lock();
                    return finish(operation, { ok: true, code: "CONFIGURED" });
                }).then(null, function () { failed(operation, "CRYPTO_UNAVAILABLE"); });
                return { ok: false, code: "PENDING" };
            }
            if (read().enabled) return verify(currentPin, function (result) { if (result.ok) change(); else reply(callback, result); });
            return change();
        }
        function isProtected(channelId, action) { return OttPlayCore.parentalProtected(read(), channelId, action); }
        function authorize(action, channelId, pin, callback) {
            if (!isProtected(channelId, action)) return reply(callback, { ok: true, code: "UNPROTECTED" });
            if (pin !== undefined) return verify(pin, callback);
            var now = status();
            if (now.retryAfter) return reply(callback, { ok: false, code: "RATE_LIMIT", retryAfter: now.retryAfter });
            return reply(callback, now.unlocked ? { ok: true, code: "SESSION", expiresAt: now.expiresAt } : { ok: false, code: "PIN_REQUIRED" });
        }
        function edit(pin, mutate, callback) {
            function apply(result) {
                if (!result.ok) return reply(callback, result);
                var config = read(); mutate(config);
                try { save(config); } catch (error) { lock(); return reply(callback, { ok: false, code: "STORAGE_UNAVAILABLE" }); }
                return reply(callback, { ok: true, code: "UPDATED" });
            }
            if (pin !== undefined) return authorize("security", "", pin, apply);
            return apply(authorize("security", ""));
        }
        function setProtected(id, protect, pin, callback) {
            if (!OttPlayCore.parentalChannelId(id)) return reply(callback, { ok: false, code: "CHANNEL_ID" });
            if (!read().enabled) return reply(callback, { ok: false, code: "PIN_NOT_CONFIGURED" });
            return edit(pin, function (config) { OttPlayCore.editFavoriteSelection(config.protectedIds, id, protect ? "add" : "remove"); }, callback);
        }
        function setScopes(scopes, pin, callback) {
            return edit(pin, function (config) { config.scopes = scopes; session.lock(); }, callback);
        }
        function disable(pin, callback) {
            return verify(pin, function (result) {
                if (!result.ok) return reply(callback, result);
                try { save(defaults()); } catch (error) { lock(); return reply(callback, { ok: false, code: "STORAGE_UNAVAILABLE" }); }
                lock(); return reply(callback, { ok: true, code: "DISABLED" });
            });
        }
        return { configure: configure, verify: verify, isProtected: isProtected, authorize: authorize, lock: lock,
            resetSession: lock, status: status, setProtected: setProtected, setScopes: setScopes, disable: disable };
    }
    return { create: create, defaults: defaults, validate: validate };
});
