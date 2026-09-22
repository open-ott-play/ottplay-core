/* Workers have separate globals: bootstrap them before evaluating Hls.js. */
importScripts("/src/compat.js", "/vendor/core-js.min.js", "/src/compat-ready.js");
if (!self.OTT2Compat || !self.OTT2Compat.ready || !self.OTT2Compat.nativeBinary) {
    throw new Error("HLS worker compatibility bootstrap failed");
}
importScripts("/vendor/hls.worker.js");
