const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");

function fixture(t, configuration = {}) {
    const dom = new JSDOM('<!doctype html><html><head><style>#f2-selected-info { overflow-y: auto; }</style></head><body><button id="channel">Channel</button><aside><div id="info" style="overflow-y:auto"></div></aside><div id="foss2-home"></div><div id="f2-toast"></div></body></html>', {
        runScripts: "outside-only", pretendToBeVisual: true
    });
    const window = dom.window, document = window.document;
    const context = dom.getInternalVMContext();
    const modules = configuration.view ? ["runtime.js", "keyboard.js", "auto-scroll.js", "view.js"] : ["runtime.js", "auto-scroll.js"];
    for (const name of modules) {
        const code = fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
        acorn.parse(code, { ecmaVersion: 5 });
        vm.runInContext(code, context, { filename: name });
    }
    let time = 0, nextTimer = 0, active = true;
    window.Date.now = () => time;
    const timers = new Map();
    const environment = {
        setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: time + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    function tick(milliseconds) {
        const until = time + milliseconds;
        while (true) {
            let selected;
            for (const entry of timers) {
                if (entry[1].at <= until && (!selected || entry[1].at < selected[1].at)) selected = entry;
            }
            if (!selected) break;
            time = selected[1].at; timers.delete(selected[0]); selected[1].callback();
        }
        time = until;
    }
    function layout(node, height = 100, contentHeight = 500) {
        Object.defineProperties(node, {
            clientHeight: { configurable: true, get() { return height; } },
            scrollHeight: { configurable: true, get() { return contentHeight; } }
        });
        return node;
    }
    const panel = layout(document.getElementById("info"), configuration.height || 100, configuration.contentHeight || 500);
    let controller = null, view = null;
    if (configuration.view) {
        for (const [name, value] of [["offsetWidth", 120], ["offsetHeight", 36], ["clientWidth", 500], ["clientHeight", 100]]) {
            Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get() { return value; } });
        }
        Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return this.id === "f2-selected-info" ? 800 : 100; } });
        const offsets = new WeakMap();
        Object.defineProperty(window.HTMLElement.prototype, "scrollTop", {
            configurable: true,
            // Match Chromium's CSSOM behavior: a detached old scrollport no
            // longer has a layout box and reports zero, unlike plain jsdom.
            get() { return document.documentElement.contains(this) ? offsets.get(this) || 0 : 0; },
            set(value) { offsets.set(this, Number(value) || 0); }
        });
        view = window.OTT2.require("view").create({ document, root: document.getElementById("foss2-home"), environment, onAction() {} });
    } else {
        controller = window.OTT2.require("auto-scroll").create({ document, environment, now: () => time, isActive: () => active });
        controller.update(panel, "channel:programme-a", true);
    }
    document.getElementById("channel").focus();
    t.after(() => { if (view) view.destroy(); if (controller) controller.destroy(); assert.equal(timers.size, 0); window.close(); });
    return { window, document, panel, controller, view, timers, tick, layout,
        setActive(value) { active = value; },
        emit(node, type) { node.dispatchEvent(new window.Event(type, { bubbles: true })); },
        hidden(value) { Object.defineProperty(document, "hidden", { configurable: true, value }); document.dispatchEvent(new window.Event("visibilitychange")); },
        jump(milliseconds) {
            time += milliseconds;
            const callbacks = Array.from(timers.values()); timers.clear();
            callbacks.forEach(item => item.callback());
        }
    };
}

test("EPG waits for reading, then scrolls slowly without moving channel focus", t => {
    const f = fixture(t);
    f.tick(3000);
    assert.equal(f.panel.scrollTop, 0);
    f.tick(1000);
    assert(f.panel.scrollTop >= 12 && f.panel.scrollTop <= 14, "Approximately 14 CSS pixels per second");
    f.tick(1000);
    assert(f.panel.scrollTop >= 26 && f.panel.scrollTop <= 28);
    assert.equal(f.document.activeElement.id, "channel");
    assert.equal(f.timers.size, 1);
});

test("bottom pauses before returning to the top and giving another reading pause", t => {
    const f = fixture(t, { contentHeight: 128 });
    f.tick(5200);
    assert.equal(f.panel.scrollTop, 28);
    f.tick(3800);
    assert.equal(f.panel.scrollTop, 28);
    f.tick(200);
    assert.equal(f.panel.scrollTop, 0);
    f.tick(2800);
    assert.equal(f.panel.scrollTop, 0);
    f.tick(1200);
    assert(f.panel.scrollTop > 0 && f.panel.scrollTop < 20);
});

test("same programme rerenders retain position and timing with one timer", t => {
    const f = fixture(t);
    f.tick(5000);
    const before = f.panel.scrollTop;
    for (let i = 0; i < 30; i++) f.controller.update(f.panel, "channel:programme-a", true);
    const replacement = f.layout(f.document.createElement("div"));
    replacement.style.overflowY = "auto";
    f.panel.parentNode.replaceChild(replacement, f.panel);
    f.controller.update(replacement, "channel:programme-a", true);
    assert.equal(replacement.scrollTop, before);
    assert.equal(f.timers.size, 1);
    f.tick(1000);
    assert(replacement.scrollTop >= before + 13, "A routine refresh must not restart the reading deadline");
    f.controller.update(replacement, "channel:programme-b", true);
    assert.equal(replacement.scrollTop, 0);
    f.tick(3000);
    assert.equal(replacement.scrollTop, 0, "New programme starts with a full reading pause");
});

test("hidden, non-overflowing and portrait flow panels never scroll the page", t => {
    const f = fixture(t, { contentHeight: 100 });
    f.tick(8000);
    assert.equal(f.panel.scrollTop, 0);
    f.layout(f.panel, 100, 500);
    f.panel.style.overflowY = "visible";
    f.tick(8000);
    assert.equal(f.panel.scrollTop, 0);
    f.panel.style.overflowY = "auto";
    f.panel.parentNode.style.display = "none";
    f.tick(8000);
    assert.equal(f.panel.scrollTop, 0);
    f.panel.parentNode.style.display = "block";
    f.tick(5000);
    assert(f.panel.scrollTop > 0);
    assert.equal(f.document.documentElement.scrollTop, 0);
    assert.equal(f.document.body.scrollTop, 0);
});

test("removing and restoring the same panel preserves position and pauses for reading", t => {
    const f = fixture(t);
    f.tick(5000);
    const before = f.panel.scrollTop;
    f.controller.update(null, "channel:programme-a", true);
    assert.equal(f.timers.size, 0);
    f.tick(30000);
    f.controller.update(f.panel, "channel:programme-a", true);
    f.tick(3000);
    assert.equal(f.panel.scrollTop, before);
    f.tick(1000);
    assert(f.panel.scrollTop > before && f.panel.scrollTop < before + 16);
});

test("modal and hidden home pause scrolling and resume after reading time", t => {
    const f = fixture(t);
    f.tick(5000);
    const before = f.panel.scrollTop;
    f.setActive(false); f.tick(10000);
    assert.equal(f.panel.scrollTop, before);
    f.setActive(true); f.tick(3000);
    assert.equal(f.panel.scrollTop, before);
    f.tick(1500);
    assert(f.panel.scrollTop > before && f.panel.scrollTop < before + 25);
    f.controller.setEnabled(false);
    const disabled = f.panel.scrollTop;
    assert.equal(f.timers.size, 0);
    f.tick(10000);
    assert.equal(f.panel.scrollTop, disabled);
    f.controller.setEnabled(true); f.tick(3000);
    assert.equal(f.panel.scrollTop, disabled);
});

test("document visibility cancels timers and never jumps after a long suspension", t => {
    const f = fixture(t);
    f.tick(5000);
    const before = f.panel.scrollTop;
    f.hidden(true);
    assert.equal(f.timers.size, 0);
    f.tick(600000);
    assert.equal(f.panel.scrollTop, before);
    f.hidden(false); f.tick(3000);
    assert.equal(f.panel.scrollTop, before);
    f.tick(1000);
    const resumed = f.panel.scrollTop;
    assert(resumed > before && resumed < before + 16);
    f.jump(600000);
    assert(f.panel.scrollTop - resumed <= 4, "A delayed callback must not skip unread text");
});

test("manual wheel and external scrolling pause without competing for the pointer", t => {
    const f = fixture(t);
    f.tick(5000);
    f.emit(f.panel, "wheel");
    f.panel.scrollTop = 120; f.emit(f.panel, "scroll");
    f.tick(7900);
    assert.equal(f.panel.scrollTop, 120);
    f.tick(1100);
    assert(f.panel.scrollTop >= 132 && f.panel.scrollTop <= 136);
    const before = f.panel.scrollTop;
    f.emit(f.panel, "scroll");
    f.tick(1000);
    assert(f.panel.scrollTop >= before + 13, "The controller's own scroll events do not pause it");
});

test("held touch or mouse selection pauses until release, then leaves time to read", t => {
    const f = fixture(t);
    f.tick(5000);
    f.emit(f.panel, "mousedown");
    const before = f.panel.scrollTop;
    f.tick(20000);
    assert.equal(f.panel.scrollTop, before);
    f.emit(f.document, "mouseup"); f.tick(7900);
    assert.equal(f.panel.scrollTop, before);
    f.tick(1500);
    assert(f.panel.scrollTop > before);
    f.emit(f.panel, "touchstart");
    const touch = f.panel.scrollTop;
    f.tick(20000);
    assert.equal(f.panel.scrollTop, touch);
    f.emit(f.document, "touchcancel"); f.tick(9000);
    assert(f.panel.scrollTop > touch);
});

test("destroy detaches listeners and makes future updates inert", t => {
    const f = fixture(t);
    f.tick(5000);
    const before = f.panel.scrollTop;
    f.controller.destroy(); f.controller.destroy();
    f.emit(f.panel, "wheel"); f.emit(f.panel, "mousedown");
    f.hidden(true); f.hidden(false);
    f.controller.update(f.panel, "new", true); f.controller.setEnabled(true);
    f.tick(10000);
    assert.equal(f.panel.scrollTop, before);
    assert.equal(f.timers.size, 0);
    assert.equal(f.document.activeElement.id, "channel");
});

function viewModel(programme = "Programme A") {
    const channel = { id: "a", name: "Channel A", kind: "live" };
    return { screen: "tv", homeVisible: true, device: { id: "pc", label: "PC" },
        settings: { language: "en", fontFamily: "system", fontScale: 1 }, sources: [], activeSourceId: "one", sourceName: "Fixture",
        channels: [channel], rows: [channel], nowById: { a: { title: programme, start: programme === "Programme A" ? 1 : 2,
            end: 99999999, description: "Long programme description. ".repeat(100) } },
        loading: false, query: "", group: "", page: 0, filteredTotal: 1, activeFavorites: "default" };
}

test("view clock rerenders preserve scrolling but changed programme resets the same channel", t => {
    const f = fixture(t, { view: true });
    f.view.render(viewModel()); f.tick(10000);
    const oldPanel = f.document.getElementById("f2-selected-info"), before = oldPanel.scrollTop;
    assert(before >= 90, "The original long programme has scrolled");
    f.view.render(viewModel());
    const replacement = f.document.getElementById("f2-selected-info");
    assert.equal(replacement, oldPanel, "Periodic guide updates preserve the existing scrollport");
    assert.equal(replacement.scrollTop, before, "Clock rendering must preserve the reading position");
    assert.equal(f.timers.size, 1);
    f.tick(1000);
    assert(replacement.scrollTop >= before + 13, "Same programme continues at the existing pace");
    f.view.render(viewModel("Programme B"));
    assert.equal(f.document.getElementById("f2-selected-info"), oldPanel, "Programme transitions update content without replacing its scrollport");
    assert.equal(f.document.getElementById("f2-selected-info").scrollTop, 0);
    f.tick(3000);
    assert.equal(f.document.getElementById("f2-selected-info").scrollTop, 0, "A new programme gets a complete reading pause");
    assert.equal(f.document.activeElement.id, "channel-0");
});

test("Info focus survives view rerenders and keeps automatic scrolling paused", t => {
    const f = fixture(t, { view: true });
    f.view.render(viewModel()); f.tick(10000);
    f.view.focus("channel-details");
    const infoButton = f.document.activeElement;
    const before = f.document.getElementById("f2-selected-info").scrollTop;
    assert.equal(f.timers.size, 0);
    f.view.render(viewModel());
    assert.equal(f.document.activeElement.id, "channel-details", "Info is not a numbered channel row");
    assert.equal(f.document.activeElement, infoButton, "A guide refresh does not replace the focused Info button");
    f.tick(10000);
    assert.equal(f.document.getElementById("f2-selected-info").scrollTop, before);
    assert.equal(f.timers.size, 0);
    f.view.focus("channel-0"); f.tick(3000);
    assert.equal(f.document.getElementById("f2-selected-info").scrollTop, before);
    f.tick(1000);
    assert(f.document.getElementById("f2-selected-info").scrollTop > before);
    assert.equal(f.document.activeElement.id, "channel-0");
});
