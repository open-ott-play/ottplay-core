"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

function fixture(t) {
    const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://127.0.0.1:8092/", pretendToBeVisual: true });
    const window = dom.window, document = window.document;
    let now = 0, sequence = 0, language = "en";
    const timers = new Map();
    const environment = {
        setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    for (const name of ["runtime.js", "playback-info.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", name), "utf8"), dom.getInternalVMContext(), { filename: name });
    }
    const controller = window.OTT2.require("playback-info").create({ document, environment, timeout: 6000, t(ru, en) { return language === "ru" ? ru : en; } });
    function tick(delay) {
        now += delay;
        for (const [id, timer] of Array.from(timers)) {
            if (timer.at <= now) { timers.delete(id); timer.callback(); }
        }
    }
    t.after(() => { controller.destroy(); window.close(); });
    return { controller, window, document, timers, tick, node(id) { return document.getElementById(id); }, language(value) { language = value; } };
}

test("the information footer progresses from hidden to compact to expanded with a fresh six-second deadline", t => {
    const f = fixture(t), info = f.controller;
    assert.equal(info.isVisible(), false);
    assert.equal(f.node("player-info-hitarea").style.display, "none", "Browsing starts without a playback hit target");
    info.advance();
    assert.equal(info.isVisible(), false, "A disabled footer cannot be activated by a stale event");
    info.setEnabled(true);
    assert.equal(f.node("player-info-hitarea").style.display, "block");
    info.advance();
    assert.equal(info.isVisible(), true);
    assert.equal(info.isExpanded(), false);
    assert.equal(f.node("player-programme-details").style.display, "none");
    assert.equal(f.node("player-info-hitarea").style.display, "none");
    f.tick(5999);
    assert.equal(info.isVisible(), true);
    info.advance();
    assert.equal(info.isExpanded(), true);
    assert.equal(f.node("player-osd").getAttribute("data-expanded"), "true");
    assert.equal(f.node("player-programme-details").style.display, "block");
    f.tick(1);
    assert.equal(info.isVisible(), true, "The previous compact deadline was cancelled");
    f.tick(5998);
    info.advance();
    assert.equal(info.isExpanded(), true, "Further presses keep the description open");
    assert.equal(f.timers.size, 1, "Repeated activation does not leak timers");
    f.tick(6000);
    assert.equal(info.isVisible(), false, "The timeout does not depend on a playing media element");
    assert.equal(info.isExpanded(), false);
    assert.equal(f.node("player-info-hitarea").style.display, "block");
});

test("programme metadata remains literal text and keeps its complete expanded description", t => {
    const f = fixture(t), info = f.controller;
    const unsafe = '<img src=x onerror="window.injected=true">';
    const description = unsafe + "\n" + "A full programme paragraph. ".repeat(150);
    const start = new Date(2026, 8, 14, 17, 5).getTime() / 1000;
    info.update({ channel: { id: "a", name: unsafe }, programme: { start, end: start + 3600, title: unsafe, description }, next: { start: start + 3600, title: unsafe } });
    info.setEnabled(true); info.show(true);
    assert.equal(f.node("player-title").textContent, unsafe);
    assert.equal(f.node("player-programme-title").textContent, unsafe);
    assert.equal(f.node("player-description").textContent, description);
    assert.equal(f.node("player-programme-time").textContent, "17:05–18:05");
    assert.equal(f.node("player-next").textContent, "Next: 18:05 " + unsafe);
    assert.equal(f.node("player-osd").querySelector("img,script,[onerror]"), null);
    assert.equal(f.window.injected, undefined);
    info.update({ channel: { name: "No EPG" } });
    assert.equal(f.node("player-description").textContent, "No description available.");
    assert.equal(f.node("player-programme-title").textContent, "No programme information");
    assert.equal(f.node("player-programme-time").style.display, "none");
    assert.equal(f.node("player-next").style.display, "none", "Previous channel metadata does not remain visible");
    f.language("ru"); info.update({});
    assert.equal(f.node("player-info-hitarea").getAttribute("aria-label"), "Показать информацию о канале");
    assert.equal(f.node("player-programme-title").textContent, "Нет информации о программе");
});

test("the bottom mouse target opens compact information and footer background expands it without intercepting controls", t => {
    const f = fixture(t), info = f.controller;
    let pauseClicks = 0, stageClicks = 0;
    f.node("player-pause").addEventListener("click", () => pauseClicks++);
    f.node("player-stage").addEventListener("click", () => stageClicks++);
    info.setEnabled(true);
    f.node("player-info-hitarea").click();
    assert.equal(info.isVisible(), true);
    assert.equal(info.isExpanded(), false);
    assert.equal(stageClicks, 0, "Opening information does not activate video background navigation");
    f.node("player-pause").click();
    assert.equal(pauseClicks, 1);
    assert.equal(info.isExpanded(), false, "A playback button does not expand information");
    f.node("player-programme-title").click();
    assert.equal(info.isExpanded(), true);
    f.tick(5999);
    f.node("player-description").click();
    f.tick(1);
    assert.equal(info.isVisible(), true, "Description clicks refresh its reading time");
    f.tick(5999);
    assert.equal(info.isVisible(), false);
});

test("hiding or disabling the footer releases control focus and cancels pending timers", t => {
    const f = fixture(t), info = f.controller;
    info.setEnabled(true); info.show(false);
    f.node("player-pause").focus();
    assert.equal(f.document.activeElement.id, "player-pause");
    info.hide();
    assert.notEqual(f.document.activeElement.id, "player-pause");
    assert.equal(f.timers.size, 0);
    info.show(true); f.node("player-description").focus();
    info.setEnabled(false);
    assert.notEqual(f.document.activeElement.id, "player-description");
    assert.equal(f.node("player-info-hitarea").style.display, "none");
    assert.equal(f.node("player-osd").style.display, "none");
    assert.equal(f.timers.size, 0);
    info.setEnabled(true); info.show(false); info.destroy();
    f.node("player-info-hitarea").click(); f.node("player-osd").click();
    info.setEnabled(true); info.show(true);
    assert.equal(info.isVisible(), false, "Disposed handlers and callers cannot reopen the footer");
    assert.equal(f.timers.size, 0);
});

test("background EPG refresh preserves reading position without extending the timeout", t => {
    const f = fixture(t), info = f.controller;
    const current = { channel: { id: "channel", name: "Channel" }, programme: { start: 1, end: 2, title: "Programme", description: "Long description" } };
    info.update(current); info.setEnabled(true); info.show(true);
    f.node("player-description").scrollTop = 80;
    const descriptionText = f.node("player-description").firstChild;
    f.tick(3000); info.update(current);
    assert.equal(f.node("player-description").scrollTop, 80);
    assert.equal(f.node("player-description").firstChild, descriptionText, "Repeated media updates preserve text nodes and the user's selection");
    f.tick(3000);
    assert.equal(info.isVisible(), false, "A guide refresh does not postpone auto-hide");
    info.show(true); f.node("player-description").scrollTop = 80;
    info.update({ channel: { id: "other", name: "Other" }, programme: current.programme });
    assert.equal(f.node("player-description").scrollTop, 0, "Changing channels starts a new description at the top");
});
