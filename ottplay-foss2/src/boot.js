/* Language polyfills precede this bootstrap; optional engines load on demand. */
(function (w, d) {
    "use strict";
    var started = false, compatibility = w.OTT2Compat;
    var vendors = { Hls: null, shaka: null, mpegts: null };
    var sources = { Hls: "/vendor/hls.min.js", shaka: "/vendor/shaka.min.js", mpegts: "/vendor/mpegts.min.js" };
    var entries = {}, own = Object.prototype.hasOwnProperty;
    w.OTT2Vendors = vendors;

    function canLoadMedia() {
        // Emulated typed arrays cannot be passed into a native MediaSource.
        return !!(compatibility && compatibility.ready && compatibility.nativeBinary &&
            w.URL && typeof w.URL.createObjectURL === "function" &&
            (w.MediaSource || w.ManagedMediaSource || w.WebKitMediaSource));
    }
    function failure(code, name) {
        var error = new Error("The " + name + " playback engine could not be loaded");
        error.code = code;
        return error;
    }
    function known(name) { return typeof name === "string" && own.call(sources, name); }
    function status(name) {
        if (!known(name)) { return "unavailable"; }
        if (entries[name]) { return entries[name].state; }
        return canLoadMedia() ? "idle" : "unavailable";
    }
    function canLoad(name) { var state = status(name); return state === "idle" || state === "loading" || state === "ready"; }
    function valid(name, value) {
        if (name === "Hls") { return typeof value === "function" && typeof value.isSupported === "function"; }
        if (name === "shaka") { return value && typeof value.Player === "function"; }
        return value && typeof value.createPlayer === "function" && typeof value.isSupported === "function";
    }
    function deliver(waiter, error, value) {
        if (!waiter.active) { return; }
        waiter.active = false;
        try { waiter.callback(error, value); }
        catch (callbackError) {
            if (w.console && w.console.error) { w.console.error("Playback engine callback failed", callbackError.name); }
        }
    }
    function load(name, callback) {
        var waiter = { active: true, callback: typeof callback === "function" ? callback : function () {} };
        var entry, script, timer, settled = false;
        function cancel() {
            waiter.active = false;
            if (entry) {
                for (var i = entry.waiters.length - 1; i >= 0; i--) {
                    if (entry.waiters[i] === waiter) { entry.waiters.splice(i, 1); }
                }
            }
        }
        if (!known(name)) { deliver(waiter, failure("vendor_unavailable", String(name)), null); return cancel; }
        entry = entries[name];
        if (entry) {
            if (entry.state === "loading") { entry.waiters.push(waiter); }
            else { deliver(waiter, entry.error, vendors[name]); }
            return cancel;
        }
        if (!canLoadMedia()) { deliver(waiter, failure("vendor_unavailable", name), null); return cancel; }
        entry = { state: "loading", waiters: [waiter], error: null };
        entries[name] = entry;
        script = d.createElement("script");
        function finish(error) {
            var value, waiters, i;
            if (settled) { return; }
            settled = true;
            w.clearTimeout(timer);
            script.onload = script.onerror = script.onreadystatechange = null;
            if (!error) {
                value = w[name];
                if (!valid(name, value)) { error = failure("vendor_invalid", name); }
                else if (name === "shaka") {
                    try { if (value.polyfill && value.polyfill.installAll) { value.polyfill.installAll(); } }
                    catch (polyfillError) { error = failure("vendor_polyfill", name); }
                }
            }
            entry.error = error || null;
            entry.state = error ? "failed" : "ready";
            // Only this accepted result is visible to playback. A script that
            // executes after a timeout cannot enter the registry through globals.
            if (!error) { vendors[name] = value; }
            if (error) {
                try { if (script.parentNode) { script.parentNode.removeChild(script); } } catch (ignoreRemove) {}
            }
            waiters = entry.waiters; entry.waiters = [];
            for (i = 0; i < waiters.length; i++) { deliver(waiters[i], entry.error, vendors[name]); }
        }
        // A preexisting or late global cannot masquerade as this request's result.
        try { w[name] = undefined; } catch (ignoreGlobal) {}
        if (typeof w[name] !== "undefined") { finish(failure("vendor_invalid", name)); return cancel; }
        script.src = sources[name];
        // Page polyfills are already ready; independent engines need no ordering.
        script.async = true;
        script.onload = function () { finish(null); };
        script.onerror = function () { finish(failure("vendor_load", name)); };
        script.onreadystatechange = function () {
            if (script.readyState === "loaded" || script.readyState === "complete") { finish(null); }
        };
        timer = w.setTimeout(function () { finish(failure("vendor_timeout", name)); }, 5000);
        try { (d.head || d.getElementsByTagName("head")[0] || d.documentElement).appendChild(script); }
        catch (appendError) { finish(failure("vendor_load", name)); }
        return cancel;
    }
    w.OTT2VendorLoader = { load: load, canLoad: canLoad, status: status };
    function start() {
        if (started) { return; }
        started = true;
        try { w.OTT2.require("app").start(w); }
        catch (error) {
            var root = d.getElementById("foss2-home");
            root.innerHTML = '<div id="boot-message">Could not start the player.<br><button id="boot-retry" type="button">Retry</button></div>';
            d.getElementById("boot-retry").onclick = function () { w.location.reload(); };
            if (w.console && w.console.error) { w.console.error("OTT-play 2 startup failed", error.name); }
        }
    }
    // Browsing and native playback never wait for unrelated media libraries.
    start();
})(window, document);
