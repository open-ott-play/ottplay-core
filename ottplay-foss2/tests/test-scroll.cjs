/* Wheel behavior is exercised through DOM events; browser tests cover real layout. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const scripts = ["runtime.js", "keyboard.js", "auto-scroll.js", "view.js"].map(name => ({ name, code: fs.readFileSync(path.join(__dirname, "../src", name), "utf8") }));

function harness(t, options = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="foss2-home"></div><div id="f2-toast"></div></body></html>', { url: "http://127.0.0.1:4198/", runScripts: "outside-only", pretendToBeVisual: true });
    const window = dom.window, document = window.document, root = document.getElementById("foss2-home");
    for (const script of scripts) vm.runInContext(script.code, dom.getInternalVMContext(), { filename: script.name });
    // jsdom has no layout. Only dimensions needed by focus and overflow are supplied.
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.type === "hidden" || this.style.display === "none" ? 0 : 120; } });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.type === "hidden" || this.style.display === "none" ? 0 : 36; } });
    window.HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 120, bottom: 36, width: 120, height: 36 }; };
    let clock = 1000, destroyed = false;
    window.Date.now = () => clock;
    const channels = Array.from({ length: options.count || 50 }, (_, index) => ({ id: "wheel-" + index, name: "Channel " + (index + 1), kind: options.screen === "vod" ? "vod" : "live" }));
    const programmes = Array.from({ length: 90 }, (_, index) => ({ channel: channels[index % channels.length], programme: { title: "Programme " + (index + 1), description: "Guide description", start: 1, end: 9999999999 } }));
    const model = { screen: options.screen || "tv", homeVisible: true, device: { id: "pc", label: "Desktop" }, settings: { language: "en", fontFamily: "system", fontScale: 1 }, sources: [], sourceName: "Fixture", channels, rows: channels.slice(0, 12), nowById: {}, nextById: {}, guideRows: programmes.slice(0, 30), guideTotal: programmes.length, guidePage: 0, page: 0, pageSize: 12, filteredTotal: channels.length, loading: false, query: "", group: "", activeFavorites: "default", selectedChannelId: channels[2].id };
    channels.forEach((channel, index) => { model.nowById[channel.id] = { title: "Current programme " + (index + 1), description: "Full description", start: 1, end: 9999999999 }; });
    const actions = [];
    const environment = { document, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) };
    const view = window.OTT2.require("view").create({ document, root, environment, onAction(name, value, fields) {
        actions.push({ name, value, fields });
        if (name === "channelPage" || name === "page") {
            model.page = Number(value); model.rows = channels.slice(model.page * 12, (model.page + 1) * 12);
            model.selectedChannelId = model.rows[Math.min(fields && fields.rowIndex || 0, model.rows.length - 1)].id;
            view.render(model);
        } else if (name === "guidePage") {
            model.guidePage = Number(value); model.guideRows = programmes.slice(model.guidePage * 30, (model.guidePage + 1) * 30); view.render(model);
        }
    } });
    view.render(model);
    function destroy() { if (!destroyed) { view.destroy(); destroyed = true; } }
    t.after(() => { destroy(); window.close(); });
    function wheel(selector, data = {}, elapsed = 200) {
        clock += elapsed;
        const node = typeof selector === "string" ? document.querySelector(selector) : selector;
        assert.ok(node, "Wheel target exists");
        const type = data.type || "wheel";
        const event = new window.Event(type, { bubbles: true, cancelable: true });
        for (const key of Object.keys(data)) if (key !== "type") Object.defineProperty(event, key, { value: data[key] });
        node.dispatchEvent(event);
        return event;
    }
    function scrollable(selector, { top = 0, height = 100, total = 500, left = 0, width = 100, horizontalTotal = 100 } = {}) {
        const node = typeof selector === "string" ? document.querySelector(selector) : selector;
        node.style.overflowY = "auto"; node.style.overflowX = "auto";
        Object.defineProperties(node, { clientHeight: { configurable: true, value: height }, scrollHeight: { configurable: true, value: total }, clientWidth: { configurable: true, value: width }, scrollWidth: { configurable: true, value: horizontalTotal } });
        node.scrollTop = top; node.scrollLeft = left;
        return node;
    }
    return { window, document, root, view, model, actions, wheel, scrollable, destroy };
}

test("fine trackpad deltas accumulate without paging below threshold and enforce a short cooldown", t => {
    const h = harness(t);
    assert.equal(h.view.selectedChannelId(), "wheel-2");
    assert.equal(h.wheel("#channel-5", { deltaY: 20 }, 0).defaultPrevented, true);
    h.wheel("#channel-5", { deltaY: 20 }, 20);
    assert.equal(h.model.page, 0, "Two small deltas do not accidentally turn a page");
    h.wheel("#channel-5", { deltaY: 20 }, 20);
    assert.equal(h.model.page, 1, "A 60-pixel trackpad gesture turns one page");
    assert.equal(h.view.selectedChannelId(), "wheel-14");
    assert.equal(h.document.activeElement.id, "channel-2");
    assert.equal(h.document.getElementById("f2-selected-programme").textContent, "Current programme 15");
    h.wheel("#channel-5", { deltaY: 120 }, 139);
    assert.equal(h.model.page, 1, "Repeated wheel events cannot page faster than the cooldown");
    h.wheel("#channel-5", { deltaY: 1 }, 1);
    assert.equal(h.model.page, 2, "A new event after the cooldown releases accumulated movement");
    assert.ok(h.actions.every(action => action.name === "channelPage"), "Wheel navigation never requests playback");
});

test("trackpad accumulation resets after a pause and on direction changes", t => {
    const h = harness(t);
    h.wheel("#channel-5", { deltaY: 40 }, 0);
    h.wheel("#channel-5", { deltaY: 20 }, 251);
    assert.equal(h.model.page, 0, "Separate gestures do not combine stale small deltas");
    h.wheel("#channel-5", { deltaY: -20 }, 20);
    h.wheel("#channel-5", { deltaY: 40 }, 20);
    assert.equal(h.model.page, 0, "Reversing direction clears the previous accumulator");
    h.wheel("#channel-5", { deltaY: 20 }, 20);
    assert.equal(h.model.page, 1);
});

test("Ctrl and Meta wheel gestures remain available for browser zoom", t => {
    const h = harness(t);
    const panel = h.scrollable("#f2-selected-info");
    for (const modifier of ["ctrlKey", "metaKey"]) {
        const event = h.wheel("#channel-5", { deltaY: 120, [modifier]: true });
        assert.equal(event.defaultPrevented, false, modifier + " is not captured by the app");
        assert.equal(h.wheel(panel, { deltaY: 120, [modifier]: true }).defaultPrevented, false);
    }
    assert.equal(panel.scrollTop, 0);
    assert.equal(h.model.page, 0);
    assert.deepEqual(h.actions, []);
    h.wheel("#channel-5", { deltaY: 60 });
    assert.equal(h.model.page, 1, "Modifier gestures leave no paging accumulation behind");
});

test("modern and legacy events from one wheel notch are deduplicated", t => {
    const h = harness(t);
    const first = h.wheel("#channel-5", { deltaY: 40 }, 0);
    const duplicate = h.wheel("#channel-5", { type: "mousewheel", wheelDelta: -40 }, 1);
    assert.equal(first.defaultPrevented, true);
    assert.equal(duplicate.defaultPrevented, true, "A cancelled modern event cannot scroll again through its legacy duplicate");
    assert.equal(h.model.page, 0, "A duplicated subthreshold delta cannot turn a page");
    h.wheel("#channel-5", { deltaY: 20 }, 20);
    assert.equal(h.model.page, 1);
    h.wheel("#channel-5", { type: "DOMMouseScroll", detail: 3 }, 200);
    assert.equal(h.model.page, 2, "A later standalone Gecko wheel gesture remains supported");
    h.wheel("#channel-5", { type: "mousewheel", wheelDelta: 120 }, 200);
    assert.equal(h.model.page, 1, "Old WebKit wheel direction is normalized");
});

test("pixel, line, page, horizontal and Shift wheel gestures page and clamp channel rows", t => {
    const h = harness(t, { count: 29 });
    h.wheel("#channel-5", { deltaY: -120 });
    assert.equal(h.model.page, 0, "The first page does not wrap");
    h.wheel("#channel-5", { deltaY: 3, deltaMode: 1 });
    assert.equal(h.model.page, 1, "Line-mode input is normalized");
    h.view.focusChannel("wheel-21");
    h.wheel("#channel-5", { deltaY: 1, deltaMode: 2 });
    assert.equal(h.model.page, 2);
    assert.equal(h.view.selectedChannelId(), "wheel-28", "The final shorter page clamps the cursor");
    h.wheel("#channel-4", { deltaX: 120 });
    assert.equal(h.model.page, 2, "The last page does not wrap");
    h.wheel("#channel-4", { deltaX: -120 });
    assert.equal(h.model.page, 1);
    h.wheel("#channel-4", { deltaY: -120, shiftKey: true });
    assert.equal(h.model.page, 0, "Shift wheel provides horizontal paging");
    assert.ok(h.actions.every(action => action.name === "channelPage"));
});

test("native overflow is scrolled before paging and legacy duplicates cannot scroll twice", t => {
    const h = harness(t);
    const main = h.scrollable(".f2-main", { total: 300 });
    h.wheel("#channel-5", { deltaY: 120 }, 0);
    assert.equal(main.scrollTop, 120);
    h.wheel("#channel-5", { type: "mousewheel", wheelDelta: -120 }, 1);
    assert.equal(main.scrollTop, 120, "A legacy duplicate is not applied to a native scroll port twice");
    h.wheel("#channel-5", { deltaY: 120 }, 200);
    assert.equal(main.scrollTop, 200, "One event consumes the remaining native overflow");
    assert.equal(h.model.page, 0, "Reaching the boundary does not skip the remainder of the current page");
    h.wheel("#channel-5", { deltaY: 120 }, 200);
    assert.equal(h.model.page, 1, "A separate gesture at the boundary advances the page");
    assert.deepEqual(h.actions.map(action => action.name), ["menuLayout", "menuLayout", "channelPage"]);
});

test("legacy horizontal wheel preserves an explicit zero vertical delta", t => {
    const h = harness(t);
    const info = h.scrollable("#f2-selected-info", { height: 100, total: 500, width: 100, horizontalTotal: 500 });
    h.wheel(info, { type: "mousewheel", wheelDeltaX: -120, wheelDeltaY: 0, wheelDelta: -120 });
    assert.equal(info.scrollLeft, 120, "The legacy horizontal delta scrolls the horizontal overflow");
    assert.equal(info.scrollTop, 0, "A zero vertical delta must not fall back to the combined wheel delta");
    assert.equal(h.model.page, 0);
    assert.deepEqual(h.actions.map(action => action.name), ["menuLayout"]);
});

test("selected EPG and sidebar scroll independently and consume wheel at their boundaries", t => {
    const h = harness(t);
    for (const selector of ["#f2-selected-info", "#f2-sidebar"]) {
        if (selector === "#f2-sidebar") h.view.setMenuOpen(true);
        const node = h.scrollable(selector, { total: 200 });
        h.wheel(node, { deltaY: 120 });
        assert.equal(node.scrollTop, 100);
        assert.equal(h.wheel(node, { deltaY: 120 }).defaultPrevented, true, "The isolated scroll port consumes the boundary gesture");
        assert.equal(h.model.page, 0);
        assert.equal(h.view.selectedChannelId(), "wheel-2");
    }
    assert.ok(h.actions.every(action => action.name === "menuLayout"));
});

test("portrait EPG and sidebar scroll the outer page without turning channel pages at its boundary", t => {
    const h = harness(t);
    h.view.setMenuOpen(true);
    h.actions.length = 0;
    const root = h.scrollable(h.root, { height: 400, total: 1600 });
    const info = h.document.getElementById("f2-selected-info");
    const detail = h.document.getElementById("f2-channel-detail");
    const sidebar = h.document.getElementById("f2-sidebar");
    // Portrait layout puts these regions in normal document flow. Only the
    // outer page owns their vertical overflow; the EPG text is not clipped.
    info.style.height = "auto"; info.style.overflow = "visible";
    detail.style.position = "relative";
    sidebar.style.position = "relative"; sidebar.style.overflowY = "auto";
    for (const target of [info.querySelector("#f2-selected-description"), detail, sidebar.querySelector("#nav-settings")]) {
        root.scrollTop = 0;
        h.wheel(target, { deltaY: 120 });
        assert.equal(root.scrollTop, 120, target.id + ": the outer portrait page consumes available movement");
        root.scrollTop = 1200;
        assert.equal(h.wheel(target, { deltaY: 120 }).defaultPrevented, true, target.id + ": the page boundary consumes the gesture");
        assert.equal(root.scrollTop, 1200);
        assert.equal(h.model.page, 0, "Scrolling programme text or navigation must never paginate channels");
    }
    assert.equal(h.view.selectedChannelId(), "wheel-2");
    assert.ok(h.actions.every(action => action.name === "menuLayout"), "Portrait scrolling does not navigate or request playback");
});

test("modal and nested text fields isolate background paging and release wheel listeners on close", t => {
    const h = harness(t);
    h.view.dialog("Long form", '<textarea id="field">Long text</textarea><button id="confirm">Confirm</button>');
    const modal = h.scrollable("#f2-dialog", { total: 500 });
    const field = h.scrollable("#field", { total: 250 });
    h.wheel(field, { deltaY: 60 });
    assert.equal(field.scrollTop, 60);
    assert.equal(modal.scrollTop, 0, "The innermost field consumes available movement");
    h.wheel(modal, { deltaY: 1000 });
    assert.equal(modal.scrollTop, 400);
    h.wheel(modal, { deltaY: 120 });
    assert.equal(h.model.page, 0, "A modal boundary never changes the background list");
    assert.equal(h.wheel("#channel-5", { deltaY: 120 }).defaultPrevented, true, "Even explicitly dispatched background wheel is blocked by the modal");
    assert.equal(h.model.page, 0);
    h.view.closeDialog();
    const before = h.actions.length;
    assert.equal(h.wheel(modal, { deltaY: -120 }).defaultPrevented, false, "Detached dialogs no longer own wheel listeners");
    assert.equal(modal.scrollTop, 400);
    assert.equal(h.actions.length, before);
    h.wheel("#channel-5", { deltaY: 120 });
    assert.equal(h.model.page, 1, "Closing the modal restores normal list navigation");
});

test("destroy removes root and dialog wheel handlers; hidden home ignores wheel", t => {
    const h = harness(t);
    h.model.homeVisible = false; h.view.render(h.model);
    assert.equal(h.wheel("#channel-5", { deltaY: 120 }).defaultPrevented, false);
    assert.equal(h.model.page, 0);
    h.model.homeVisible = true; h.view.render(h.model);
    h.view.dialog("Dialog", '<button id="confirm">Confirm</button>');
    const modal = h.scrollable("#f2-dialog");
    const row = h.document.getElementById("channel-5");
    h.destroy();
    const before = h.actions.length;
    assert.equal(h.wheel(row, { deltaY: 120 }).defaultPrevented, false);
    assert.equal(h.wheel(modal, { deltaY: 120 }).defaultPrevented, false);
    assert.equal(modal.scrollTop, 0);
    assert.equal(h.model.page, 0);
    assert.equal(h.actions.length, before);
});
