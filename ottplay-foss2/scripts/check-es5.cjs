#!/usr/bin/env node
// Check the shipped application, including browser bootstrap and provider assets.
// Development-only Node scripts and tests are intentionally outside ES5 scope.
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const { inlineScripts } = require("./html-scripts.cjs");

const root = path.resolve(__dirname, "..");
const excluded = new Set(["node_modules", "scripts", "tests", "test-results", ".git"]);
const failures = [];
let checked = 0;
let htmlFiles = 0;

function check(code, label) {
    try {
        acorn.parse(code, { ecmaVersion: 5, sourceType: "script", allowHashBang: false });
        checked++;
    } catch (error) {
        failures.push(label + ": " + error.message);
    }
}

function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (excluded.has(entry.name)) continue;
        const file = path.join(directory, entry.name);
        const relative = path.relative(root, file);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && /\.js$/i.test(entry.name)) {
            check(fs.readFileSync(file, "utf8"), relative);
        } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
            htmlFiles++;
            let number = 0;
            for (const code of inlineScripts(fs.readFileSync(file, "utf8"))) {
                if (code.trim()) check(code, relative + " inline script " + ++number);
            }
        } else if (entry.isFile() && /\.(?:mjs|ts|tsx)$/i.test(entry.name)) {
            failures.push(relative + ": a non-ES5 source file is included in the runtime tree");
        }
    }
}

for (const file of ["index.html"]) {
    if (!fs.existsSync(path.join(root, file))) failures.push("Missing runtime file: " + file);
}
walk(root);
if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log("PASS: ES5 grammar for " + checked + " runtime scripts across " + htmlFiles + " HTML files; no build required");
