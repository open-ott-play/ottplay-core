const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");

const dom = new JSDOM('<!doctype html><body><div id="foss2-home"></div><div id="f2-toast"></div><button id="outside">Outside</button></body>', { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const d = w.document;
const context = dom.getInternalVMContext();
for (const name of ["runtime", "keyboard", "auto-scroll", "view"]) {
    const code = fs.readFileSync(path.join(__dirname, "../src/" + name + ".js"), "utf8");
    acorn.parse(code, { ecmaVersion: 5 });
    vm.runInContext(code, context, { filename: name + ".js" });
}
// Only layout is synthetic; clicks, focus, selection ranges and DOM event
// dispatch use jsdom. Real TV key delivery and geometry need device testing.
Object.defineProperty(w.HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.type === "hidden" || this.hidden || this.style.display === "none" ? 0 : 80; } });
Object.defineProperty(w.HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.type === "hidden" || this.hidden || this.style.display === "none" ? 0 : 40; } });
w.HTMLElement.prototype.getBoundingClientRect = function () {
    const row = this.parentNode;
    let left = 0;
    let top = 0;
    if (row && row.className === "f2-kb-row") {
        left = Array.from(row.children).indexOf(this) * 90;
        top = Array.from(row.parentNode.querySelectorAll(".f2-kb-row")).indexOf(row) * 50 + 100;
    } else {
        const all = Array.from(d.querySelectorAll("button,input,textarea,select"));
        const index = all.indexOf(this);
        left = index % 3 * 100;
        top = Math.floor(index / 3) * 50 + 700;
    }
    return { left, top, right: left + 80, bottom: top + 40, width: 80, height: 40 };
};
const actions = [];
const view = w.OTT2.require("view").create({ document: d, root: d.getElementById("foss2-home"), environment: { setTimeout: w.setTimeout.bind(w), clearTimeout: w.clearTimeout.bind(w) }, onAction(name, value) { actions.push([name, value]); } });
view.render({ screen: "tv", homeVisible: true, settings: { language: "en" }, device: { id: "pc", label: "Browser" }, channels: [], rows: [], sources: [], nowById: {}, guideRows: [], filteredTotal: 0, page: 0 });
view.focus("nav-settings");
view.dialog("Editor", view.field("name", "Name", "abCD") + view.field("url", "Source URL", "https://video.test/", "url") + view.field("password", "Password", "private-password", "password") + view.field("search", "Search", "ab", "search") +
    '<label class="f2-field"><span>M3U text</span><textarea id="playlist">line</textarea></label><textarea id="readonly" readonly>Export</textarea><input id="hidden" type="hidden"><input id="file" type="file"><input id="check" type="checkbox"><input id="disabled" disabled><input id="concealed" hidden>');
let modal = d.getElementById("f2-dialog");
assert.equal(modal.querySelectorAll('[data-action="keyboardOpen"]').length, 5, "Only supported editable fields have an on-screen keyboard");
for (const id of ["readonly", "hidden", "file", "check", "disabled", "concealed"]) {
    assert.notEqual(d.getElementById(id).parentNode.className, "f2-edit-control", id + " is not decorated");
}
function opener(field) { return field.parentNode.querySelector('[data-action="keyboardOpen"]'); }
function panel() { return d.querySelector(".f2-keyboard-layer"); }
function key(value) { return Array.from(panel().querySelectorAll('[data-action="keyboardKey"]')).find((node) => node.getAttribute("data-value") === value); }
function command(value) { return Array.from(panel().querySelectorAll('[data-action="keyboardCommand"]')).find((node) => node.getAttribute("data-value") === value); }
function enter(value) {
    const node = key(value);
    assert(node, "Keyboard contains " + value);
    view.focus(node.id);
    assert.equal(view.command("ok", { key: "Enter" }), true);
}
const name = d.getElementById("name");
const trigger = opener(name);
name.setSelectionRange(1, 3);
let inputEvents = 0;
name.addEventListener("input", () => { inputEvents++; });
trigger.click();
assert(panel());
assert(modal.contains(panel()), "The keyboard belongs to the existing modal focus trap");
assert(panel().contains(d.activeElement));
assert.equal(d.querySelectorAll('[role="dialog"]').length, 1, "Opening the keyboard does not create a competing dialog");
const first = key("1");
view.focus(first.id);
view.command("right", { key: "ArrowRight" });
assert.equal(d.activeElement, key("2"), "Arrow navigation reaches the neighboring key");
enter("x");
assert.equal(name.value, "axD", "Typing replaces the selected range");
assert.equal(name.selectionStart, 2);
assert.equal(inputEvents, 1);
command("cursorLeft").click();
enter("/");
assert.equal(name.value, "a/xD");
command("cursorRight").click();
command("erase").click();
assert.equal(name.value, "a/D");
assert.equal(actions.length, 0, "Keyboard actions never reach the player/app dispatcher");
d.getElementById("dialog-close").click();
assert(panel() && view.hasDialog(), "Background modal actions cannot execute through the keyboard");
d.getElementById("outside").focus();
assert(panel().contains(d.activeElement), "Programmatic focus cannot escape the keyboard");
for (let i = 0; i < 120; i++) {
    view.command(null, { key: "Tab", shiftKey: i % 2 === 1 });
    assert(panel().contains(d.activeElement), "Tab is confined to keyboard controls");
}
assert.equal(view.command("back", {}), true);
assert.equal(panel(), null);
assert.equal(view.hasDialog(), true, "First Back closes only the keyboard");
assert.equal(d.activeElement, trigger, "Back restores the triggering keyboard button");
assert.equal(name.value, "a/D", "Closing the keyboard retains edits");

name.value = "abc😀d";
name.focus();
name.setSelectionRange(5, 5);
assert.equal(view.command("ok", { key: "Enter" }), true, "Remote OK on the text field opens its keyboard");
command("erase").click();
assert.equal(name.value, "abcd", "Backspace does not split a UTF-16 surrogate pair");
command("clear").click();
assert.equal(name.value, "");
enter("a");
command("layout").click();
enter("я");
command("shift").click();
enter("Ё");
enter("7");
enter(":");
command("space").click();
assert.equal(name.value, "aяЁ7: ");
command("done").click();
assert.equal(panel(), null);
assert.equal(d.activeElement, trigger);

const password = d.getElementById("password");
password.setSelectionRange(password.value.length, password.value.length);
opener(password).click();
assert(!panel().textContent.includes("private-password"), "Password preview is masked");
enter("q");
assert.equal(password.value, "private-passwordq");
assert(!panel().textContent.includes("private-password"));
view.command("back", {});
const url = d.getElementById("url");
Object.defineProperty(url, "selectionStart", { configurable: true, get() { throw new Error("Native selection API unavailable"); } });
url.setSelectionRange = () => { throw new Error("Native selection API unavailable"); };
opener(url).click();
enter("x");
assert.equal(url.value, "https://video.test/x", "URL fields remain usable when selection APIs are unsupported");
view.command("back", {});
const textarea = d.getElementById("playlist");
textarea.setSelectionRange(4, 4);
opener(textarea).click();
command("newline").click();
enter("<"); enter("a"); enter(">");
assert.equal(textarea.value, "line\n<a>");
assert.equal(panel().querySelector("a"), null, "Typed markup remains text in the preview");
view.command("back", {});
const search = d.getElementById("search");
search.maxLength = 3;
search.setSelectionRange(2, 2);
opener(search).click();
enter("x"); enter("q");
assert.equal(search.value, "abx", "The keyboard obeys maxlength");
view.command("back", {});
assert.equal(view.command("back", {}), true);
assert.equal(view.hasDialog(), false, "Second Back closes the parent dialog");
assert.equal(d.activeElement.id, "menu-toggle", "Closing the dialog restores a visible control when the sidebar is collapsed");

view.dialog("Replacement", view.field("next", "Next", ""));
opener(d.getElementById("next")).click();
view.dialog("New dialog", view.field("new", "New", ""));
assert.equal(panel(), null, "Replacing the modal disposes the previous keyboard");
modal = d.getElementById("f2-dialog");
assert.equal(modal.querySelectorAll('[data-action="keyboardOpen"]').length, 1);
opener(d.getElementById("new")).click();
view.destroy(); view.destroy();
assert.equal(panel(), null);
assert.equal(d.getElementById("f2-dialog"), null);
d.getElementById("outside").focus();
assert.equal(d.activeElement.id, "outside", "Destroy removes both modal and keyboard focus ownership");
assert.equal(actions.length, 0);
dom.window.close();
console.log("PASS: ES5 remote keyboard selection, Cyrillic/Latin/URL input, masking, focus ownership, Back and disposal");
