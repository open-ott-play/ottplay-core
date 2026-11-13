OTT2.define("local-media", function () {
    "use strict";
    var core = OttPlayCore;
    var key = "ottplay2:local:v1";
    function create(environment, options) {
        options = options || {};
        var storage = options.storage, data = { version: 1, sources: [], selected: "", current: "", position: 0, bookmarks: {}, shuffle: false, repeat: "off", active: false };
        var handles = Object.create(null), rows = [], records = Object.create(null), urls = [], generation = 0, intent = 0, waiting = null, first = false;
        var scanning = false, failed = false, error = "", persistent = true, request = null, timer = null, disposed = false, database = null, seed = 1;
        var browserActive = 0, browserPump = null, cancelBrowser = null, wakePoll = null;
        var playbackActive = 0, playbackQueue = [], playbackCancels = [], notificationTimer = null, connection = null, importWrites = [];
        function validId(value) { return typeof value === "string" && value.length > 0 && value.length <= 8192 && value !== "__proto__" && value !== "constructor" && value !== "prototype"; }
        function endpoint(value) {
            var match = /^(https?:\/\/[^\s\/?#@]+)(\/offline-media\/[A-Za-z0-9_-]{32,256})\/?$/.exec(String(value || ""));
            if (!match || /[\\\x00-\x20\x7f]/.test(value)) throw new Error("INVALID_ENDPOINT");
            return match[1] + match[2];
        }
        try {
            var parsed = JSON.parse(storage && storage.getItem(key) || "null");
            if (parsed && parsed.version === 1 && Array.isArray(parsed.sources) && parsed.sources.length <= 100) {
                data.sources = parsed.sources.filter(function (source) {
                    if (!source || !validId(source.id) || typeof source.name !== "string" || source.name.length > 1024) return false;
                    if (source.kind === "browser") return true;
                    try { return source.kind === "helper" && validId(source.rootId) && endpoint(source.endpoint) === source.endpoint; } catch (ignore) { return false; }
                });
                data.selected = validId(parsed.selected) ? parsed.selected : "";
                data.current = validId(parsed.current) ? parsed.current : "";
                data.position = typeof parsed.position === "number" && isFinite(parsed.position) && parsed.position > 0 ? parsed.position : 0;
                Object.keys(parsed.bookmarks || {}).slice(-200).forEach(function (id) { var position = parsed.bookmarks[id]; if (validId(id) && typeof position === "number" && isFinite(position) && position > 0) data.bookmarks[id] = position; });
                data.shuffle = parsed.shuffle === true; data.repeat = ["off", "all", "one"].indexOf(parsed.repeat) >= 0 ? parsed.repeat : "off"; data.active = parsed.active === true;
            }
        } catch (ignore) { persistent = false; }
        function save() {
            try { if (!storage) throw new Error("NO_STORAGE"); var text = JSON.stringify(data); storage.setItem(key, text); if (storage.getItem(key) !== text) throw new Error("STORAGE_CHANGED"); }
            catch (ignore) { persistent = false; }
        }
        function snapshot() {
            return { sources: data.sources.map(function (source) { return { id: source.id, name: source.name, kind: source.kind }; }), selected: data.selected, current: data.current, position: data.position, shuffle: data.shuffle, repeat: data.repeat, active: data.active, scanning: scanning, error: error, persistent: persistent, folderPicker: typeof environment.showDirectoryPicker === "function", filePicker: typeof environment.showOpenFilePicker === "function" };
        }
        function notify() {
            if (notificationTimer !== null) environment.clearTimeout(notificationTimer); notificationTimer = null;
            if (!disposed && options.changed) options.changed(rows.slice(), snapshot());
        }
        function notifyLater(token) {
            if (notificationTimer !== null) return;
            var pending = environment.setTimeout(function () {
                if (notificationTimer !== pending) return;
                notificationTimer = null; if (alive(token)) notify();
            }, 100);
            notificationTimer = pending;
        }
        function alive(token) { return !disposed && generation === token; }
        function interrupt() { intent++; waiting = null; first = false; }
        function release() { urls.forEach(function (url) { environment.URL.revokeObjectURL(url); }); urls = []; }
        function cancelConnect() {
            var pending = connection; connection = null;
            if (pending && pending.abort) pending.abort();
        }
        function cancel() {
            generation++; interrupt(); scanning = false;
            cancelConnect();
            if (notificationTimer !== null) environment.clearTimeout(notificationTimer); notificationTimer = null;
            if (request) request(); request = null;
            if (timer !== null) environment.clearTimeout(timer); timer = null;
            if (wakePoll) wakePoll(); wakePoll = null;
            if (cancelBrowser) cancelBrowser();
            playbackCancels.slice().forEach(function (retire) { retire(); });
        }
        function find(id) { for (var i = 0; i < data.sources.length; i++) if (data.sources[i].id === id) return data.sources[i]; return null; }
        function openDB() {
            if (database) return database;
            database = new Promise(function (resolve, reject) {
                if (!environment.indexedDB) { reject(new Error("NO_HANDLE_STORAGE")); return; }
                var open = environment.indexedDB.open("ottplay2-local-handles", 1);
                open.onupgradeneeded = function () { open.result.createObjectStore("sources", { keyPath: "id" }); };
                open.onsuccess = function () { resolve(open.result); };
                open.onerror = function () { reject(new Error("HANDLE_STORAGE")); };
            }).then(function (db) { return db; }, function (failure) { database = null; throw failure; });
            return database;
        }
        function closeDatabase() {
            if (!disposed || importWrites.length || !database) return;
            var closing = database; database = null;
            closing.then(function (db) { db.close(); }, function () {});
        }
        function handleRecord(id, value, remove, owner) {
            return openDB().then(function (db) {
                if (owner && disposed) throw new Error("CANCELLED");
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction("sources", value || remove ? "readwrite" : "readonly"), store = tx.objectStore("sources");
                    if (owner) owner.transaction = tx;
                    var read = remove ? store.delete(id) : value ? store.put({ id: id, handles: value }) : store.get(id);
                    tx.oncomplete = function () { if (owner) owner.transaction = null; resolve(value || (read.result && read.result.handles)); };
                    tx.onabort = function () { if (owner) owner.transaction = null; reject(new Error("HANDLE_STORAGE")); };
                    // A write remains owned until commit or abort, not merely an error event.
                    tx.onerror = owner ? function () {} : tx.onabort;
                });
            });
        }
        function id() { return "local-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0x100000000).toString(36); }
        function register(picked, name) {
            if (!picked || !picked.length || disposed) return Promise.resolve(null);
            if (data.sources.length + importWrites.length >= 100) return Promise.reject(new Error("SOURCE_LIMIT"));
            var source = { id: id(), name: String(name || "Files").slice(0, 1024), kind: "browser" };
            var writing = { transaction: null }; importWrites.push(writing);
            function finished(value) {
                importWrites.splice(importWrites.indexOf(writing), 1);
                if (disposed) delete handles[source.id];
                closeDatabase(); return value;
            }
            handles[source.id] = picked;
            return handleRecord(source.id, picked, false, writing).then(function () {
                if (disposed) return handleRecord(source.id, null, true).then(function () { return null; }, function () { persistent = false; return null; });
                data.sources.push(source); save(); notify(); return source.id;
            }, function () {
                if (disposed) return null;
                persistent = false; data.sources.push(source); notify(); return source.id;
            }).then(finished, function (failure) { finished(null); throw failure; });
        }
        function importFolder() {
            if (!environment.showDirectoryPicker) return Promise.reject(new Error("NO_PICKER"));
            // Invoke in the user gesture, before storage or promise work.
            var picked; try { picked = environment.showDirectoryPicker({ mode: "read" }); } catch (failure) { return Promise.reject(failure); }
            return Promise.resolve(picked).then(function (handle) { return register([handle], handle.name); });
        }
        function importFiles() {
            if (!environment.showOpenFilePicker) return Promise.reject(new Error("NO_PICKER"));
            var picked; try { picked = environment.showOpenFilePicker({ multiple: true }); } catch (failure) { return Promise.reject(failure); }
            return Promise.resolve(picked).then(function (list) { return register(list, list.length === 1 ? list[0].name : "Files (" + list.length + ")"); });
        }
        function getJSON(url, token, registration) {
            return new Promise(function (resolve, reject) {
                var xhr = new environment.XMLHttpRequest(), settled = false;
                function done(failure, value) { if (settled) return; settled = true; if (registration) registration.abort = null; else if (request === abort) request = null; if (failure) reject(failure); else resolve(value); }
                function abort() { xhr.abort(); done(new Error("CANCELLED")); }
                if (registration) registration.abort = abort; else request = abort;
                xhr.open("GET", url, true); xhr.timeout = 60000;
                xhr.onload = function () {
                    if (registration ? disposed || connection !== registration : !alive(token)) { done(new Error("CANCELLED")); return; }
                    if (xhr.status < 200 || xhr.status >= 300) { var failure = new Error("HELPER_REQUEST"); failure.status = xhr.status; done(failure); return; }
                    if (xhr.responseText.length > 32 * 1024 * 1024) { done(new Error("CATALOG_TOO_LARGE")); return; }
                    try { done(null, JSON.parse(xhr.responseText)); } catch (ignore) { done(new Error("INVALID_CATALOG")); }
                };
                xhr.onerror = xhr.ontimeout = function () { done(new Error("HELPER_UNAVAILABLE")); };
                xhr.send();
            });
        }
        function connect(value) {
            cancelConnect();
            var base; try { base = endpoint(value); } catch (failure) { return Promise.reject(failure); }
            if (disposed) return Promise.reject(new Error("CANCELLED"));
            var registration = {}; connection = registration;
            return getJSON(base + "/sources", generation, registration).catch(function (failure) {
                if (disposed || connection !== registration) throw new Error("CANCELLED");
                if (failure.status === 404 || failure.status === 501) return getJSON(base, generation, registration);
                throw failure;
            }).then(function (catalog) {
                if (disposed || connection !== registration) return;
                if (!catalog || !Array.isArray(catalog.sources)) throw new Error("INVALID_SOURCES");
                var added = 0;
                catalog.sources.forEach(function (row) {
                    if (!row || !validId(row.id) || typeof row.name !== "string" || data.sources.length >= 100) return;
                    var existing = data.sources.some(function (source) { return source.kind === "helper" && source.endpoint === base && source.rootId === row.id; });
                    if (!existing) { data.sources.push({ id: id(), kind: "helper", name: row.name.slice(0, 1024), endpoint: base, rootId: row.id }); added++; }
                });
                save(); notify(); return added;
            }).then(function (added) {
                if (connection === registration) connection = null; return added;
            }, function (failure) {
                if (connection === registration) connection = null; throw failure;
            });
        }
        function random() { seed = (Math.imul ? Math.imul(seed, 1664525) : seed * 1664525) + 1013904223 >>> 0; return seed / 0x100000000; }
        function choose(itemId, resume) {
            var record = records[itemId]; if (!record || disposed) return false;
            interrupt(); data.position = resume ? data.bookmarks[itemId] || (data.current === itemId ? data.position : 0) : 0; data.current = itemId; save();
            if (options.start) options.start(record.row, !!resume); return true;
        }
        function advance() {
            var at = -1; for (var i = 0; i < rows.length; i++) if (rows[i].id === data.current) at = i;
            if (at < 0) return;
            if (data.repeat === "one") { choose(data.current, false); return; }
            if (at + 1 < rows.length) { choose(rows[at + 1].id, false); return; }
            if (scanning) { waiting = { generation: generation, intent: intent, id: data.current }; if (wakePoll) wakePoll(); return; }
            // Completed scans may carry permission warnings for skipped files.
            if (!failed && data.repeat === "all" && rows.length) choose(rows[0].id, false);
        }
        function wake() { if (waiting && waiting.generation === generation && waiting.intent === intent && waiting.id === data.current) { waiting = null; advance(); } }
        function publish(record, token, preferred) {
            if (!alive(token) || records[record.row.id]) return;
            records[record.row.id] = record;
            var at = rows.length;
            if (data.shuffle && rows.length) {
                var currentIndex = -1; for (var i = 0; i < rows.length; i++) if (rows[i].id === data.current) currentIndex = i;
                at = currentIndex + 1 + Math.floor(random() * (rows.length - currentIndex));
            }
            rows.splice(at, 0, record.row);
            if (first && preferred === record.row.id) { rows.splice(rows.indexOf(record.row), 1); rows.unshift(record.row); }
            // Publish the first playable item immediately; amortize large tails.
            if (rows.length === 1 || rows.length % 32 === 0 || waiting || first && preferred === record.row.id) notify();
            else notifyLater(token);
            if (first && (!preferred || record.row.id === preferred)) { first = false; choose(record.row.id, !!preferred); }
            wake();
        }
        function finish(token, failure, warning, fallback) {
            if (!alive(token)) return;
            scanning = false; failed = !!failure; error = !failure ? warning || "" : failure.message === "SCAN_ENTRY_LIMIT" ? "Local scan exceeds 100000 entries" : failure.message === "SCAN_TIMEOUT" ? "Local scan timed out waiting for storage" : "Local source unavailable";
            if ((!failure || fallback) && first && rows.length) { first = false; choose(rows[0].id, false); }
            notify(); wake();
        }
        function playable(file) { return !!file && (typeof file.type === "string" && /^(video|audio)\//.test(file.type) || /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|ts|mts|m2ts|mp3|m4a|aac|flac|ogg|oga|wav|opus)$/i.test(file.name || "")); }
        function pumpPlayback() {
            while (playbackActive < 2 && playbackQueue.length) {
                var job = playbackQueue.shift();
                if (!job.active || !alive(job.token)) { job.retire(); continue; }
                playbackActive++;
                (function (owned) {
                    Promise.resolve().then(function () { return owned.active && alive(owned.token) ? owned.record.handle.getFile() : null; }).then(function (file) {
                        playbackActive--; try { owned.complete(null, file); } finally { pumpPlayback(); }
                    }, function () { playbackActive--; try { owned.complete(new Error("FILE_UNAVAILABLE")); } finally { pumpPlayback(); } });
                })(job);
            }
        }
        function reopen(record, token, callback) {
            var job = { active: true, record: record, token: token, retire: retire, complete: complete }, deadline;
            function retire() {
                if (!job.active) return; job.active = false;
                environment.clearTimeout(deadline);
                playbackQueue = playbackQueue.filter(function (queued) { return queued !== job; });
                var index = playbackCancels.indexOf(retire); if (index >= 0) playbackCancels.splice(index, 1);
            }
            function complete(failure, file) {
                var accepted = job.active && alive(token); retire();
                if (accepted) callback(failure, file);
            }
            deadline = environment.setTimeout(function () { complete(new Error("FILE_TIMEOUT")); }, 60000);
            playbackCancels.push(retire); playbackQueue.push(job); pumpPlayback();
            // Retiring a started read does not release its native admission.
            return function () { retire(); pumpPlayback(); };
        }
        function browserScan(source, token, preferred, allowPrompt) {
            var savedPath = preferred && preferred.indexOf(encodeURIComponent(source.id) + ":") === 0 ? preferred.slice(encodeURIComponent(source.id).length + 1) : "";
            try { savedPath = decodeURIComponent(savedPath); } catch (ignore) { savedPath = ""; }
            return new Promise(function (resolve, reject) {
                var queue = [], iterators = [], readers = Object.create(null), grants = {}, pending = 0, entries = 0, stopped = false, ready = false;
                var deadline = null, scheduled = null, turns = 0, permissionNames = [], permissionCount = 0;
                function current() { return !stopped && alive(token); }
                function denied(failure, name) {
                    if (!failure || failure.message !== "PERMISSION_REQUIRED" && failure.name !== "NotAllowedError" && failure.name !== "SecurityError") return false;
                    if (current()) { permissionCount++; if (permissionNames.length < 8) permissionNames.push(String(name || "File").slice(0, 160)); }
                    return true;
                }
                function closeIterator(iterator) {
                    if (iterator.closed) return; iterator.closed = true;
                    if (typeof iterator.value.return === "function") {
                        try { Promise.resolve(iterator.value.return()).catch(function () {}); } catch (ignore) {}
                    }
                }
                function stop(failure) {
                    if (stopped) return; stopped = true; queue = [];
                    environment.clearTimeout(deadline); environment.clearTimeout(scheduled);
                    iterators.forEach(closeIterator); iterators = [];
                    if (browserPump === pump) browserPump = null;
                    if (cancelBrowser === cancelThis) cancelBrowser = null;
                    if (failure) reject(failure);
                    else resolve(permissionCount ? "Permission required: " + permissionNames.join(", ") + (permissionCount > permissionNames.length ? " (+" + (permissionCount - permissionNames.length) + " more)" : "") : "");
                }
                function cancelThis() { stop(new Error("CANCELLED")); }
                function progress() {
                    if (!current()) return;
                    environment.clearTimeout(deadline);
                    deadline = environment.setTimeout(function () { stop(new Error("SCAN_TIMEOUT")); }, 60000);
                }
                function enqueue(work, file) { if (current()) { if (file) queue.unshift(work); else queue.push(work); } }
                function admitted(work) {
                    browserActive++; pending++;
                    Promise.resolve().then(function () { return current() ? work() : null; }).then(function () { settled(); }, function (failure) { settled(failure); });
                }
                function settled(failure) {
                    // Native reads cannot be aborted. Keep their shared slots
                    // occupied after retirement until the actual promise settles.
                    browserActive--; pending--;
                    if (current()) { if (failure) stop(failure); else progress(); }
                    if (browserPump) browserPump();
                }
                function pump() {
                    if (!current() || !ready || scheduled !== null) return;
                    while (browserActive < 4 && queue.length) {
                        admitted(queue.shift()); turns++;
                        if (turns % 32 === 0) {
                            scheduled = environment.setTimeout(function () { scheduled = null; pump(); }, 0);
                            break;
                        }
                    }
                    if (!queue.length && pending === 0) stop();
                }
                function access(handle) {
                    if (!current() || !handle.queryPermission) return Promise.resolve();
                    return Promise.resolve(handle.queryPermission({ mode: "read" })).then(function (permission) {
                        if (!current() || permission === "granted") return;
                        if (!allowPrompt || !handle.requestPermission) throw new Error("PERMISSION_REQUIRED");
                        return handle.requestPermission({ mode: "read" }).then(function (result) { if (result !== "granted") throw new Error("PERMISSION_REQUIRED"); });
                    });
                }
                function read(handle, path) {
                    if (!current()) return Promise.resolve();
                    var itemId = encodeURIComponent(source.id) + ":" + encodeURIComponent(path);
                    if (records[itemId]) return Promise.resolve();
                    if (readers[itemId]) return readers[itemId];
                    readers[itemId] = Promise.resolve().then(function () { return current() ? handle.getFile() : null; }).then(function (file) {
                        if (!current() || !playable(file)) return;
                        publish({ handle: handle, file: file, row: { id: itemId, sourceId: source.id, name: file.name || handle.name, group: source.name, kind: "vod", local: true, format: "file", mime: file.type || "" } }, token, preferred);
                    }, function (failure) { denied(failure, path); });
                    return readers[itemId];
                }
                function visit(handle, path, depth) {
                    if (!current()) return;
                    if (handle.kind === "file") return read(handle, path);
                    if (depth > 64) throw new Error("FOLDER_DEPTH");
                    var iterator = { value: handle.values(), closed: false }; iterators.push(iterator);
                    function next() {
                        if (!current()) return;
                        return Promise.resolve(iterator.value.next()).then(function (entry) {
                            if (!current()) return;
                            if (entry.done) { closeIterator(iterator); return; }
                            entries++; if (entries > 100000) throw new Error("SCAN_ENTRY_LIMIT");
                            var child = entry.value, childPath = path ? path + "/" + child.name : child.name;
                            // A child original/directory never owns the parent
                            // cursor. Both tasks compete in the bounded window.
                            enqueue(function () { return visit(child, childPath, depth + 1); }, child.kind === "file");
                            enqueue(next);
                        });
                    }
                    enqueue(next);
                }
                browserPump = pump; cancelBrowser = cancelThis; progress();
                Promise.resolve(handles[source.id] || handleRecord(source.id)).then(function (list) {
                    if (!current()) return;
                    if (!list || !list.length) throw new Error("PICK_SOURCE_AGAIN");
                    if (list.length > 100000) throw new Error("SCAN_ENTRY_LIMIT");
                    handles[source.id] = list;
                    function grant(index) {
                        if (!grants[index]) grants[index] = Promise.resolve().then(function () { return current() ? access(list[index]) : null; }).then(function () { return current(); }, function (failure) {
                            if (!denied(failure, (list.length > 1 ? (index + 1) + ". " : "") + list[index].name)) throw failure;
                            return false;
                        });
                        return grants[index];
                    }
                    if (savedPath) enqueue(function () {
                        var priority;
                        if (list.length > 1 || list[0].kind === "file") {
                            var index = list.length > 1 ? Number(savedPath.split("/")[0]) : 0;
                            var path = Math.floor(index) === index && index >= 0 && index < list.length ? (list.length > 1 ? index + "/" : "") + list[index].name : "";
                            priority = path === savedPath && list[index].kind === "file" ? grant(index).then(function (allowed) { if (allowed) return read(list[index], path); }) : Promise.resolve();
                        } else {
                            var segments = savedPath.split("/"), leaf = segments.pop();
                            priority = grant(0).then(function (allowed) { if (!allowed) throw new Error("PERMISSION_REQUIRED"); return list[0]; });
                            if (!leaf || leaf === "." || leaf === ".." || segments.some(function (name) { return !name || name === "." || name === ".."; })) priority = Promise.reject(new Error("INVALID_PATH"));
                            else {
                                segments.forEach(function (name) { priority = priority.then(function (handle) { if (!current()) throw new Error("CANCELLED"); return handle.getDirectoryHandle(name); }); });
                                priority = priority.then(function (handle) { if (!current()) return; return handle.getFileHandle(leaf); }).then(function (handle) { if (handle) return read(handle, savedPath); });
                            }
                        }
                        return priority.catch(function () {}).then(function () {
                            if (!current()) return;
                            if (first && preferred && !records[preferred]) { preferred = ""; if (rows.length) choose(rows[0].id, false); }
                        });
                    });
                    else preferred = "";
                    list.forEach(function (handle, index) {
                        enqueue(function () { return grant(index).then(function (allowed) { if (allowed) return visit(handle, handle.kind === "directory" && list.length === 1 ? "" : (list.length > 1 ? index + "/" : "") + handle.name, 0); }); });
                    });
                    ready = true; pump();
                }).catch(stop);
            });
        }
        function helperScan(source, token, preferred, refresh) {
            var scanGeneration = null, signature = "", changed = Date.now(), root = source.endpoint, origin = /^(https?:\/\/[^/]+)/.exec(root)[1];
            var url = root + "?sourceId=" + encodeURIComponent(source.rootId), preferredId = "";
            if (preferred && preferred.indexOf(encodeURIComponent(source.id) + ":") === 0) { preferredId = preferred.slice(encodeURIComponent(source.id).length + 1); url += "&preferredId=" + encodeURIComponent(preferredId); }
            function poll() {
                if (!alive(token)) return Promise.resolve();
                var requestUrl = url + (refresh ? "&refresh=true" : ""); refresh = false;
                return getJSON(requestUrl, token).then(function (catalog) {
                    if (!alive(token)) return;
                    if (!catalog || !Array.isArray(catalog.items)) throw new Error("INVALID_CATALOG");
                    var scans = catalog.sourceScans, scan = null, matches = 0;
                    if (Array.isArray(scans)) scans.forEach(function (record) { if (record && record.sourceId === source.rootId) { scan = record; matches++; } });
                    var scanStatus = core.localSourceScanStatus(scans !== undefined, Array.isArray(scans), matches, scan && scan.generation, scan && scan.state);
                    if (scanStatus === "invalid") throw new Error("INVALID_GENERATION");
                    // An advertised source protocol cannot authorize legacy
                    // completion before the selected source has a scan record.
                    if (scanStatus === "pending" && !scan) scan = { generation: 0, state: "pending" };
                    if (scan && scan.generation) { if (scanGeneration !== null && scanGeneration !== scan.generation) throw new Error("SOURCE_CHANGED"); scanGeneration = scan.generation; }
                    var complete = scan ? scan.state === "complete" : !catalog.scanning;
                    var sourceRow = (catalog.sources || []).filter(function (row) { return row.id === source.rootId; })[0];
                    if (!sourceRow || sourceRow.available === false) throw new Error("SOURCE_UNAVAILABLE");
                    if (preferred && catalog.preferred && catalog.preferred.id === preferredId && catalog.preferred.state === "missing" && (scan && scan.state !== "pending" || complete)) {
                        preferred = "";
                        if (first && rows.length) choose(rows[0].id, false);
                    }
                    if (scan && scan.state !== "pending" || complete) catalog.items.forEach(function (item) {
                        if (!item || item.sourceId !== source.rootId || item.available === false || !validId(item.id) || typeof item.url !== "string") return;
                        var mediaUrl = item.url.charAt(0) === "/" ? origin + item.url : item.url;
                        if (mediaUrl !== root + "/" + item.id || !/^[A-Za-z0-9_-]+$/.test(item.id)) return;
                        publish({ url: mediaUrl, row: { id: encodeURIComponent(source.id) + ":" + item.id, sourceId: source.id, name: String(item.name || item.id), group: source.name, kind: "vod", local: true, format: "file", mime: item.mime || "" } }, token, preferred);
                    });
                    if (notificationTimer !== null) notify();
                    if (scan && scan.state === "error") throw new Error("SOURCE_UNAVAILABLE");
                    var next = JSON.stringify([scan, catalog.scanned, rows.length]);
                    if (next !== signature) { signature = next; changed = Date.now(); }
                    if (complete) return;
                    if (Date.now() - changed > 60000) throw new Error("SCAN_TIMEOUT");
                    return new Promise(function (resolve) {
                        var settled = false;
                        function wake() {
                            if (settled) return; settled = true;
                            if (timer !== null) environment.clearTimeout(timer); timer = null;
                            if (wakePoll === wake) wakePoll = null;
                            resolve();
                        }
                        wakePoll = wake;
                        timer = environment.setTimeout(wake, first || waiting ? 1000 : 10000);
                    }).then(poll);
                });
            }
            return poll();
        }
        function select(sourceId, shuffle, resume, allowPrompt, refresh) {
            var source = find(sourceId); if (!source || disposed) return false;
            cancel(); release(); rows = []; records = Object.create(null); scanning = true; failed = false; error = "";
            var preferred = resume && data.selected === sourceId ? data.current : "";
            data.selected = sourceId; data.active = true; data.shuffle = !!shuffle;
            if (!preferred) { data.current = ""; data.position = 0; }
            seed = Math.floor(Math.random() * 0x100000000) >>> 0; first = true; save(); notify(); var token = generation;
            var pending = source.kind === "helper" ? helperScan(source, token, preferred, !!refresh) : browserScan(source, token, preferred, allowPrompt);
            pending.then(function (warning) { finish(token, null, warning); }, function (failure) { finish(token, failure, "", source.kind === "browser" && failure.message === "SCAN_TIMEOUT"); });
            return true;
        }
        function resolve(row, callback) {
            var record = records[row.id], token = generation, active = true, cancelRead = null;
            if (!record || row.sourceId !== data.selected) { callback(new Error("SOURCE_CHANGED")); return function () {}; }
            if (record.url) { callback(null, { url: record.url }); return function () {}; }
            function opened(failure, file) {
                if (!active || !alive(token)) return;
                if (failure || !file) { callback(failure || new Error("FILE_UNAVAILABLE")); return; }
                var url;
                try { release(); url = environment.URL.createObjectURL(file); } catch (ignore) { callback(new Error("FILE_UNAVAILABLE")); return; }
                record.file = null; urls.push(url); callback(null, { url: url });
            }
            if (record.file) Promise.resolve(record.file).then(function (file) { opened(null, file); });
            else cancelRead = reopen(record, token, opened);
            return function () { active = false; if (cancelRead) cancelRead(); };
        }
        return {
            snapshot: snapshot, importFolder: importFolder, importFiles: importFiles, connect: connect, cancelConnect: cancelConnect, select: select, choose: choose, resolve: resolve,
            checkpoint: function (itemId, position) { if (itemId === data.current) { data.position = Math.max(0, Number(position) || 0); if (data.position > 0) data.bookmarks[itemId] = data.position; else delete data.bookmarks[itemId]; var keys = Object.keys(data.bookmarks); while (keys.length > 200) delete data.bookmarks[keys.shift()]; save(); } },
            ended: function (itemId) { if (itemId !== data.current || waiting) return; data.position = 0; delete data.bookmarks[itemId]; save(); advance(); },
            next: function () { interrupt(); advance(); },
            previous: function () {
                interrupt();
                for (var i = 0; i < rows.length; i++) if (rows[i].id === data.current) {
                    if (i > 0) choose(rows[i - 1].id, false);
                    else if (!scanning && !failed && data.repeat === "all") choose(rows[rows.length - 1].id, false);
                    return;
                }
            },
            interrupt: interrupt,
            repeat: function () { data.repeat = ["off", "all", "one"][( ["off", "all", "one"].indexOf(data.repeat) + 1) % 3]; save(); notify(); },
            leave: function () { cancel(); data.active = false; save(); release(); },
            remove: function (sourceId) { if (data.selected === sourceId) { cancel(); release(); rows = []; records = Object.create(null); data.selected = ""; data.current = ""; data.position = 0; } data.sources = data.sources.filter(function (source) { return source.id !== sourceId; }); delete handles[sourceId]; handleRecord(sourceId, null, true).catch(function () {}); save(); notify(); },
            destroy: function () {
                cancel(); disposed = true; release();
                importWrites.forEach(function (writing) { if (writing.transaction) try { writing.transaction.abort(); } catch (ignore) {} });
                closeDatabase();
            }
        };
    }
    return { create: create, key: key };
});
