/* Independent ES5 provider contracts. External metadata is returned as data.
 * load(source, callback) -> {channels, epgUrls, warnings}; all operations return
 * an idempotent cancel function, and cancelled operations never call back.
 * browse(source, folder|null, callback) -> {items, warnings}. A null folder
 * lists the loaded source's VOD roots. Only kind:"folder" may be browsed;
 * kind:"vod" and kind:"live" go through resolve(item, callback) -> {url, channel}.
 * Folder metadata is opaque to the controller; keep the returned object intact.
 * close(sourceId) drops cached session data after the controller cancels work.
 * request(url, callback, {headers}) is the injected cancellable transport.
 * portalTransport must explicitly report a configured cookie-capable relay.
 * Stalker session tokens and media commands never leave the provider instance.
 *
 * Protocol evidence (independent implementation; no source code imported):
 * Kodi pvr.stalker/Piers: src/stalker/SAPI.cpp and lib/libstalkerclient/{stb,itv,request}.c
 * Stalker server API: server/lib/vod.class.php (is_movie/is_season/is_episode/is_file).
 * Xtream: get_series/get_series_info, /series/user/password/id.extension;
 * Kodi pvr.iptvsimple/Piers/src/iptvsimple/data/Channel.cpp confirms timeshift URLs.
 * These fixture-backed contracts do not certify a commercial account or decoder.
 */
(function (root) {
    "use strict";
    root.OTT2.define("providers", function () {
        function trim(value) {
            return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
        }

        function fault(code, message) {
            var error = new Error(message);
            error.code = code;
            return error;
        }

        function httpUrl(value) {
            var url = trim(value);
            var parts;
            var port;
            if (!url || /[\u0000-\u0020\u007f\\<>"|]/.test(url)) return "";
            parts = /^(https?):\/\/([^\/?#]+)(?:[\/?#]|$)/i.exec(url);
            if (!parts || /@/.test(parts[2])) return "";
            if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9\u0080-\uffff.-]+)(?::[0-9]{1,5})?$/i.test(parts[2])) return "";
            port = /:([0-9]+)$/.exec(parts[2]);
            if (port && Number(port[1]) > 65535) return "";
            return url;
        }

        function relativeUrl(value, base) {
            var input = trim(value), parts, path, suffix, segments, output = [], i;
            if (!input) return "";
            if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return httpUrl(input);
            base = httpUrl(base);
            if (!base || /[\u0000-\u0020\u007f\\<>"|]/.test(input)) return "";
            parts = /^(https?:)\/\/([^\/?#]+)([^?#]*)/.exec(base);
            if (input.slice(0, 2) === "//") return httpUrl(parts[1] + input);
            if (input.charAt(0) === "?") return httpUrl(parts[1] + "//" + parts[2] + (parts[3] || "/") + input);
            if (input.charAt(0) === "#") return httpUrl(base.replace(/#.*$/, "") + input);
            suffix = /[?#].*$/.exec(input);
            path = input.replace(/[?#].*$/, "");
            if (path.charAt(0) !== "/") path = (parts[3] || "/").replace(/[^/]*$/, "") + path;
            segments = path.split("/");
            for (i = 0; i < segments.length; i += 1) {
                if (segments[i] === "..") { if (output.length > 1) output.pop(); }
                else if (segments[i] !== ".") output.push(segments[i]);
            }
            return httpUrl(parts[1] + "//" + parts[2] + output.join("/") + (suffix ? suffix[0] : ""));
        }

        function hash(value) {
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

        function namespace(source) {
            var id = trim(source && source.id);
            if (!id) throw fault("SOURCE_ID", "A persistent source ID is required");
            return encodeURIComponent(id);
        }

        function parseM3U(text, source) {
            var prefix = namespace(source || { id: "playlist" });
            var result = root.OttPlayCore.parseBrowserPlaylist(String(text == null ? "" : text), prefix,
                String(source && source.id || "playlist"), function (value) { return relativeUrl(value, source && source.url); },
                hash, encodeURIComponent);
            if (result.failure) {
                if (result.failure === "EMPTY") throw fault("M3U_FORMAT", "The playlist is empty");
                if (result.failure === "FORMAT") throw fault("M3U_FORMAT", "The source is not an EXTM3U playlist");
                throw fault("M3U_LIMIT", "The playlist exceeds the supported size limit");
            }
            return result;
        }

        function parseJSON(value) {
            if (typeof value !== "string") return value;
            try { return JSON.parse(value); }
            catch (ignore) { throw fault("JSON_FORMAT", "The provider returned invalid JSON"); }
        }

        function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
        function configFor(source) {
            var config;
            namespace(source);
            config = {
                id: String(source.id), type: trim(source.type).toLowerCase(), url: httpUrl(source.url),
                username: String(source.username == null ? "" : source.username), password: String(source.password == null ? "" : source.password),
                mac: trim(source.mac).toUpperCase(), timezone: trim(source.timezone) || "UTC", language: trim(source.language) || "en",
                output: source.output === "ts" ? "ts" : "m3u8", profile: source.profile || {}
            };
            if (!config.url) throw fault("SOURCE_URL", "An absolute HTTP or HTTPS source URL is required");
            if (config.type !== "m3u" && config.type !== "xtream" && config.type !== "stalker") throw fault("UNSUPPORTED_PROVIDER", "This provider type is not supported");
            if (config.type === "xtream") {
                if (!config.username || !config.password) throw fault("SOURCE_CREDENTIALS", "Xtream requires a username and password");
                config.base = root.OttPlayCore.xtreamBase(config.url);
                config.xtream = xtreamClient(config);
                config.api = config.xtream.request();
            }
            if (config.type === "stalker") {
                var portal = stalkerResult(root.OttPlayCore.stalkerConfig(config));
                config.endpoint = portal.endpoint; config.referer = portal.referer; config.fingerprint = portal.fingerprint;
            }
            return config;
        }
        function safeNetworkError(error) {
            if (error && (error.status === 401 || error.status === 403 || error.code === "AUTHENTICATION")) return fault("AUTHENTICATION", "The provider did not accept this session or account");
            if (error && error.code === "TIMEOUT") return fault("TIMEOUT", "The provider request timed out");
            if (error && error.code === "RESPONSE_SIZE") return fault("RESPONSE_SIZE", "The provider response exceeds the allowed size");
            if (error && error.code === "PORTAL_TRANSPORT") return fault("PORTAL_TRANSPORT", "This portal needs the configured local relay or a native HTTP transport");
            return fault("NETWORK", "The provider request failed");
        }
        function portalBody(value) {
            if (typeof value === "string" && root.OttPlayCore.stalkerTextDenied(value)) throw fault("AUTHENTICATION", "The portal did not accept this session");
            return parseJSON(value);
        }

        function create(options) {
            var request = options && options.request;
            var sessions = {};
            var catalogs = {};
            var seriesCache = {};
            var generation = 0;

            function operation(callback) {
                var active = true, requests = [];
                function abortOutstanding() {
                    var i, entry;
                    for (i = 0; i < requests.length; i += 1) {
                        entry = requests[i];
                        if (!entry.settled && !entry.aborted && entry.cancel) {
                            entry.aborted = true;
                            try { entry.cancel(); } catch (ignore) {}
                        }
                    }
                }
                function cancel() {
                    if (!active) return;
                    active = false;
                    abortOutstanding();
                    requests.length = 0;
                }
                function finish(error, result) {
                    if (!active) return;
                    active = false;
                    abortOutstanding();
                    requests.length = 0;
                    callback(error || null, result);
                }
                function get(url, consume, extra) {
                    var entry = { settled: false, cancel: null, aborted: false }, cancellation;
                    if (!active) return;
                    if (typeof request !== "function") { finish(fault("TRANSPORT_UNAVAILABLE", "No HTTP transport is configured")); return; }
                    requests.push(entry);
                    try {
                        cancellation = request(url, function (error, value) {
                            if (!active || entry.settled) return;
                            entry.settled = true;
                            entry.cancel = null;
                            if (error) { finish(safeNetworkError(error)); return; }
                            try { consume(value); }
                            catch (parseError) {
                                if (!active) throw parseError;
                                finish(parseError && parseError.code ? parseError : fault("PROVIDER_FORMAT", "The provider returned an unsupported response"));
                            }
                        }, extra);
                        if (typeof cancellation === "function" && !entry.settled) entry.cancel = cancellation;
                        if (!active && entry.cancel && !entry.aborted) {
                            entry.aborted = true;
                            try { entry.cancel(); } catch (ignoreCancel) {}
                            entry.cancel = null;
                        }
                    } catch (error) {
                        if (!active) throw error;
                        entry.settled = true;
                        finish(safeNetworkError(error));
                    }
                }
                return { cancel: cancel, finish: finish, get: get };
            }
            function portalReady() {
                return !!(options && (options.portalTransport === true || (typeof options.portalTransport === "function" && options.portalTransport())));
            }
            function runPortal(op, state, done) {
                function next() {
                    var request = state.request();
                    if (request === null) { done(state.result()); return; }
                    if (!portalReady()) { op.finish(fault("PORTAL_TRANSPORT", "This portal needs the configured local relay or a native HTTP transport")); return; }
                    op.get(request.url, function (value) { stalkerResult(state.accept(portalBody(value))); next(); }, { headers: request.headers });
                }
                try { state = stalkerResult(state); next(); }
                catch (error) { op.finish(error); }
            }

            function portalSession(config) {
                var session = sessions["$" + config.id];
                if (!session) throw fault("PORTAL_SESSION", "Reload this portal before opening its catalog");
                stalkerResult(session.verify(config.fingerprint));
                return session;
            }


            function loadPortal(config, op) {
                var session = new root.OttPlayCore.StalkerClient(config, ++generation, encodeURIComponent,
                    function (value) { return relativeUrl(value, config.endpoint); }, httpUrl);
                runPortal(op, session.load(), function (result) {
                    sessions["$" + config.id] = session;
                    catalogs["$" + config.id] = result;
                    op.finish(null, result);
                });
            }

            function load(source, callback) {
                var op = operation(callback), config;
                try { config = configFor(source); }
                catch (error) { op.finish(error); return op.cancel; }
                if (config.type === "m3u") {
                    op.get(config.url, function (text) {
                        var result = parseM3U(text, config);
                        catalogs["$" + config.id] = result;
                        op.finish(null, result);
                    });
                } else if (config.type === "stalker") loadPortal(config, op);
                else {
                    function step() {
                        var url = config.xtream.request(), result;
                        if (url === null) {
                            result = xtreamResult(config.xtream.catalog());
                            catalogs["$" + config.id] = result;
                            op.finish(null, result);
                            return;
                        }
                        op.get(url, function (response) {
                            xtreamResult(config.xtream.accept(parseJSON(response)));
                            step();
                        });
                    }
                    step();
                }
                return op.cancel;
            }
            function browse(source, node, callback) {
                var op = operation(callback), config, session, result, rows, i;
                try {
                    config = configFor(source);
                    if (node && String(node.sourceId) !== config.id) throw fault("SOURCE_MISMATCH", "This folder belongs to another source");
                    if (node && node.kind !== "folder") throw fault("FOLDER_REQUIRED", "Select a folder to browse");
                    if (!node) {
                        rows = catalogs["$" + config.id];
                        result = { items: [], warnings: [] };
                        if (rows) for (i = 0; i < rows.channels.length; i += 1) if (rows.channels[i].kind !== "live") result.items.push(rows.channels[i]);
                        op.finish(null, result);
                    } else if (config.type === "xtream") browseXtream(op, config, node);
                    else if (config.type === "stalker") {
                        session = portalSession(config);
                        browsePortal(op, session, node);
                    } else throw fault("UNSUPPORTED_FOLDER", "This source does not provide nested folders");
                } catch (error) { op.finish(error); }
                return op.cancel;
            }
            function browseXtream(op, config, node) {
                var cacheKey = "$" + config.api + "\n" + node.seriesId;
                var request = xtreamResult(config.xtream.seriesRequest(node));
                function deliver(value) {
                    op.finish(null, { items: (node.folderType === "season" ? value.episodes["$" + node.seasonNumber] || [] : value.folders).slice(0), warnings: value.warnings.slice(0) });
                }
                if (has(seriesCache, cacheKey)) { deliver(seriesCache[cacheKey]); return; }
                op.get(request.url, function (text) {
                    var value = xtreamResult(config.xtream.series(parseJSON(text), node));
                    // A bounded cache avoids retaining every catalogue episode on small devices.
                    seriesCache = {};
                    seriesCache[cacheKey] = value;
                    deliver(value);
                });
            }
            function browsePortal(op, session, node) {
                runPortal(op, session.browse(node), function (result) { op.finish(null, result); });
            }

            function resolve(channel, callback) {
                var op = operation(callback), session, url;
                if (channel && channel.kind === "folder") { op.finish(fault("FOLDER_REQUIRED", "Open this folder before choosing a video")); return op.cancel; }
                if (channel && channel.provider === "stalker") {
                    session = sessions["$" + channel.sourceId];
                    if (!session) op.finish(fault("PORTAL_SESSION", "Reload this portal before playing its media"));
                    else runPortal(op, session.playback(channel), function (result) {
                        result.channel = channel;
                        op.finish(null, result);
                    });
                } else {
                    url = httpUrl(channel && channel.url);
                    if (!url) op.finish(fault("STREAM_URL", "This channel has no supported HTTP or HTTPS stream URL"));
                    else op.finish(null, { url: url, channel: channel });
                }
                return op.cancel;
            }
            function close(sourceId) {
                delete sessions["$" + sourceId];
                delete catalogs["$" + sourceId];
                seriesCache = {};
            }
            return { load: load, resolve: resolve, browse: browse, close: close };
        }

        function xtreamClient(source) {
            return new root.OttPlayCore.XtreamClient(source, false, function (path, values) {
                return source.base + "/" + path.map(encodeURIComponent).join("/") + (values.length ? "?" + values.map(function (pair) {
                    return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]);
                }).join("&") : "");
            }, httpUrl, encodeURIComponent, function (parts) { return hash(parts.join("\u0000")); });
        }
        function xtreamResult(result) {
            var messages = {
                BROWSER_AUTH: ["AUTHENTICATION", "Xtream authentication was not accepted or the account is inactive"],
                RESPONSE_AUTH: ["AUTHENTICATION", "The provider did not accept this account"],
                BROWSER_CATALOG: ["XTREAM_FORMAT", "The provider returned an invalid catalog"],
                BROWSER_SERIES: ["XTREAM_FORMAT", "Xtream returned invalid series details"],
                FOLDER: ["XTREAM_FOLDER", "This is not a supported series folder"]
            }, message;
            if (result && result.failure) {
                message = messages[result.failure] || ["PROVIDER_FORMAT", "The provider returned an unsupported response"];
                throw fault(message[0], message[1]);
            }
            return result;
        }
        function stalkerResult(result) {
            var messages = {
                SOURCE_MAC: ["SOURCE_MAC", "Enter the MAC address registered with your portal"],
                PORTAL_URL: ["PORTAL_URL", "Use the portal /c/ URL or its explicit load.php or portal.php endpoint"],
                PORTAL_PROFILE: ["PORTAL_PROFILE", "The portal device model is invalid"],
                PORTAL_FORMAT: ["PORTAL_FORMAT", "The portal returned an invalid response"],
                PORTAL_AUTH: ["AUTHENTICATION", "The portal did not accept this session or media request"],
                HANDSHAKE: ["AUTHENTICATION", "The portal handshake did not return a valid session"],
                PROFILE_AUTH: ["AUTHENTICATION", "The portal account is blocked or its profile was not accepted"],
                SECOND_AUTH: ["PORTAL_AUTH_REQUIRED", "This portal requires an additional operator-specific authentication step"],
                GENRES_FORMAT: ["PORTAL_FORMAT", "The portal returned invalid channel categories"],
                CATEGORIES_FORMAT: ["PORTAL_FORMAT", "The portal returned invalid movie categories"],
                PAGE_FORMAT: ["PORTAL_FORMAT", "The portal returned an invalid catalog page"],
                TOTAL_FORMAT: ["PORTAL_FORMAT", "The portal returned an invalid catalog size"],
                BROWSER_COUNT: ["CATALOG_LIMIT", "This portal catalog exceeds 50000 items; choose a smaller category"],
                ROW_ID: ["PORTAL_FORMAT", "The portal returned a catalog item without an ID"],
                EARLY_PAGE: ["PORTAL_PAGINATION", "The portal ended its catalog before the declared number of items"],
                REPEAT_PAGE: ["PORTAL_PAGINATION", "The portal repeated a catalog page; loading was stopped"],
                PAGE_LIMIT: ["CATALOG_LIMIT", "The portal catalog reached the supported size limit"],
                SESSION_CATALOG: ["PORTAL_SESSION", "Reload this portal before opening its catalog"],
                SESSION_FOLDER: ["PORTAL_SESSION", "Reload this folder after the portal session changed"],
                SESSION_PLAYBACK: ["PORTAL_SESSION", "Reload this portal before playing its media"],
                UNSUPPORTED_FOLDER: ["UNSUPPORTED_FOLDER", "The portal folder type is not supported"],
                STREAM_URL: ["STREAM_URL", "The portal did not return a supported HTTP or HTTPS stream URL"]
            }, message;
            if (result && result.failure) {
                message = messages[result.failure] || ["PROVIDER_FORMAT", "The provider returned an unsupported response"];
                throw fault(message[0], message[1]);
            }
            return result;
        }

        return { parseM3U: parseM3U, create: create, httpUrl: httpUrl, relativeUrl: relativeUrl };
    });
}(window));
