const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Match index.html's bootstrap even in tests whose window is a nested mock.
module.exports = function loadCore(context) {
    for (const file of ["core-js.min.js", "ottplay-core.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "../vendor", file), "utf8"), context, { filename: file });
    }
    if (context.window) context.window.OttPlayCore = context.OttPlayCore;
    return context.OttPlayCore;
};
