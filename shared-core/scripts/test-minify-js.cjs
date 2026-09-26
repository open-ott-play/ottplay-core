"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { minifyJavaScript, privateFunctionNames } = require("./minify-js.cjs");

const fixture = `(function (root, factory) {
    if (typeof define === 'function' && define.amd) define(['exports'], factory);
    else if (typeof module === 'object' && module.exports) factory(module.exports);
    else factory(root.OttPlayCore = {});
}(this, function (exports) {
    function IllegalArgumentException(message) {
        this.name = Object.getPrototypeOf(this).constructor.name;
        this.message = message;
    }
    function publicCallback(first, second, unused) { return this.value + first; }
    function omitted(value) { value = 1; return arguments[0]; }
    function deleted(value) { delete arguments[0]; value = 2; return arguments[0]; }
    function inspect(record) { record.current; return record.current; }
    exports.IllegalArgumentException = IllegalArgumentException;
    exports.publicCallback = publicCallback;
    exports.omitted = omitted;
    exports.deleted = deleted;
    exports.inspect = inspect;
    exports.payload = function () { return { enabled: true, disabled: false, label: 'Кино' }; };
    exports.invoke = function (value) { return exports.publicCallback.call({value: 2}, value); };
}));`;

function load(source, mode) {
    const context = vm.createContext({});
    let exported;
    if (mode === "commonjs") {
        context.module = { exports: {} };
        context.exports = context.module.exports;
    }
    if (mode === "amd") {
        context.define = (dependencies, factory) => {
            assert.deepEqual(Array.from(dependencies), ["exports"]);
            factory(exported = {});
        };
        context.define.amd = {};
    }
    vm.runInContext(source, context);
    return mode === "amd" ? exported : mode === "commonjs" ? context.module.exports : context.OttPlayCore;
}

function publicSurface(core) {
    function callable(value) { return { name: value.name, length: value.length }; }
    return Object.keys(core).sort().map(name => {
        const value = core[name];
        if (typeof value !== "function") return { exportName: name, type: typeof value };
        const prototype = value.prototype && Object.getOwnPropertyNames(value.prototype).sort().map(key => {
            const descriptor = Object.getOwnPropertyDescriptor(value.prototype, key);
            return { key, enumerable: descriptor.enumerable, configurable: descriptor.configurable,
                writable: descriptor.writable, type: typeof descriptor.value,
                value: typeof descriptor.value === "function" ? callable(descriptor.value) : undefined,
                get: descriptor.get && callable(descriptor.get), set: descriptor.set && callable(descriptor.set) };
        });
        return { exportName: name, type: "function", ...callable(value), prototype };
    });
}

async function main() {
    const optimized = await minifyJavaScript(fixture);
    assert.equal(await minifyJavaScript(fixture), optimized, "Distribution is reproducible");
    await assert.rejects(minifyJavaScript("const modern = () => 1;"), SyntaxError);
    for (const mode of ["browser", "commonjs", "amd"]) {
        assert.deepEqual(Object.keys(load(optimized, mode)), Object.keys(load(fixture, mode)));
        for (const source of [fixture, optimized]) {
            const core = load(source, mode);
            const error = new core.IllegalArgumentException("invalid");
            assert.equal(error.name, "IllegalArgumentException");
            assert.equal(error.message, "invalid");
            assert.equal(core.publicCallback.name, "publicCallback");
            assert.equal(core.publicCallback.length, 3);
            assert.equal(core.invoke(4), 6);
            core.publicCallback = function (value) { return value * 2; };
            assert.equal(core.invoke(4), 8, "Replaced exports remain live");
            assert.equal(core.omitted(), undefined);
            assert.equal(core.deleted(3), undefined);
            let reads = 0;
            assert.equal(core.inspect({ get current() { return ++reads; } }), 2);
            assert.deepEqual(JSON.parse(JSON.stringify(core.payload())), { enabled: true, disabled: false, label: "Кино" });
        }
    }
    const privateFixture = `(function (exports) {
        function recursivePrivateHelper(value) { return value > 0 ? recursivePrivateHelper(value - 1) + 1 : 0; }
        function registeredCallback(first, second, unused) { return this.value + first; }
        function RegisteredConstructor() { this.name = this.constructor.name; }
        var metadata = { callback: registeredCallback, constructor: RegisteredConstructor };
        exports.run = function (value) { return recursivePrivateHelper(value); };
        exports.callback = function () { return metadata.callback; };
        exports.instance = function () { return new metadata.constructor(); };
    }(this.OttPlayCore = {}));`;
    const ast = source => parse(source, { ecmaVersion: 5, sourceType: "script" });
    assert.deepEqual(privateFunctionNames(ast(privateFixture)), ["recursivePrivateHelper"]);
    const compactPrivate = await minifyJavaScript(privateFixture);
    assert(!compactPrivate.includes("recursivePrivateHelper"), "Non-escaping recursive helper names are compacted");
    for (const source of [privateFixture, compactPrivate]) {
        const core = load(source, "browser");
        assert.equal(core.run(12), 12);
        assert.equal(core.callback().name, "registeredCallback");
        assert.equal(core.callback().length, 3);
        assert.equal(core.callback().call({ value: 4 }, 3), 7);
        assert.equal(core.instance().name, "RegisteredConstructor");
    }
    const shadowed = `(function (exports) {
        function repeatedHelper(value) { return value + 1; }
        exports.run = function (value) { return repeatedHelper(value); };
        exports.inspect = function () {
            function repeatedHelper(first, unused) { return first; }
            return [repeatedHelper.name, repeatedHelper.length];
        };
    }(this.OttPlayCore = {}));`;
    assert(!privateFunctionNames(ast(shadowed)).includes("repeatedHelper"), "Name matching cannot distinguish shadowed bindings");
    const shadowedCore = load(await minifyJavaScript(shadowed), "browser");
    assert.equal(shadowedCore.run(3), 4);
    assert.deepEqual(Array.from(shadowedCore.inspect()), ["repeatedHelper", 2]);
    for (const reflect of [
        'eval("returnValue = reflectedHelper.name")',
        'returnValue = arguments["cal" + "lee"].name',
        'returnValue = arguments.callee.name',
        'returnValue = reflectedHelper.caller',
        'returnValue = Function("return 1")()'
    ]) {
        const reflected = `(function (exports) {
            function reflectedHelper(value) { var returnValue; ${reflect}; return value; }
            exports.run = function (value) { return reflectedHelper(value); };
        }(this.OttPlayCore = {}));`;
        assert.deepEqual(privateFunctionNames(ast(reflected)), [], "Dynamic reflection keeps original names: " + reflect);
        const compact = await minifyJavaScript(reflected);
        assert(compact.includes("reflectedHelper"));
        assert.equal(load(compact, "browser").run(9), 9);
    }
    if (process.argv.includes("--compiled")) {
        const root = path.resolve(__dirname, "..");
        const compiler = fs.readFileSync(path.join(root, "build/compileSync/js/main/productionExecutable/kotlin/OttPlayCore.js"), "utf8");
        const distributed = fs.readFileSync(path.join(root, "dist/ottplay-core.js"), "utf8");
        const original = load(compiler, "commonjs"), packed = load(distributed, "commonjs");
        assert(Object.keys(original).length > 0, "Compiler exports must be observable in the test host");
        assert.deepEqual(publicSurface(packed), publicSurface(original), "Compiled public exports and prototypes survive distribution");
        console.log("PASS compiled core public ABI: " + Object.keys(packed).length + " exports");
    }
    console.log("PASS core minifier: ES5, deterministic output, browser/CommonJS/AMD, exception names, callback ABI, live exports, private names and reflection");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
