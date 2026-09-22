// Parse raw script text using the same HTML rules as a browser.
const { parse } = require("parse5");

function inlineScripts(html) {
    const scripts = [];
    function visit(node) {
        if (node.tagName === "script") {
            const attrs = node.attrs || [];
            const type = attrs.find((attr) => attr.name === "type");
            const src = attrs.find((attr) => attr.name === "src");
            if (!src && (!type || /^(?:application|text)\/(?:java|ecma)script$/i.test(type.value) || type.value === "" || type.value === "module")) {
                scripts.push((node.childNodes || []).map((child) => child.value || "").join(""));
            }
            return;
        }
        for (const child of node.childNodes || []) visit(child);
        if (node.content) visit(node.content);
    }
    visit(parse(html));
    return scripts;
}

module.exports = { inlineScripts };
