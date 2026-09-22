/* New ES5 media lifecycle. Optional adapters are independently supplied libraries. */
(function (root) {
    "use strict";
    root.OTT2.define("media", function () {
        function create(config) {
            var video = config.video;
            var environment = config.environment || root;
            // The loader accepts each optional dependency once. A timed-out script
            // cannot change engines later by publishing a global constructor.
            var libraries = environment.OTT2Vendors || environment;
            var options = config.options || {};
            var notify = typeof config.onEvent === "function" ? config.onEvent : function () {};
            var state = "idle";
            var channel = null;
            var backend = "native";
            var enginePreference = validEngine(options.engine) ? options.engine : "auto";
            var formatPreference = "auto";
            var streamFormat = "";
            var detecting = false;
            var detectReason = "none";
            var lastError = null;
            var cancelProbe = null;
            var cancelVendor = null;
            var videoTimer = null;
            var cancelVideoProbe = null;
            var videoProbeTried = false;
            var videoExpected = false;
            var lastProgress = 0;
            var initialVideoFrames = null;
            var verifiedVideoFrames = false;
            var liveResume = null;
            var mediaRecoveryUsed = false;
            var enginePlan = [];
            var engineIndex = 0;
            var fallbackCount = 0;
            var resumePosition = null;
            var nativeSource = null;
            var generation = 0;
            var playAttempt = 0;
            var destroyed = false;
            var paused = false;
            var suspended = false;
            var retryCount = 0;
            var retryTimer = null;
            var stallTimer = null;
            var listeners = [];
            var trackListeners = [];
            var adapter = null;
            var disposal = null;
            var adapterReady = true;
            var needsReload = false;
            var aspect = "fit";
            var zoom = 1;
            var pip = false;
            var pipAttempt = 0;
            var pipIntent = false;
            var subtitleDisabled = false;
            var hlsWorkerFailed = false;
            var document = video && video.ownerDocument || environment.document || {};
            var originalStyle = video && video.style ? video.style.cssText : "";
            var stallTimeout = positive(options.stallTimeout, 15000);
            var retryDelay = positive(options.retryDelay, 1000);
            var maxRetries = typeof options.maxRetries === "number" && isFinite(options.maxRetries) ? Math.max(0, Math.min(3, Math.floor(options.maxRetries))) : 3;

            if (!video || typeof video.addEventListener !== "function") {
                throw new Error("An HTML5 video element is required");
            }

            function positive(value, fallback) {
                return typeof value === "number" && isFinite(value) && value > 0 ? value : fallback;
            }

            function number(value) {
                return typeof value === "number" && isFinite(value) ? value : 0;
            }

            function snapshot() {
                return {
                    state: state,
                    session: generation,
                    channel: channel,
                    position: needsReload && resumePosition !== null ? resumePosition : number(video.currentTime),
                    duration: number(video.duration),
                    paused: paused,
                    suspended: suspended,
                    retries: retryCount,
                    backend: backend,
                    engine: enginePreference,
                    format: streamFormat || "unknown",
                    formatPreference: formatPreference,
                    detecting: detecting,
                    detectReason: detectReason,
                    lastError: lastError ? { code: lastError.code, message: lastError.message } : null,
                    fallbackCount: fallbackCount,
                    ready: adapterReady && !needsReload && !suspended && !!channel && state !== "error" && state !== "stopped",
                    seekRange: seekRange(),
                    volume: number(video.volume),
                    muted: !!video.muted,
                    aspect: aspect,
                    zoom: zoom,
                    pip: pip,
                    tracks: listTracks()
                };
            }

            function emit(type, error) {
                var event = snapshot();
                event.type = type;
                if (error) { event.error = error; }
                notify(event);
            }

            function setState(value, type, error) {
                state = value;
                emit(type || value, error);
            }

            function clearTimer(which) {
                if (which === "retry" && retryTimer !== null) {
                    environment.clearTimeout(retryTimer);
                    retryTimer = null;
                }
                if (which === "stall" && stallTimer !== null) {
                    environment.clearTimeout(stallTimer);
                    stallTimer = null;
                }
            }

            function clearVideoCheck() {
                if (videoTimer !== null) { environment.clearTimeout(videoTimer); videoTimer = null; }
                if (cancelVideoProbe) { cancelVideoProbe(); cancelVideoProbe = null; }
            }

            function current(token) {
                return !destroyed && token === generation;
            }

            function listen(name, callback, token) {
                var handler = function (event) {
                    if (current(token)) { callback(event); }
                };
                video.addEventListener(name, handler, false);
                listeners.push({ name: name, handler: handler });
            }

            function swallow(result) {
                if (result && typeof result.then === "function") {
                    result.then(function () {}, function () {});
                }
            }

            function cleanup() {
                var i;
                generation += 1;
                if (cancelProbe) { cancelProbe(); cancelProbe = null; }
                if (cancelVendor) { cancelVendor(); cancelVendor = null; }
                clearVideoCheck();
                detecting = false;
                playAttempt += 1;
                pipAttempt += 1;
                pipIntent = false;
                closePip();
                clearTimer("retry");
                clearTimer("stall");
                for (i = 0; i < listeners.length; i += 1) {
                    video.removeEventListener(listeners[i].name, listeners[i].handler, false);
                }
                listeners = [];
                for (i = 0; i < trackListeners.length; i += 1) {
                    trackListeners[i].target.removeEventListener(trackListeners[i].name, trackListeners[i].handler, false);
                }
                trackListeners = [];
                if (adapter) {
                    try { disposal = adapter.destroy(); swallow(disposal); } catch (ignore) { disposal = null; }
                    adapter = null;
                }
                adapterReady = true;
                try { video.pause(); } catch (ignorePause) {}
                try {
                    video.removeAttribute("src");
                    if (nativeSource && nativeSource.parentNode === video) { video.removeChild(nativeSource); }
                    nativeSource = null;
                    video.load();
                } catch (ignoreReset) {}
                return disposal;
            }

            function failure(code, message) {
                preservePosition();
                lastError = { code: code, message: "Playback failed. Check stream access, format and device codecs." };
                cleanup();
                needsReload = true;
                setState("error", "error", { code: code, message: message });
            }

            function retry(code, message, token) {
                if (!current(token) || paused || retryTimer !== null || state === "error") { return; }
                clearTimer("stall");
                if (!channel || channel.kind !== "live" || retryCount >= maxRetries) {
                    failure(code, message);
                    return;
                }
                retryCount += 1;
                needsReload = true;
                setState("retrying", "retry", { code: code, message: message });
                retryTimer = environment.setTimeout(function () {
                    if (!current(token)) { return; }
                    retryTimer = null;
                    if (!paused) { preservePosition(); start(channel); }
                }, retryDelay * retryCount);
            }

            function watch(token) {
                if (paused || !current(token) || stallTimer !== null || retryTimer !== null) { return; }
                var watchedPosition = number(video.currentTime);
                stallTimer = environment.setTimeout(function () {
                    if (!current(token)) { return; }
                    stallTimer = null;
                    var position = number(video.currentTime);
                    if (!paused && video.paused !== true && Math.abs(position - watchedPosition) > 0.01) {
                        lastProgress = position; watch(token); return;
                    }
                    if (!fallback("playback_timeout", token)) { retry("network_stall", "The stream stopped responding", token); }
                }, stallTimeout);
            }

            function videoFrames() {
                try {
                    var quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
                    if (quality && typeof quality.totalVideoFrames === "number" && isFinite(quality.totalVideoFrames) && quality.totalVideoFrames >= 0) {
                        return Math.max(0, quality.totalVideoFrames - number(quality.droppedVideoFrames));
                    }
                    if (typeof video.webkitDecodedFrameCount === "number" && isFinite(video.webkitDecodedFrameCount) && video.webkitDecodedFrameCount >= 0) { return video.webkitDecodedFrameCount; }
                } catch (ignore) {}
                return null;
            }

            function videoPresent() {
                var frames = videoFrames();
                if (frames !== null) {
                    // Compare with this start's counter: an old channel's frames
                    // cannot validate its replacement. Some engines reset counters.
                    if (frames > 0 && (initialVideoFrames === null || frames !== initialVideoFrames)) { verifiedVideoFrames = true; }
                    return verifiedVideoFrames;
                }
                try {
                    // Old firmware has no decoded-frame counter. Dimensions or a
                    // populated TrackList are positive hints; either may lag. This
                    // fallback cannot prove decoding when an engine lies about both.
                    return video.videoWidth > 0 && video.videoHeight > 0 || !!video.videoTracks && video.videoTracks.length > 0;
                } catch (ignore) { return false; }
            }

            function verifyVideo(token) {
                if (!current(token) || paused || !videoExpected || videoTimer !== null || videoPresent()) { return; }
                videoTimer = environment.setTimeout(function () {
                    if (!current(token) || paused) { return; }
                    videoTimer = null;
                    if (videoPresent()) { return; }
                    if (!fallback("video_missing", token)) { failure("video_missing", "The stream has video but this engine did not open its video track"); }
                }, positive(options.videoTimeout, stallTimeout));
            }

            function knownRadio() {
                return !!channel && (channel.radio === true || channel.kind === "radio" || /^audio\//i.test(channel.mime || ""));
            }

            function noteVideoEvidence(value, token) {
                if (!current(token) || knownRadio()) { return; }
                if (value) { videoExpected = true; verifyVideo(token); }
            }

            function inspectNativeTracks(token) {
                if (!current(token) || paused || enginePreference !== "auto" || engineIndex + 1 >= enginePlan.length || backend !== "native" || streamFormat !== "hls" || knownRadio() || videoExpected || videoPresent() || videoProbeTried) { return; }
                // A missing native video track alone also describes radio. Only
                // explicit video codecs in a bounded master response justify fallback.
                if (!video.audioTracks || !video.audioTracks.length || !video.videoTracks || video.videoTracks.length || typeof environment.XMLHttpRequest !== "function") { return; }
                videoProbeTried = true;
                var xhr;
                var timer;
                var ended = false;
                function finish(renew) {
                    if (ended) { return; }
                    ended = true;
                    environment.clearTimeout(timer);
                    if (xhr) { xhr.onreadystatechange = null; xhr.onprogress = null; xhr.onerror = null; try { xhr.abort(); } catch (ignore) {} }
                    // Some single-session relays replace their native request when
                    // the master is inspected. Renew once; never renew a stale channel.
                    if (current(token) && backend === "native") {
                        if (renew && !paused) {
                            preservePosition();
                            setState("loading", "nativeprobe");
                            try {
                                if (nativeSource) { nativeSource.setAttribute("src", channel.url); }
                                else { video.src = channel.url; }
                                video.load(); requestPlay(token);
                            } catch (ignoreRenew) { needsReload = true; }
                        } else if (paused) { preservePosition(); needsReload = true; }
                    }
                }
                cancelVideoProbe = function () { finish(false); };
                function inspect() {
                    if (!current(token) || paused) { finish(); return; }
                    var body = "";
                    try { body = xhr.responseText || ""; } catch (ignore) {}
                    if (xhr.status >= 200 && xhr.status < 300 && /^\s*#EXTM3U/i.test(body.replace(/^\ufeff/, "")) && /CODECS\s*=\s*["'][^"']*(?:avc[13]|hev1|hvc1|vp0?9|av01|mp4v)(?:[.,"'])/i.test(body.slice(0, 65536))) {
                        noteVideoEvidence(true, token); finish(true);
                    } else if (body.length >= 65536 || xhr.readyState === 4) { finish(true); }
                }
                try {
                    xhr = new environment.XMLHttpRequest();
                    xhr.open("GET", typeof config.probeUrl === "function" ? config.probeUrl(channel.url) : channel.url, true);
                    xhr.onreadystatechange = inspect; xhr.onprogress = inspect; xhr.onerror = function () { finish(true); };
                    timer = environment.setTimeout(function () { finish(true); }, 4000);
                    xhr.send(null);
                } catch (ignore) { finish(); }
            }

            function canLoadVendor(name) {
                try { return !!environment.OTT2VendorLoader && environment.OTT2VendorLoader.canLoad(name); }
                catch (ignore) { return false; }
            }

            function supports(mime) {
                try {
                    return !!video.canPlayType && !!video.canPlayType(mime).replace(/no/g, "");
                } catch (ignore) { return false; }
            }

            function hlsSupported() {
                try {
                    return typeof environment.Promise === "function" && !!libraries.Hls &&
                        typeof libraries.Hls.isSupported === "function" && libraries.Hls.isSupported();
                } catch (ignore) { return false; }
            }

            function shakaSupported() {
                try {
                    return typeof environment.Promise === "function" && !!libraries.shaka &&
                        !!libraries.shaka.Player && typeof libraries.shaka.Player.isBrowserSupported === "function" &&
                        libraries.shaka.Player.isBrowserSupported();
                } catch (ignore) { return false; }
            }

            function validEngine(value) {
                return ["auto", "native", "hls.js", "shaka", "mpegts"].indexOf(value) >= 0;
            }

            function validFormat(value) {
                return ["auto", "hls", "dash", "mpegts", "flv", "file"].indexOf(value) >= 0;
            }

            function mpegtsSupported() {
                try {
                    var library = libraries.mpegts;
                    var features;
                    if (typeof environment.Promise !== "function" || !library || typeof library.isSupported !== "function" || !library.isSupported()) { return false; }
                    if (typeof library.getFeatureList === "function") {
                        features = library.getFeatureList();
                        return channel && channel.kind !== "live" ? !!features.msePlayback : !!features.mseLivePlayback;
                    }
                    return false;
                } catch (ignore) { return false; }
            }

            function lgDevice() {
                var ua = environment.navigator && environment.navigator.userAgent || "";
                return /web[o0]s|netcast|lg[ _-]?browser/i.test(ua) || /^(?:lg(?:\/|$)|webos$)/i.test(options.device || "");
            }

            function chromiumDevice() {
                return /Chrome|Chromium|Edg\//i.test(environment.navigator && environment.navigator.userAgent || "") && !lgDevice();
            }

            function capabilities() {
                var tracks = listTracks();
                return {
                    html5: true,
                    nativeHls: supports("application/vnd.apple.mpegurl") || supports("application/x-mpegURL"),
                    hlsJs: hlsSupported() || canLoadVendor("Hls"),
                    nativeDash: supports("application/dash+xml"),
                    shaka: shakaSupported() || canLoadVendor("shaka"),
                    mpegts: mpegtsSupported() || canLoadVendor("mpegts"),
                    engines: [
                        { id: "auto", label: "Auto", available: true },
                        { id: "native", label: lgDevice() ? "LG native" : "Native HTML5", available: true },
                        { id: "hls.js", label: "Hls.js", available: hlsSupported() || canLoadVendor("Hls") },
                        { id: "shaka", label: "Shaka", available: shakaSupported() || canLoadVendor("shaka") },
                        { id: "mpegts", label: "MPEG-TS", available: mpegtsSupported() || canLoadVendor("mpegts") }
                    ],
                    nativeDeviceBridges: false,
                    audioTracks: tracks.audio.length > 0,
                    subtitleTracks: tracks.subtitles.length > 0,
                    seek: !!seekRange(),
                    aspect: !!video.style,
                    zoom: !!video.style,
                    pip: pipSupported()
                };
            }

            function seekRange() {
                var range = video.seekable;
                var ranges = [];
                var i;
                var start;
                var end;
                var duration;
                if (destroyed || !channel || suspended || state === "stopped" || state === "error") { return null; }
                try {
                    if (backend === "shaka" && adapter && adapterReady && typeof adapter.seekRange === "function") {
                        range = adapter.seekRange();
                        if (range && isFinite(range.start) && isFinite(range.end) && range.end > range.start) {
                            return { start: Math.max(0, range.start), end: range.end, live: !!channel && channel.kind === "live", ranges: [{ start: Math.max(0, range.start), end: range.end }] };
                        }
                        range = video.seekable;
                    }
                    for (i = 0; range && i < range.length; i += 1) {
                        start = range.start(i); end = range.end(i);
                        if (isFinite(start) && isFinite(end) && end > start) { ranges.push({ start: Math.max(0, start), end: end }); }
                    }
                } catch (ignore) {}
                if (ranges.length) {
                    return { start: ranges[0].start, end: ranges[ranges.length - 1].end, live: !!channel && channel.kind === "live", ranges: ranges };
                }
                duration = number(video.duration);
                if (channel && channel.kind !== "live" && duration > 0) {
                    return { start: 0, end: duration, live: false, ranges: [{ start: 0, end: duration }] };
                }
                return null;
            }

            function trackList(kind) {
                if (backend !== "native" && (!adapter || !adapterReady)) { return []; }
                try {
                    if (backend === "hls.js" && adapter) { return kind === "audio" ? adapter.audioTracks || [] : adapter.subtitleTracks || []; }
                    if (backend === "shaka" && adapter && adapterReady) {
                        if (kind === "audio") {
                            return typeof adapter.getAudioTracks === "function" ? adapter.getAudioTracks() :
                                typeof adapter.getVariantTracks === "function" ? adapter.getVariantTracks() : [];
                        }
                        return typeof adapter.getTextTracks === "function" ? adapter.getTextTracks() : [];
                    }
                    return kind === "audio" ? video.audioTracks || [] : video.textTracks || [];
                } catch (ignore) { return []; }
            }

            function listTracks() {
                var result = { audio: [], subtitles: [], subtitlesOff: true };
                var types = ["audio", "subtitles"];
                var n;
                var i;
                var type;
                var track;
                var list;
                var selected;
                if (!channel || destroyed || state === "stopped" || state === "error") { return result; }
                for (n = 0; n < types.length; n += 1) {
                    type = types[n]; list = trackList(type);
                    for (i = 0; i < list.length; i += 1) {
                        track = list[i];
                        if (!track || (type === "subtitles" && backend === "native" && track.kind && track.kind !== "subtitles" && track.kind !== "captions")) { continue; }
                        selected = backend === "hls.js" ? (type === "audio" ? adapter.audioTrack === i : adapter.subtitleTrack === i && adapter.subtitleDisplay !== false) :
                            backend === "shaka" ? !!track.active && (type === "audio" || !subtitleDisabled) :
                            type === "audio" ? !!track.enabled : track.mode === "showing";
                        result[type].push({ id: String(i), label: track.label || track.name || track.language || track.lang || (type === "audio" ? "Audio " : "Subtitles ") + (i + 1),
                            language: track.language || track.lang || "", selected: selected });
                        if (type === "subtitles" && selected) { result.subtitlesOff = false; }
                    }
                }
                return result;
            }

            function selectTrack(kind, id) {
                var list;
                var selected;
                var index;
                var i;
                var off = kind === "subtitles" && (id === null || id === "off" || id === -1 || id === "-1");
                if (destroyed || !channel || !adapterReady || state === "error" || state === "stopped") { return false; }
                index = off ? -1 : Number(id);
                if (!off && (id === null || id === "" || !isFinite(index) || Math.floor(index) !== index)) { return false; }
                list = trackList(kind); selected = list[index];
                if (!off && !selected) { return false; }
                if (kind === "subtitles" && backend === "native" && !off && selected.kind && selected.kind !== "captions" && selected.kind !== "subtitles") { return false; }
                try {
                    if (backend === "hls.js") {
                        if (kind === "audio") { adapter.audioTrack = index; }
                        else { adapter.subtitleTrack = index; adapter.subtitleDisplay = !off; }
                    } else if (backend === "shaka") {
                        if (kind === "audio") {
                            if (typeof adapter.selectAudioTrack === "function") { adapter.selectAudioTrack(selected); }
                            else if (typeof adapter.selectVariantTrack === "function") { adapter.selectVariantTrack(selected, true); }
                            else { return false; }
                        } else {
                            if (typeof adapter.selectTextTrack !== "function") { return false; }
                            if (typeof adapter.setTextTrackVisibility === "function") {
                                if (!off) { adapter.selectTextTrack(selected); }
                                adapter.setTextTrackVisibility(!off);
                            } else { adapter.selectTextTrack(off ? null : selected); }
                            subtitleDisabled = off;
                        }
                    } else {
                        for (i = 0; i < list.length; i += 1) {
                            if (kind === "audio") { list[i].enabled = i === index; }
                            else if (!list[i].kind || list[i].kind === "subtitles" || list[i].kind === "captions") { list[i].mode = i === index ? "showing" : "disabled"; }
                        }
                    }
                    emit("tracks"); return true;
                } catch (ignore) { return false; }
            }

            function connectTracks(token) {
                var targets = [video.audioTracks, video.textTracks];
                var names = ["addtrack", "removetrack", "change"];
                var i;
                var n;
                var handler = function () { if (current(token)) { emit("tracks"); } };
                for (i = 0; i < targets.length; i += 1) {
                    if (targets[i] && typeof targets[i].addEventListener === "function" && typeof targets[i].removeEventListener === "function") {
                        for (n = 0; n < names.length; n += 1) {
                            targets[i].addEventListener(names[n], handler, false);
                            trackListeners.push({ target: targets[i], name: names[n], handler: handler });
                        }
                    }
                }
            }

            function applyGeometry() {
                var style = video.style;
                var parent = video.parentNode;
                var width = parent && parent.clientWidth;
                var height = parent && parent.clientHeight;
                var sourceRatio = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
                var ratio = aspect === "4:3" ? 4 / 3 : aspect === "16:9" ? 16 / 9 : sourceRatio;
                var targetWidth;
                var targetHeight;
                if (!style) { return false; }
                style.objectFit = aspect === "stretch" || aspect === "4:3" || aspect === "16:9" ? "fill" : aspect === "fill" ? "cover" : "contain";
                if (width > 0 && height > 0) {
                    targetWidth = width; targetHeight = height;
                    if (aspect !== "stretch") {
                        if ((width / height > ratio) === (aspect !== "fill")) { targetWidth = height * ratio; }
                        else { targetHeight = width / ratio; }
                    }
                    targetWidth *= zoom; targetHeight *= zoom;
                    style.width = targetWidth + "px"; style.height = targetHeight + "px";
                    style.marginLeft = (width - targetWidth) / 2 + "px";
                    style.marginTop = (height - targetHeight) / 2 + "px";
                } else {
                    style.width = zoom * 100 + "%"; style.height = zoom * 100 + "%";
                    style.marginLeft = (1 - zoom) * 50 + "%"; style.marginTop = (1 - zoom) * 50 + "%";
                }
                return true;
            }

            function pipSupported() {
                if (destroyed) { return false; }
                try {
                    if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function" && typeof document.exitPictureInPicture === "function" && !video.disablePictureInPicture) { return true; }
                    return typeof video.webkitSetPresentationMode === "function" && typeof video.webkitSupportsPresentationMode === "function" && video.webkitSupportsPresentationMode("picture-in-picture");
                } catch (ignore) { return false; }
            }

            function closePip() {
                try {
                    if (document.pictureInPictureElement === video && typeof document.exitPictureInPicture === "function") { swallow(document.exitPictureInPicture()); }
                    if (video.webkitPresentationMode === "picture-in-picture" && typeof video.webkitSetPresentationMode === "function") { video.webkitSetPresentationMode("inline"); }
                } catch (ignore) {}
                pip = false;
            }

            function enterPip() {
                var result;
                var token = generation;
                var attempt;
                if (!channel || state === "error" || state === "stopped" || !pipSupported()) { return false; }
                pipAttempt += 1; attempt = pipAttempt; pipIntent = true;
                function success() {
                    if (!current(token) || attempt !== pipAttempt) {
                        /* A canceled request must not leave the next session floating. */
                        if (!pipIntent) { closePip(); }
                        return;
                    }
                    pip = document.pictureInPictureElement === video || video.webkitPresentationMode === "picture-in-picture";
                    emit("pip");
                }
                function rejected() {
                    if (current(token) && attempt === pipAttempt) { emit("piperror", { code: "pip_unavailable", message: "Picture-in-picture could not open; press the PiP button after playback starts" }); }
                }
                try {
                    if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
                        result = video.requestPictureInPicture();
                        if (result && typeof result.then === "function") { result.then(success, rejected); }
                        else { success(); }
                    } else { video.webkitSetPresentationMode("picture-in-picture"); success(); }
                    return true;
                } catch (ignore) { rejected(); return false; }
            }

            function playRejected(error, token, attempt) {
                if (!current(token) || attempt !== playAttempt || paused) { return; }
                if (error && error.name === "AbortError") { return; }
                if (error && error.name === "NotAllowedError") {
                    paused = true;
                    clearTimer("stall"); clearVideoCheck();
                    setState("paused", "autoplayblocked", { code: "autoplay_blocked", message: "Press Play to start playback" });
                } else {
                    if (!fallback("play_failed", token)) {
                        failure("play_failed", error && error.message ? error.message : "Playback could not start");
                    }
                }
            }

            function requestPlay(token) {
                var result;
                var attempt;
                if (!current(token) || paused || !adapterReady || !channel) { return; }
                playAttempt += 1;
                attempt = playAttempt;
                try {
                    result = video.play();
                    if (result && typeof result.then === "function") {
                        result.then(function () {}, function (error) { playRejected(error, token, attempt); });
                    }
                    if (!paused && state !== "error") { watch(token); verifyVideo(token); }
                } catch (error) { playRejected(error, token, attempt); }
            }

            function connectEvents(token) {
                listen("loadstart", function () {
                    if (!paused && retryTimer === null) { setState("loading"); watch(token); }
                }, token);
                listen("loadedmetadata", function () { applyGeometry(); restorePosition(); inspectNativeTracks(token); verifyVideo(token); emit("metadata"); emit("tracks"); }, token);
                listen("canplay", function () { restorePosition(); }, token);
                listen("playing", function () {
                    if (paused) { try { video.pause(); } catch (ignore) {} return; }
                    needsReload = false;
                    clearTimer("retry");
                    if (Math.abs(number(video.currentTime) - lastProgress) > 0.01) { clearTimer("stall"); }
                    lastProgress = number(video.currentTime);
                    setState("playing"); watch(token); inspectNativeTracks(token); verifyVideo(token);
                }, token);
                listen("pause", function () {
                    if (paused || video.paused === true && (state === "playing" || state === "buffering")) {
                        paused = true; playAttempt += 1;
                        clearTimer("retry"); clearTimer("stall"); clearVideoCheck(); setState("paused");
                    }
                }, token);
                listen("waiting", function () {
                    if (!paused && retryTimer === null) { setState("buffering"); watch(token); }
                }, token);
                listen("stalled", function () {
                    if (!paused && retryTimer === null) { setState("buffering"); watch(token); }
                }, token);
                listen("timeupdate", function () {
                    restorePosition();
                    var position = number(video.currentTime);
                    var progressed = Math.abs(position - lastProgress) > 0.01;
                    if (!paused && progressed) {
                        lastProgress = position;
                        clearTimer("stall"); watch(token);
                    }
                    if (videoPresent() && videoTimer !== null) { environment.clearTimeout(videoTimer); videoTimer = null; }
                    inspectNativeTracks(token); verifyVideo(token);
                    if (!paused && progressed && state === "buffering" && video.readyState >= 3) {
                        clearTimer("stall"); watch(token);
                        setState("playing");
                    }
                    emit("timeupdate");
                }, token);
                listen("durationchange", function () { emit("metadata"); }, token);
                listen("volumechange", function () { emit("volumechange"); }, token);
                listen("resize", function () { applyGeometry(); if (videoPresent() && videoTimer !== null) { environment.clearTimeout(videoTimer); videoTimer = null; } }, token);
                listen("enterpictureinpicture", function () { pip = true; emit("pip"); }, token);
                listen("leavepictureinpicture", function () { pip = false; emit("pip"); }, token);
                listen("webkitpresentationmodechanged", function () { pip = video.webkitPresentationMode === "picture-in-picture"; emit("pip"); }, token);
                listen("ended", function () {
                    clearTimer("stall"); clearVideoCheck();
                    if (!paused && channel.kind === "live") { retry("live_ended", "The live stream ended", token); }
                    else { resumePosition = null; liveResume = null; setState("ended"); }
                }, token);
                connectTracks(token);
                if (typeof environment.addEventListener === "function" && typeof environment.removeEventListener === "function") {
                    var resized = function () { if (current(token)) { applyGeometry(); } };
                    environment.addEventListener("resize", resized, false);
                    trackListeners.push({ target: environment, name: "resize", handler: resized });
                }
                listen("error", function () {
                    var code = video.error ? video.error.code : 0;
                    if (paused) { preservePosition(); cleanup(); needsReload = true; setState("paused"); return; }
                    if (code === 2) { retry("network_error", "The stream could not be loaded", token); }
                    else if (code !== 1 && !fallback("media_error_" + code, token)) { failure("media_error_" + code, "The selected engine could not decode or open this stream; try another engine or stream format"); }
                }, token);
            }

            function setupHls(url, token) {
                var Hls = libraries.Hls;
                var compatibility = environment.OTT2Compat;
                var useWorker = !hlsWorkerFailed && !!(compatibility && compatibility.ready && compatibility.nativeBinary && compatibility.nativeWorker);
                var compact = typeof options.lowMemory === "boolean" ? options.lowMemory : lgDevice() || !!options.device && !/^(pc|pc2|nodejs|edem)$/.test(options.device);
                var hls = new Hls({ enableWorker: useWorker, workerPath: "/src/hls-worker.js",
                    backBufferLength: compact ? 10 : 30, maxBufferLength: compact ? 15 : 30,
                    maxMaxBufferLength: compact ? 30 : 60, maxBufferSize: compact ? 30000000 : 60000000,
                    lowLatencyMode: false, capLevelToPlayerSize: false });
                adapter = hls;
                adapterReady = false;
                backend = "hls.js";
                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    if (!current(token)) { return; }
                    adapterReady = true;
                    var levels = hls.levels || [];
                    for (var at = 0; at < levels.length; at += 1) { noteVideoEvidence(!!levels[at].videoCodec, token); }
                    restorePosition();
                    emit("tracks");
                    requestPlay(token);
                });
                hls.on(Hls.Events.ERROR, function (name, data) {
                    if (current(token) && data && data.event === "demuxerWorker") { hlsWorkerFailed = true; }
                    if (!current(token) || !data || !data.fatal) { return; }
                    if (paused) { preservePosition(); cleanup(); needsReload = true; setState("paused"); return; }
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        retry("hls_network_error", "The HLS stream could not be loaded", token);
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveryUsed && typeof hls.recoverMediaError === "function") {
                        mediaRecoveryUsed = true;
                        var failed = data.frag && typeof data.frag.level === "number" ? data.frag.level : typeof data.level === "number" ? data.level : hls.currentLevel;
                        if (hls.levels && failed > 0 && failed < hls.levels.length) { hls.autoLevelCapping = failed - 1; hls.nextLevel = failed - 1; }
                        setState("loading", "recovery");
                        try { hls.recoverMediaError(); if (!paused) { clearTimer("stall"); watch(token); } }
                        catch (ignore) { if (!fallback("hls_media_error", token)) { failure("hls_media_error", "The device could not recover the HLS stream"); } }
                    } else if (!fallback("hls_media_error", token)) { failure("hls_media_error", "The device could not decode the HLS stream"); }
                });
                var trackEvents = [Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH];
                var i;
                for (i = 0; i < trackEvents.length; i += 1) {
                    if (trackEvents[i]) { hls.on(trackEvents[i], function () { if (current(token)) { emit("tracks"); } }); }
                }
                hls.attachMedia(video);
                if (current(token)) { hls.loadSource(url); }
                watch(token);
            }

            function setupShaka(url, token) {
                var player = new libraries.shaka.Player();
                var attached;
                adapter = player;
                adapterReady = false;
                backend = "shaka";

                function rejected(error) {
                    if (!current(token)) { return; }
                    if (paused) { preservePosition(); cleanup(); needsReload = true; setState("paused"); return; }
                    if (!fallback("dash_error", token)) { failure("dash_error", error && error.message ? error.message : "The stream could not be loaded by Shaka"); }
                }

                function loaded() {
                    if (!current(token)) { return; }
                    adapterReady = true;
                    restorePosition();
                    emit("tracks");
                    requestPlay(token);
                }

                function loadManifest() {
                    var result;
                    if (!current(token)) { return; }
                    try {
                        result = player.load(url, resumePosition === null ? undefined : resumePosition, streamFormat === "hls" ? "application/x-mpegurl" : streamFormat === "dash" ? "application/dash+xml" : undefined);
                        if (result && typeof result.then === "function") { result.then(loaded, rejected); }
                        else { loaded(); }
                    } catch (error) { rejected(error); }
                }

                if (typeof player.addEventListener === "function") {
                    player.addEventListener("error", function (event) {
                        if (!current(token)) { return; }
                        var error = event && event.detail;
                        if (error && error.severity === 1) {
                            // Runtime RECOVERABLE errors are owned by Shaka. Keep
                            // the existing progress deadline: repeated errors must
                            // not extend a stalled session indefinitely.
                            if (!paused) { setState("buffering", "recovery"); watch(token); }
                            return;
                        }
                        rejected(error);
                    });
                    var trackEvents = ["trackschanged", "variantchanged", "textchanged", "adaptation", "audiotrackschanged", "audiotrackchanged"];
                    var i;
                    for (i = 0; i < trackEvents.length; i += 1) {
                        player.addEventListener(trackEvents[i], function () { if (current(token)) { emit("tracks"); } });
                    }
                }
                if (typeof player.attach !== "function") { throw new Error("This Shaka adapter does not support attach()"); }
                attached = player.attach(video);
                if (attached && typeof attached.then === "function") { attached.then(loadManifest, rejected); }
                else { loadManifest(); }
                watch(token);
            }

            function formatOf(value) {
                value = String(value || "").toLowerCase();
                if (/mpegurl|m3u8/.test(value)) { return "hls"; }
                if (/dash\+xml|(?:^|[\/.])mpd(?:[;?]|$)/.test(value) || value === "dash") { return "dash"; }
                if (/flv/.test(value)) { return "flv"; }
                if (/mp2t|mpegts|mpeg-ts/.test(value) || value === "ts") { return "mpegts"; }
                if (/video\/(?:mp4|webm|ogg|quicktime)|audio\/(?:mpeg|mp4|aac|ogg)/.test(value) || value === "file") { return "file"; }
                return "";
            }

            function declaredFormat(next) {
                var value = formatOf(next.mime || next.contentType || "") || formatOf(next.format || "") || formatOf(next.type || "");
                var url = next.url || "";
                var hint = /[?&](?:output|format|extension|container|type)=([^&#]+)/i.exec(url);
                if (value) { detectReason = "declared_type"; return value; }
                if (hint) {
                    try { value = formatOf(decodeURIComponent(hint[1])); } catch (ignore) { value = formatOf(hint[1]); }
                    if (value) { detectReason = "url_hint"; return value; }
                }
                detectReason = "url_extension";
                if (/\.m3u8(?:[?#]|$)/i.test(url)) { return "hls"; }
                if (/\.mpd(?:[?#]|$)/i.test(url)) { return "dash"; }
                if (/\.flv(?:[?#]|$)/i.test(url)) { return "flv"; }
                if (/\.(?:ts|m2ts)(?:[?#]|$)/i.test(url)) { return "mpegts"; }
                if (/\.(?:mp4|m4v|m4a|webm|ogg|mp3|aac|mov)(?:[?#]|$)/i.test(url) || /^blob:/i.test(url)) { return "file"; }
                return "";
            }

            function bodyFormat(text) {
                var value = String(text || "").slice(0, 4096);
                var clean = value.replace(/^\uFEFF/, "").replace(/^\s+/, "");
                var i;
                if (value.slice(0, 3) === "FLV") { return "flv"; }
                if (/^#EXTM3U/.test(clean)) { return "hls"; }
                if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<(?:(?:[\w-]+):)?MPD[\s>]/i.test(clean)) { return "dash"; }
                for (i = 0; i < Math.min(188, value.length - 376); i += 1) {
                    if ((value.charCodeAt(i) & 255) === 71 && (value.charCodeAt(i + 188) & 255) === 71 && (value.charCodeAt(i + 376) & 255) === 71) { return "mpegts"; }
                }
                if (value.slice(4, 8) === "ftyp" || value.slice(4, 8) === "moov" || value.slice(4, 8) === "moof") { return "file"; }
                return "";
            }

            /* Probe only unlabelled URLs. Abort on a type/signature, 64 KiB or 4 seconds. */
            function probe(next, token, done) {
                var xhr;
                var timer = null;
                var finished = false;
                var url;
                function finish(value, deliver, reason) {
                    if (finished) { return; }
                    finished = true;
                    if (timer !== null) { environment.clearTimeout(timer); timer = null; }
                    if (xhr) {
                        xhr.onreadystatechange = null; xhr.onprogress = null; xhr.onerror = null; xhr.ontimeout = null;
                        try { xhr.abort(); } catch (ignore) {}
                    }
                    cancelProbe = null; detecting = false;
                    if (reason) { detectReason = reason; }
                    if (deliver !== false && current(token)) { done(value || ""); }
                }
                function inspect(event) {
                    var mime = "";
                    var text = "";
                    var result;
                    if (finished || !current(token)) { return; }
                    try { if (xhr.readyState >= 2 && xhr.status >= 200 && xhr.status < 300) { mime = xhr.getResponseHeader("Content-Type") || ""; } } catch (ignoreHeader) {}
                    result = formatOf(mime);
                    if (result) { finish(result, true, "response_header"); return; }
                    try { if (xhr.readyState >= 3) { text = xhr.responseText || ""; } } catch (ignoreBody) {}
                    result = bodyFormat(text);
                    if (result || text.length >= 65536 || event && event.loaded >= 65536 || xhr.readyState === 4) { finish(result, true, result ? "body_signature" : xhr.readyState === 4 ? "unrecognized_body" : "probe_limit"); }
                }
                if (typeof environment.XMLHttpRequest !== "function") { detectReason = "probe_unavailable"; done(""); return; }
                detecting = true;
                cancelProbe = function () { finish("", false); };
                try {
                    xhr = new environment.XMLHttpRequest();
                    url = typeof config.probeUrl === "function" ? config.probeUrl(next.url) : next.url;
                    xhr.open("GET", url, true);
                    if (typeof xhr.overrideMimeType === "function") { xhr.overrideMimeType("text/plain; charset=x-user-defined"); }
                    xhr.onreadystatechange = inspect; xhr.onprogress = inspect;
                    xhr.onerror = function () { finish("", true, "probe_error"); }; xhr.ontimeout = xhr.onerror;
                    timer = environment.setTimeout(function () { finish("", true, "probe_timeout"); }, positive(options.probeTimeout, 4000));
                    emit("detecting");
                    xhr.send(null);
                } catch (ignore) { finish("", true, "probe_error"); }
            }

            function planEngines(format) {
                var cap = capabilities();
                var list = [];
                if (enginePreference !== "auto") { return [enginePreference]; }
                if (format === "hls") {
                    if (lgDevice() || cap.nativeHls && !chromiumDevice()) { list.push("native"); }
                    if (cap.hlsJs) { list.push("hls.js"); }
                    if (cap.shaka) { list.push("shaka"); }
                    if (cap.nativeHls && list.indexOf("native") < 0) { list.push("native"); }
                } else if (format === "dash") {
                    if (cap.shaka) { list.push("shaka"); }
                    if (cap.nativeDash) { list.push("native"); }
                } else if (format === "mpegts" || format === "flv") {
                    if (cap.mpegts) { list.push("mpegts"); }
                    if (supports(format === "flv" ? "video/x-flv" : "video/mp2t")) { list.push("native"); }
                } else { list.push("native"); }
                return list;
            }

            function preservePosition() {
                var position = number(video.currentTime);
                var range = seekRange();
                // A replacement may fail before it has a timeline. Pending
                // restoration belongs to the last working engine until applied.
                if (resumePosition !== null || liveResume || !channel || state === "stopped" || state === "ended" || state === "error") { return; }
                if (channel && channel.kind === "live") {
                    liveResume = { distance: range && position >= range.start && position <= range.end ? range.end - position : 0 };
                    resumePosition = null;
                } else if (position > 0 && range) { resumePosition = position; liveResume = null; }
            }

            function restorePosition() {
                var range;
                var position = resumePosition;
                if ((position === null && !liveResume) || !adapterReady || video.readyState < 1) { return; }
                range = seekRange();
                if (!range) { return; }
                if (liveResume) {
                    position = Math.max(range.start, range.end - liveResume.distance);
                    for (var at = 1; at < range.ranges.length; at += 1) {
                        if (position > range.ranges[at - 1].end && position < range.ranges[at].start) { position = range.ranges[at].start; break; }
                    }
                }
                try {
                    video.currentTime = Math.max(range.start, Math.min(position, range.end));
                    resumePosition = null; liveResume = null;
                } catch (ignore) {
                    // Live ranges can move before a temporarily rejected seek is
                    // retried. Retain its edge distance, not this range's seconds.
                    if (!liveResume) { resumePosition = position; }
                }
            }

            function fallback(reason, token) {
                if (!current(token) || enginePreference !== "auto" || engineIndex + 1 >= enginePlan.length) { return false; }
                preservePosition();
                engineIndex += 1; fallbackCount += 1; retryCount = 0;
                emit("enginefallback", { code: reason, message: "Trying another compatible playback engine" });
                start(channel);
                return true;
            }

            function setupMpegts(url, token) {
                var library = libraries.mpegts;
                var player = library.createPlayer({ type: streamFormat === "flv" ? "flv" : streamFormat === "mpegts" ? "mpegts" : "mse", url: url, isLive: channel.kind === "live", cors: true }, { enableWorker: false, enableWorkerForMSE: false, enableStashBuffer: true });
                adapter = player; adapterReady = true; backend = "mpegts";
                if (typeof player.on === "function" && library.Events) {
                    player.on(library.Events.ERROR, function (type) {
                        if (!current(token)) { return; }
                        if (library.ErrorTypes && type === library.ErrorTypes.NETWORK_ERROR) { retry("mpegts_network_error", "The MPEG-TS stream could not be loaded", token); }
                        else if (!fallback("mpegts_media_error", token)) { failure("mpegts_media_error", "The MPEG-TS stream could not be decoded"); }
                    });
                }
                player.attachMediaElement(video); player.load(); requestPlay(token);
            }

            function nativeLoad(next, token) {
                var mime = streamFormat === "hls" ? "application/vnd.apple.mpegurl" : streamFormat === "dash" ? "application/dash+xml" : streamFormat === "mpegts" ? "video/mp2t" : "";
                if (mime && lgDevice() && typeof document.createElement === "function" && typeof video.appendChild === "function") {
                    nativeSource = document.createElement("source"); nativeSource.setAttribute("src", next.url); nativeSource.setAttribute("type", mime);
                    if (typeof nativeSource.addEventListener === "function" && typeof nativeSource.removeEventListener === "function") {
                        var sourceFailed = function () {
                            if (!current(token)) { return; }
                            if (paused) { preservePosition(); cleanup(); needsReload = true; setState("paused"); return; }
                            if (!fallback("native_source_error", token)) { failure("native_source_error", "The native player could not open this stream"); }
                        };
                        nativeSource.addEventListener("error", sourceFailed, false);
                        trackListeners.push({ target: nativeSource, name: "error", handler: sourceFailed });
                    }
                    video.appendChild(nativeSource);
                } else { video.src = next.url; }
                video.load();
            }

            function start(next) {
                var token;
                var pendingDisposal = cleanup();
                needsReload = false; subtitleDisabled = false; channel = next;
                videoExpected = !knownRadio() && next.video === true;
                lastProgress = number(video.currentTime); videoProbeTried = false;
                initialVideoFrames = videoFrames(); verifiedVideoFrames = false;
                backend = "native"; token = generation; adapterReady = false;
                setState(paused ? "paused" : "loading");
                function launchEngine(format) {
                    var cap;
                    var choice;
                    if (!current(token)) { return; }
                    streamFormat = format;
                    if (!enginePlan.length) { enginePlan = planEngines(format); engineIndex = 0; }
                    choice = enginePlan[engineIndex];
                    cap = capabilities();
                    if (!choice) { failure((format || "stream") + "_unsupported", "No compatible " + (format || "stream") + " engine is available on this device"); return; }
                    backend = choice;
                    if (choice === "hls.js" && !cap.hlsJs || choice === "shaka" && !cap.shaka || choice === "mpegts" && !cap.mpegts) {
                        if (!fallback("engine_unavailable", token)) { failure("engine_unavailable", "The selected playback engine is unavailable on this device"); }
                        return;
                    }
                    var vendorName = choice === "hls.js" ? "Hls" : choice === "shaka" ? "shaka" : choice === "mpegts" ? "mpegts" : "";
                    var available = choice === "hls.js" ? hlsSupported() : choice === "shaka" ? shakaSupported() : choice === "mpegts" ? mpegtsSupported() : true;
                    if (vendorName && !available) {
                        if (canLoadVendor(vendorName)) {
                            adapterReady = false; emit("engine");
                            var finished = false;
                            var unsubscribe = environment.OTT2VendorLoader.load(vendorName, function (error) {
                                finished = true;
                                if (!current(token)) { return; }
                                cancelVendor = null;
                                var ready = choice === "hls.js" ? hlsSupported() : choice === "shaka" ? shakaSupported() : mpegtsSupported();
                                if (error || !ready) { if (!fallback("engine_unavailable", token)) { failure("engine_unavailable", "The selected playback engine could not load on this device"); } }
                                else { launchEngine(format); }
                            });
                            if (!finished) { cancelVendor = unsubscribe; }
                        } else if (!fallback("engine_unavailable", token)) { failure("engine_unavailable", "The selected playback engine is unavailable on this device"); }
                        return;
                    }
                    connectEvents(token); adapterReady = true; applyGeometry();
                    emit("engine");
                    try {
                        if (choice === "hls.js") { setupHls(next.url, token); }
                        else if (choice === "shaka") { setupShaka(next.url, token); }
                        else if (choice === "mpegts") { setupMpegts(next.url, token); }
                        else { nativeLoad(next, token); requestPlay(token); }
                    } catch (error) { if (!fallback("engine_error", token)) { failure("engine_error", error.message || "The media engine could not start"); } }
                }
                function launch() {
                    var format;
                    if (!current(token)) { return; }
                    disposal = null;
                    format = streamFormat || (formatPreference !== "auto" ? formatPreference : declaredFormat(next));
                    if (formatPreference !== "auto") { detectReason = "manual_format"; }
                    if (!format && enginePreference === "auto") { probe(next, token, launchEngine); }
                    else { launchEngine(format); }
                }
                if (pendingDisposal && typeof pendingDisposal.then === "function") { pendingDisposal.then(launch, launch); }
                else { launch(); }
            }

            return {
                load: function (next, selection) {
                    if (destroyed) { return false; }
                    suspended = false;
                    if (!next || typeof next.url !== "string" || !/^(https?:\/\/|blob:)/i.test(next.url)) {
                        cleanup();
                        channel = null;
                        failure("invalid_url", "A valid HTTP(S) or blob stream URL is required");
                        return false;
                    }
                    selection = selection || {};
                    if (selection.engine !== undefined && !validEngine(selection.engine) || next.engine !== undefined && !validEngine(next.engine) || selection.format !== undefined && !validFormat(selection.format)) {
                        failure("invalid_engine", "Unknown engine or stream format"); return false;
                    }
                    enginePreference = selection.engine || next.engine || enginePreference;
                    formatPreference = selection.format || (validFormat(next.format) ? next.format : "auto");
                    streamFormat = ""; detectReason = "none"; lastError = null; enginePlan = []; engineIndex = 0; fallbackCount = 0; resumePosition = null; liveResume = null; mediaRecoveryUsed = false;
                    retryCount = 0;
                    paused = false;
                    start(next);
                    return state !== "error";
                },
                setEngine: function (value) {
                    if (destroyed || !validEngine(value)) { return false; }
                    if (enginePreference === value && state !== "error") { return true; }
                    preservePosition(); enginePreference = value; lastError = null;
                    enginePlan = []; engineIndex = 0; fallbackCount = 0; retryCount = 0; mediaRecoveryUsed = false;
                    if (channel && !suspended && state !== "stopped" && state !== "idle") { start(channel); }
                    else { emit("engine"); }
                    return state !== "error";
                },
                setFormat: function (value) {
                    if (destroyed || !validFormat(value)) { return false; }
                    preservePosition(); formatPreference = value; streamFormat = ""; lastError = null;
                    enginePlan = []; engineIndex = 0; fallbackCount = 0; retryCount = 0; mediaRecoveryUsed = false;
                    if (channel && !suspended && state !== "stopped" && state !== "idle") { start(channel); }
                    else { emit("engine"); }
                    return state !== "error";
                },
                play: function () {
                    if (destroyed || !channel) { return false; }
                    paused = false; lastError = null;
                    if (suspended) { emit("suspended"); return true; }
                    if (needsReload || state === "error" || state === "stopped" || state === "ended" || state === "retrying") {
                        retryCount = 0;
                        start(channel);
                    } else { requestPlay(generation); }
                    return true;
                },
                pause: function () {
                    if (destroyed || !channel) { return; }
                    paused = true;
                    playAttempt += 1;
                    clearTimer("retry");
                    clearTimer("stall"); clearVideoCheck();
                    try { video.pause(); } catch (ignore) {}
                    setState(suspended ? "suspended" : "paused");
                },
                suspend: function (intent) {
                    if (destroyed || !channel || state === "stopped" || state === "ended" || state === "error" || state === "idle") { return false; }
                    if (suspended) { return true; }
                    preservePosition();
                    // A TV host can emit pause before visibilitychange. The
                    // controller may supply its explicit transport intent only
                    // after confirming host suspension; ordinary callers retain
                    // native-control and autoplay pause behavior by default.
                    if (intent && typeof intent.paused === "boolean") { paused = intent.paused; }
                    suspended = true;
                    // Teardown invalidates host pause/playing events and pending
                    // adapter work without changing the user's playback intent.
                    cleanup(); needsReload = true;
                    setState("suspended");
                    return true;
                },
                resume: function () {
                    if (destroyed || !suspended || !channel) { return false; }
                    suspended = false;
                    // A deliberately paused session stays detached until Play;
                    // attaching a TV decoder may itself start host playback.
                    if (paused) { setState("paused"); }
                    else { start(channel); }
                    return true;
                },
                stop: function () {
                    if (destroyed) { return; }
                    cleanup();
                    suspended = false;
                    resumePosition = null; liveResume = null;
                    paused = true;
                    setState("stopped");
                },
                seek: function (seconds) {
                    var range;
                    var target;
                    var i;
                    if (destroyed || !channel || typeof seconds !== "number" || !isFinite(seconds)) { return false; }
                    range = seekRange();
                    if (!range) { return false; }
                    target = Math.max(range.start, Math.min(seconds, range.end));
                    for (i = 1; i < range.ranges.length; i += 1) {
                        if (target > range.ranges[i - 1].end && target < range.ranges[i].start) {
                            target = target - range.ranges[i - 1].end < range.ranges[i].start - target ? range.ranges[i - 1].end : range.ranges[i].start;
                            break;
                        }
                    }
                    try { video.currentTime = target; resumePosition = null; liveResume = null; emit("seek"); return true; }
                    catch (ignore) { return false; }
                },
                volume: function (value) {
                    if (destroyed || typeof value !== "number" || !isFinite(value)) { return false; }
                    try { video.volume = Math.max(0, Math.min(1, value)); return true; }
                    catch (ignore) { return false; }
                },
                mute: function (value) {
                    if (destroyed) { return; }
                    try { video.muted = !!value; } catch (ignore) {}
                },
                listTracks: listTracks,
                selectAudio: function (id) { return selectTrack("audio", id); },
                selectSubtitle: function (id) { return selectTrack("subtitles", id); },
                resize: function () { return !destroyed && applyGeometry(); },
                setAspect: function (value) {
                    if (destroyed || ["fit", "fill", "stretch", "16:9", "4:3"].indexOf(value) < 0) { return false; }
                    aspect = value;
                    if (!applyGeometry()) { return false; }
                    emit("geometry"); return true;
                },
                setZoom: function (value) {
                    if (destroyed || typeof value !== "number" || !isFinite(value) || value < 0.5 || value > 3) { return false; }
                    zoom = value;
                    if (!applyGeometry()) { return false; }
                    emit("geometry"); return true;
                },
                enterPip: enterPip,
                exitPip: function () {
                    if (destroyed) { return false; }
                    pipAttempt += 1; pipIntent = false; closePip(); emit("pip"); return true;
                },
                destroy: function () {
                    if (destroyed) { return; }
                    cleanup();
                    destroyed = true;
                    suspended = false;
                    paused = true;
                    channel = null;
                    if (video.style) { video.style.cssText = originalStyle; }
                    setState("destroyed");
                },
                getState: snapshot,
                capabilities: capabilities
            };
        }
        return { create: create };
    });
}(window));
