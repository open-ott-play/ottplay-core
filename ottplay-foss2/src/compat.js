/* Capture native capabilities before core-js, in both the page and worker realms. */
(function (scope) {
    "use strict";

    if (scope.OTT2Compat) { return; }

    var originalURL = scope.URL;
    var prefixedURL = scope.webkitURL;
    var objectURLSource = originalURL && typeof originalURL.createObjectURL === "function" ? originalURL : prefixedURL;
    var revokeURLSource = originalURL && typeof originalURL.revokeObjectURL === "function" ? originalURL : prefixedURL;
    var createObjectURL = objectURLSource && objectURLSource.createObjectURL;
    var revokeObjectURL = revokeURLSource && revokeURLSource.revokeObjectURL;
    var clockOrigin = new Date().getTime();

    function nativeBinaryAvailable() {
        var names = ["ArrayBuffer", "DataView", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array"];
        var index, buffer, bytes, view;
        for (index = 0; index < names.length; index += 1) {
            if (typeof scope[names[index]] !== "function") { return false; }
        }
        try {
            buffer = new scope.ArrayBuffer(8);
            bytes = new scope.Uint8Array(buffer);
            view = new scope.DataView(buffer);
            bytes[0] = 37;
            view.setUint8(1, 91);
            return bytes.buffer === buffer && bytes.byteLength === 8 && view.getUint8(0) === 37 && bytes[1] === 91;
        } catch (ignore) { return false; }
    }

    function setIfMissing(object, key, value) {
        if (typeof object[key] !== "undefined" && object[key] !== null) { return; }
        try { object[key] = value; } catch (ignore) {}
        if (typeof object[key] !== "undefined" && object[key] !== null) { return; }
        try { Object.defineProperty(object, key, { configurable: true, writable: true, value: value }); } catch (ignore) {}
    }

    function installPlatformHelpers() {
        var lastTime = 0;
        var performance = scope.performance;
        if (!performance) {
            performance = {};
            setIfMissing(scope, "performance", performance);
        }
        if (performance) {
            setIfMissing(performance, "now", function () {
                // Clock corrections must not produce negative or decreasing fragment timings.
                var elapsed = new Date().getTime() - clockOrigin;
                if (elapsed > lastTime) { lastTime = elapsed; }
                return lastTime;
            });
            setIfMissing(performance, "timeOrigin", clockOrigin);
        }
        if (scope.URL) {
            if (typeof createObjectURL === "function") {
                setIfMissing(scope.URL, "createObjectURL", function (object) { return createObjectURL.call(objectURLSource, object); });
            }
            if (typeof revokeObjectURL === "function") {
                setIfMissing(scope.URL, "revokeObjectURL", function (url) { return revokeObjectURL.call(revokeURLSource, url); });
            }
        }
    }

    var compatibility = {
        version: "1",
        // JavaScript-emulated typed arrays cannot establish MSE or transferable-buffer support.
        nativeBinary: nativeBinaryAvailable(),
        nativeWorker: typeof scope.Worker === "function",
        ready: false,
        missing: [],
        install: function () {
            var missing = [], index;
            var globals = ["Promise", "Symbol", "Map", "Set", "WeakMap", "WeakSet", "URL", "URLSearchParams"];
            function requireFunction(object, name, label) {
                if (!object || typeof object[name] !== "function") { missing.push(label); }
            }
            installPlatformHelpers();
            for (index = 0; index < globals.length; index += 1) {
                requireFunction(scope, globals[index], globals[index]);
            }
            requireFunction(Object, "assign", "Object.assign");
            requireFunction(Object, "entries", "Object.entries");
            requireFunction(Object, "values", "Object.values");
            requireFunction(Object, "is", "Object.is");
            requireFunction(Object, "getOwnPropertyDescriptors", "Object.getOwnPropertyDescriptors");
            requireFunction(Array, "from", "Array.from");
            requireFunction(Array.prototype, "includes", "Array.prototype.includes");
            requireFunction(Array.prototype, "find", "Array.prototype.find");
            requireFunction(Array.prototype, "findIndex", "Array.prototype.findIndex");
            requireFunction(String.prototype, "includes", "String.prototype.includes");
            requireFunction(String.prototype, "startsWith", "String.prototype.startsWith");
            requireFunction(String.prototype, "endsWith", "String.prototype.endsWith");
            requireFunction(String, "fromCodePoint", "String.fromCodePoint");
            requireFunction(Number, "isFinite", "Number.isFinite");
            requireFunction(Number, "isNaN", "Number.isNaN");
            requireFunction(Number, "isInteger", "Number.isInteger");
            requireFunction(Number, "isSafeInteger", "Number.isSafeInteger");
            requireFunction(Math, "imul", "Math.imul");
            requireFunction(Math, "clz32", "Math.clz32");
            requireFunction(Math, "log2", "Math.log2");
            requireFunction(Math, "trunc", "Math.trunc");
            requireFunction(scope.Promise, "withResolvers", "Promise.withResolvers");
            requireFunction(scope.Uint8Array, "from", "Uint8Array.from");
            requireFunction(scope.Uint8Array, "fromBase64", "Uint8Array.fromBase64");
            requireFunction(scope.Uint8Array, "fromHex", "Uint8Array.fromHex");
            requireFunction(scope.Uint8Array && scope.Uint8Array.prototype, "slice", "Uint8Array.prototype.slice");
            requireFunction(scope.ArrayBuffer, "isView", "ArrayBuffer.isView");
            requireFunction(scope.performance, "now", "performance.now");
            compatibility.missing = missing;
            compatibility.ready = missing.length === 0;
            return compatibility;
        }
    };

    scope.OTT2Compat = compatibility;
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : this);
