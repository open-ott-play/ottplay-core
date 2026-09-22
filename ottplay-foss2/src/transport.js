OTT2.define("transport", function () {
    "use strict";
    function failure(message, code, status) { var error = new Error(message); error.code = code; error.status = status || 0; return error; }
    function create(environment, configuration) {
        configuration = configuration || {};
        return function request(url, callback, options) {
            options = options || {};
            var xhr, done = false, timer, builtin = options.builtinEPG === true;
            var relay = !builtin && (typeof configuration.relay === "function" ? configuration.relay() : configuration.relay === true);
            var responseLimit = 16 * 1024 * 1024;
            function finish(error, text) {
                if (done) return;
                done = true; environment.clearTimeout(timer);
                if (xhr) xhr.onreadystatechange = xhr.onerror = xhr.ontimeout = xhr.onprogress = null;
                callback(error, text);
            }
            function checkSize() {
                var length = 0;
                if (done || !xhr) return done;
                try { length = xhr.responseText.length; } catch (ignore) {}
                if (length <= responseLimit) return false;
                finish(failure("Source exceeds 16 MB limit", "RESPONSE_SIZE"));
                try { xhr.abort(); } catch (ignoreAbort) {}
                return true;
            }
            function httpFailure() {
                var code = "HTTP", body;
                if (relay || builtin) {
                    try { body = xhr.responseText; } catch (ignore) {}
                    // Relay failures are a fixed vocabulary, never reflected upstream text.
                    if (/^(?:RELAY_DISABLED|POST_REQUIRED|SAME_ORIGIN_REQUIRED|JSON_REQUIRED|RELAY_BUSY|REQUEST_TOO_LARGE|INVALID_RELAY_REQUEST|UPSTREAM_ORIGIN_NOT_ALLOWED|UPSTREAM_ADDRESS_NOT_ALLOWED|DNS_FAILED|REDIRECT_LIMIT|INVALID_REDIRECT|REDIRECT_DOWNGRADE|UPSTREAM_STATUS|COMPRESSED_RESPONSE_UNSUPPORTED|INVALID_COMPRESSED_RESPONSE|RESPONSE_TOO_LARGE|UPSTREAM_TIMEOUT|UPSTREAM_FAILED|UPSTREAM_ABORTED)$/.test(body || "")) code = body;
                    if (builtin && /^(?:EPG_REQUEST|EPG_BUSY|EPG_REQUEST_TIMEOUT|EPG_REQUEST_TOO_LARGE|EPG_TIMEOUT|EPG_UPSTREAM|EPG_WIRE_TOO_LARGE|EPG_DECODED_TOO_LARGE|EPG_TOO_LARGE|EPG_FIELD_TOO_LARGE|EPG_XML|EPG_GZIP)$/.test(body || "")) code = body;
                }
                return failure(xhr.status ? "Source returned HTTP " + xhr.status : "Network or CORS error", code, xhr.status);
            }
            if (!/^https?:\/\//i.test(url)) {
                timer = environment.setTimeout(function () { finish(new Error("Only HTTP/HTTPS sources are supported")); }, 0);
            } else {
                try {
                    xhr = new environment.XMLHttpRequest();
                    xhr.open(builtin || relay ? "POST" : "GET", builtin ? "/api/epg" : relay ? "/api/relay" : url, true);
                    if (relay || builtin) xhr.setRequestHeader("Content-Type", "application/json");
                    if (builtin) xhr.setRequestHeader("X-OTT2-EPG", "1");
                    if (!relay && !builtin && options.headers && options.headers.Cookie) throw failure("Portal requires configured relay", "PORTAL_TRANSPORT");
                    if (!relay && !builtin && options.headers) Object.keys(options.headers).forEach(function (name) { xhr.setRequestHeader(name, options.headers[name]); });
                    xhr.onreadystatechange = function () {
                        if (xhr.readyState >= 3 && checkSize()) return;
                        if (xhr.readyState !== 4) return;
                        if (xhr.status >= 200 && xhr.status < 300) {
                            finish(null, xhr.responseText);
                        } else finish(httpFailure());
                    };
                    xhr.onprogress = checkSize;
                    xhr.onerror = function () { finish(failure("Network or CORS error", "NETWORK")); };
                    timer = environment.setTimeout(function () { finish(failure("Source timed out", builtin ? "EPG_TIMEOUT" : "TIMEOUT")); try { xhr.abort(); } catch (ignore) {} }, builtin ? 125000 : 20000);
                    xhr.send(builtin ? JSON.stringify({ channels: (options.channels || []).map(function (channel) {
                        return { tvgId: String(channel.tvgId || ""), tvgName: String(channel.tvgName || ""), name: String(channel.name || ""), archiveDays: Math.max(0, Math.min(7, (Number(channel.archiveDays) || 0))) };
                    }) }) : relay ? JSON.stringify({ url: url, headers: options.headers || {} }) : null);
                } catch (error) { timer = environment.setTimeout(function () { finish(failure("Source request could not start", error.code === "PORTAL_TRANSPORT" ? "PORTAL_TRANSPORT" : "NETWORK")); }, 0); }
            }
            return function cancel() { done = true; environment.clearTimeout(timer); if (xhr) { xhr.onreadystatechange = xhr.onerror = xhr.ontimeout = xhr.onprogress = null; try { xhr.abort(); } catch (ignore) {} } };
        };
    }
    return { create: create };
});
