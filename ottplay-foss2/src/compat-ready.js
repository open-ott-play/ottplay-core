/* Finalize platform aliases after the shared ECMAScript polyfills. */
(function (host) {
    "use strict";
    if (host.OTT2Compat) { host.OTT2Compat.install(); }
})(typeof window !== "undefined" ? window : self);
