const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");

const dom = new JSDOM('<!doctype html><html><body><div id="foss2-home"></div><div id="f2-toast"></div><button id="outside">Outside</button></body></html>', {
    url: "http://127.0.0.1:4198/", runScripts: "outside-only", pretendToBeVisual: true
});
const window = dom.window;
const document = window.document;
const context = dom.getInternalVMContext();
for (const name of ["runtime.js", "keyboard.js", "auto-scroll.js", "view.js"]) {
    const file = path.join(__dirname, "../src", name);
    if (!fs.existsSync(file) && name === "keyboard.js") continue;
    const code = fs.readFileSync(file, "utf8");
    acorn.parse(code, { ecmaVersion: 5 });
    vm.runInContext(code, context, { filename: name });
}
// jsdom has no layout engine. Deterministic rectangles enable focus behavior
// assertions; this is not a screenshot/real television geometry test.
Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.type === "hidden" || this.style.display === "none" ? 0 : 120; } });
Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.type === "hidden" || this.style.display === "none" ? 0 : 36; } });
window.HTMLElement.prototype.getBoundingClientRect = function () {
    const items = Array.from(document.querySelectorAll("button,input,textarea,select"));
    const index = Math.max(0, items.indexOf(this));
    const left = index % 3 * 140;
    const top = Math.floor(index / 3) * 48;
    return { x: left, y: top, left, top, right: left + 120, bottom: top + 36, width: 120, height: 36 };
};
let nextTimer = 0;
const timers = new Map();
const environment = { document,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
};
const actions = [];
let onActionHook = null;
const root = document.getElementById("foss2-home");
const view = window.OTT2.require("view").create({ document, root, environment,
    onAction(name, value, fields) { actions.push({ name, value, fields }); if (onActionHook) onActionHook(name, value, fields); }
});
const unsafe = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const channelId = 'id" data-action="unsafe-action';
function model(screen) {
    const channel = { id: channelId, name: unsafe, kind: "live" };
    return { screen: screen || "tv", homeVisible: true, device: { id: "pc", label: unsafe },
        settings: { language: "en", fontFamily: "system", fontScale: 1 },
        sources: [{ id: "source", type: "m3u", name: unsafe }], activeSourceId: "source", sourceName: unsafe,
        channels: [channel], rows: [channel], nowById: { [channelId]: { title: unsafe, start: 1, end: 9999999999 } },
        guideRows: [{ channel, programme: { title: unsafe, start: 1, end: 2 } }],
        loading: false, query: unsafe, group: unsafe, page: 0, filteredTotal: 1, activeFavorites: "default" };
}

for (const screen of ["tv", "sources", "guide", "favorites"]) {
    view.render(model(screen));
    assert(root.textContent.includes(unsafe), "Untrusted " + screen + " labels remain literal text");
    assert.equal(root.querySelector("script,img,[onerror]"), null, "No executable metadata nodes on " + screen);
    assert.equal(window.__xss, undefined);
    if (screen === "tv") assert.equal(document.activeElement.id, "channel-0", "The first view render focuses a channel");
}
// EPG logos take priority over playlist logos without exposing metadata as HTML
// or requiring CORS-enabled images. A failed download keeps the compact slot.
const logoModel = model("tv");
logoModel.rows[0].logo = "https://images.example.test/playlist.png";
logoModel.logosById = { [channelId]: 'https://images.example.test/epg.png?label="x"&value=<icon>' };
logoModel.epgStatus = unsafe;
view.render(logoModel);
let logoImage = root.querySelector("#channel-0 .f2-channel-logo img");
assert.equal(logoImage.getAttribute("src"), logoModel.logosById[channelId]);
assert.equal(logoImage.alt, "", "Logos do not duplicate the channel's accessible name");
assert.equal(logoImage.getAttribute("onerror"), null, "No inline image handlers from metadata");
assert.equal(root.querySelector("[onerror],script,icon"), null);
assert.equal(root.querySelector("#f2-epg-status").textContent, unsafe, "EPG status is plain text");
assert.equal(root.querySelector("#f2-epg-status").getAttribute("role"), "status");
logoImage.dispatchEvent(new window.Event("error"));
assert.equal(logoImage.style.visibility, "hidden", "Failed image is hidden without a broken-image glyph");
assert(root.querySelector("#channel-0 .f2-channel-logo"), "Failed logo preserves the name column alignment");
assert.equal(logoImage.onerror, null, "Image error handler is released after failure");
logoModel.screen = "guide";
view.render(logoModel);
assert.equal(root.querySelector("#guide-0 .f2-channel-logo img").getAttribute("src"), logoModel.logosById[channelId]);
assert.equal(root.querySelector("#f2-epg-status").textContent, unsafe);
logoModel.screen = "tv";
for (const value of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "//images.example.test/relative.png", "https://\ninvalid.test/logo.png", "https://"]) {
    logoModel.logosById[channelId] = value;
    view.render(logoModel);
    assert.equal(root.querySelector("#channel-0 img").getAttribute("src"), logoModel.rows[0].logo, "Invalid EPG URL falls back to the safe playlist icon");
    logoModel.rows[0].logo = value;
    view.render(logoModel);
    assert.equal(root.querySelector("#channel-0 img"), null, "Unsafe icon URLs are not requested");
    logoModel.rows[0].logo = "https://images.example.test/playlist.png";
}
logoModel.epgStatus = "";
view.render(logoModel);
assert.equal(root.querySelector("#f2-epg-status"), null, "An empty status occupies no TV row space");
// Channel browsing keeps selection independent from playback and pages by row.
let listModel = model("tv");
const listChannels = Array.from({ length: 29 }, (_, index) => ({ id: "list-" + index, name: "Channel " + (index + 1), kind: "live" }));
listModel.channels = listChannels; listModel.rows = listChannels.slice(0, 12); listModel.filteredTotal = 29; listModel.pageSize = 12;
listModel.nowById = { "list-0": { title: unsafe, description: unsafe, start: 1, end: 9999999999 }, "list-1": { title: "News", start: 2, end: 9999999999 } };
listModel.nextById = { "list-0": { title: unsafe, start: 2, end: 3 } };
listModel.currentChannel = listChannels[0];
listModel.selectedChannelId = listChannels[0].id;
onActionHook = function (name, value, fields) {
    if (name === "channelPage") {
        listModel.page = Number(value); listModel.rows = listChannels.slice(listModel.page * 12, (listModel.page + 1) * 12);
        listModel.selectedChannelId = listModel.rows[Math.min(fields.rowIndex, listModel.rows.length - 1)].id;
        view.render(listModel);
    }
};
view.render(listModel);
assert.equal(root.querySelectorAll(".f2-channel").length, 12);
assert.equal(document.activeElement.id, "channel-0", "The channel list initially owns remote focus");
assert.equal(root.querySelector("#f2-selected-channel").textContent, "Channel 1");
assert.equal(root.querySelector("#f2-selected-programme").textContent, unsafe);
assert.equal(root.querySelector("#f2-selected-description").textContent, unsafe, "EPG descriptions are plain text");
assert(root.querySelector("#f2-selected-next").textContent.includes(unsafe));
assert.equal(root.querySelector("script,img,[onerror]"), null);
assert(root.querySelector("#channel-0").classList.contains("f2-playing"), "Playing channel marker is independent of cursor focus");
assert(root.querySelector("#f2-now-playing").textContent.includes("Channel 1"));
const previewNode = root.querySelector("#f2-preview-slot");
const selectedRowNode = root.querySelector("#channel-0");
const actionsBeforeCursor = actions.length;
view.command("down", {});
assert.equal(view.selectedChannelId(), "list-1");
assert.equal(root.querySelector("#f2-selected-programme").textContent, "News");
assert.equal(root.querySelector("#f2-selected-description").textContent, "No description available.");
assert.equal(actions.length, actionsBeforeCursor, "Moving the cursor cannot invoke playback or application actions");
assert.equal(root.querySelector("#f2-preview-slot"), previewNode, "Moving the cursor preserves the preview node");
assert.equal(root.querySelector("#channel-0"), selectedRowNode, "Moving the cursor does not rebuild the list");
assert(root.querySelector("#channel-0").classList.contains("f2-playing"));
assert(!root.querySelector("#channel-1").classList.contains("f2-playing"));
view.command("down", {});
assert.equal(root.querySelector("#f2-selected-programme").textContent, "No programme information");
assert(root.querySelector("#f2-selected-next").textContent.includes("No next programme information"));
assert(view.previewRect().width > 0, "Preview geometry is available to the single video surface owner");
view.command("info", {});
assert.equal(actions.at(-1).name, "channel", "Info opens the full selected programme dialog");
assert.equal(actions.at(-1).value, "list-2");
const normalPreviewRect = previewNode.getBoundingClientRect;
Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 720 });
previewNode.getBoundingClientRect = function () { return { top: -1, bottom: 35, left: 0, right: 120 }; };
assert.equal(view.previewRect(), null, "A preview clipped by a scrolled viewport cannot cover navigation");
previewNode.getBoundingClientRect = normalPreviewRect;
view.focusChannel("list-9");
view.command("right", {});
assert.equal(listModel.page, 1); assert.equal(document.activeElement.id, "channel-9");
assert.equal(view.selectedChannelId(), "list-21", "Right pages while retaining the row");
view.command("right", {});
assert.equal(listModel.page, 2); assert.equal(document.activeElement.id, "channel-4");
assert.equal(view.selectedChannelId(), "list-28", "A short final page clamps to its last row");
const atLastPage = actions.length;
view.command("right", {});
assert.equal(actions.length, atLastPage, "Right at the final page does not wrap or activate a control");
assert.equal(document.activeElement.id, "channel-4");
view.command("down", {});
assert.equal(listModel.page, 0); assert.equal(view.selectedChannelId(), "list-0", "Down from the last channel wraps to the first channel");
view.command("up", {});
assert.equal(listModel.page, 2); assert.equal(view.selectedChannelId(), "list-28", "Up from the first channel wraps to the last channel on the short final page");
assert.equal(document.activeElement.id, "channel-4");
view.command("left", {});
assert.equal(listModel.page, 1); assert.equal(document.activeElement.id, "channel-4");
view.command("left", {});
assert.equal(listModel.page, 0); assert.equal(document.activeElement.id, "channel-4");
view.command("left", {}); assert.equal(document.activeElement.id, "channel-4", "Left at the first page keeps the channel cursor");
view.focusChannel("list-11"); view.command("down", {});
assert.equal(listModel.page, 1); assert.equal(document.activeElement.id, "channel-0");
assert.equal(document.querySelector("#channel-0 .f2-channel-number").textContent, "13", "Page numbering follows the model page size");
view.command("up", {});
assert.equal(listModel.page, 0); assert.equal(document.activeElement.id, "channel-11");
assert.equal(document.getElementById("f2-sidebar").style.display, "none", "Sections are collapsed by default");
assert.equal(document.getElementById("menu-toggle").getAttribute("aria-expanded"), "false");
view.command("menu", {}); assert.equal(document.activeElement.id, "nav-tv", "Menu opens and focuses sections");
assert.equal(document.getElementById("f2-sidebar").style.display, "block");
assert.equal(document.getElementById("menu-toggle").getAttribute("aria-expanded"), "true");
view.command("menu", {});
assert.equal(document.activeElement.id, "channel-11", "Repeated Menu closes sections and restores the row");
view.command("menu", {});
const beforeMenuBack = actions.filter(action => action.name === "back").length;
view.command("back", {});
assert.equal(actions.filter(action => action.name === "back").length, beforeMenuBack, "Back closes sections before returning to playback");
assert.equal(document.activeElement.id, "channel-11");
document.getElementById("menu-toggle").focus(); document.getElementById("menu-toggle").click();
assert.equal(document.activeElement.id, "nav-tv", "The visible Menu button opens sections");
document.getElementById("menu-toggle").click();
assert.equal(document.activeElement.id, "channel-11", "The visible Menu button restores the selected channel");
view.command("menu", {});
view.command("right", {}); assert.equal(document.activeElement.id, "channel-11", "Right restores the selected channel from sections");
assert.equal(document.getElementById("f2-sidebar").style.display, "none", "Leaving sections with Right hides them");
view.command("channelDown", {}); assert.equal(listModel.page, 1); assert.equal(document.activeElement.id, "channel-11");
view.command("channelUp", {}); assert.equal(listModel.page, 0); assert.equal(document.activeElement.id, "channel-11");
view.focusChannel("list-0"); view.command("up", {});
assert.equal(listModel.page, 2); assert.equal(view.selectedChannelId(), "list-28", "Up wraps across the complete channel collection");
view.command("down", {});
assert.equal(listModel.page, 0); assert.equal(view.selectedChannelId(), "list-0");
view.command("menu", {}); view.command("up", {});
assert.equal(document.activeElement.id, "menu-toggle", "Menu then Up keeps header controls reachable by remote");
assert.equal(document.getElementById("f2-sidebar").style.display, "none");
view.focus("nav-tv"); assert.equal(document.activeElement.id, "menu-toggle", "Hidden sections cannot receive remote focus");
view.focusChannel("list-2");
listModel.selectedChannelId = view.selectedChannelId(); listModel.settings.language = "ru";
view.render(listModel);
assert.equal(document.activeElement.id, "channel-2", "A guide refresh retains the channel cursor");
assert.equal(root.querySelector("#f2-selected-programme").textContent, "Нет информации о программе");
view.dialog("Pending guide", view.field("guide-entry", "Entry", "Unsubmitted"));
listModel.nowById["list-2"] = { title: "Updated programme", description: "Updated description", start: 1, end: 9999999999 };
view.render(listModel);
assert.equal(document.activeElement.id, "guide-entry", "EPG updates cannot take focus from an open editor");
assert.equal(document.getElementById("guide-entry").value, "Unsubmitted");
assert.equal(root.querySelector("#f2-selected-programme").textContent, "Updated programme");
view.closeDialog();
assert.equal(document.activeElement.id, "channel-2", "Closing an editor restores the selected channel");
listModel.homeVisible = false; view.render(listModel);
assert.equal(view.previewRect(), null, "Fullscreen playback has no browse preview rectangle");
listModel.homeVisible = true; listModel.selectedChannelId = "list-5"; view.render(listModel);
assert.equal(document.activeElement.id, "channel-5", "Returning from playback restores the requested channel");
listModel.screen = "favorites"; view.render(listModel);
assert.equal(document.activeElement.id, "channel-5", "Favorites uses the same channel cursor");
assert(root.querySelector("#f2-channel-detail"));
root.querySelector("#resume-playback").click();
assert.equal(actions.at(-1).name, "resumePlayback");
listModel.screen = "vod"; view.render(listModel);
assert.equal(root.querySelector("#f2-channel-detail"), null, "VOD does not get the live television preview and EPG panel");
// The visible collection can be a filtered subset of a larger source catalog.
for (const screen of ["tv", "favorites"]) for (const count of [0, 1, 4, 12, 13, 24, 29]) {
    const collection = listChannels.slice(0, count).reverse();
    const wrapModel = model(screen);
    wrapModel.channels = listChannels; wrapModel.pageSize = 12; wrapModel.filteredTotal = count;
    wrapModel.rows = collection.slice(0, 12); wrapModel.selectedChannelId = count ? collection[0].id : "";
    wrapModel.query = "filtered"; wrapModel.group = "Filtered group";
    wrapModel.nowById = Object.fromEntries(collection.map(channel => [channel.id, { title: "Programme for " + channel.name, start: 1, end: 9999999999 }]));
    onActionHook = function (name, value, fields) {
        if (name !== "channelPage") return;
        wrapModel.page = Number(value);
        wrapModel.rows = collection.slice(wrapModel.page * 12, (wrapModel.page + 1) * 12);
        wrapModel.selectedChannelId = wrapModel.rows[Math.min(fields.rowIndex, wrapModel.rows.length - 1)].id;
        view.render(wrapModel);
    };
    view.render(wrapModel); view.focusChannel("", 0);
    const beforeWrap = actions.length;
    view.command("up", {});
    if (count) {
        assert.equal(wrapModel.page, Math.floor((count - 1) / 12), screen + ": Up reaches the final filtered page");
        assert.equal(view.selectedChannelId(), collection[count - 1].id, screen + ": Up reaches the final filtered channel");
        assert.equal(document.activeElement.id, "channel-" + ((count - 1) % 12));
        assert.equal(root.querySelector("#f2-selected-programme").textContent, "Programme for " + collection[count - 1].name, "Wrapping updates the selected EPG");
    }
    view.command("down", {});
    assert.equal(wrapModel.page, 0);
    if (count) {
        assert.equal(view.selectedChannelId(), collection[0].id, screen + ": Down returns to the first filtered channel");
        assert.equal(document.activeElement.id, "channel-0");
    }
    assert(actions.slice(beforeWrap).every(action => action.name === "channelPage"), "Wrapping only moves selection and never starts playback or opens controls");
    if (count <= 12) assert.equal(actions.length, beforeWrap, "Single-page and empty collections do not request another page");
}
onActionHook = null;
view.render(model("tv"));
document.getElementById("channel-0").click();
assert.equal(actions.at(-1).name, "play", "A live channel click starts playback directly");
assert.equal(actions.at(-1).value, channelId, "Escaping preserves the opaque channel ID");
view.focus("channel-0");
view.command("ok", {});
assert.equal(actions.at(-1).name, "play", "Remote OK starts the highlighted live channel directly");
assert.equal(actions.at(-1).value, channelId);
document.getElementById("channel-details").click();
assert.equal(actions.at(-1).name, "channel", "The visible Info button retains channel actions");
assert.equal(actions.at(-1).value, channelId);
for (const kind of ["vod", "folder"]) {
    const videoModel = model("vod"); videoModel.rows[0].kind = kind; view.render(videoModel);
    document.getElementById("channel-0").click();
    assert.equal(actions.at(-1).name, "channel", "VOD cards and folder navigation retain their contracts");
}
view.render(model("tv"));
view.toast(unsafe);
assert.equal(document.getElementById("f2-toast").textContent, unsafe);
assert.equal(document.getElementById("f2-toast").querySelector("img,script"), null);
assert.equal(timers.size, 1);

view.focus("nav-sources");
const prior = document.activeElement.id;
view.dialog(unsafe, view.field("entry", unsafe, '" autofocus onfocus="window.__xss=3') +
    view.btn("confirm-entry", "confirm", view.escape(unsafe)));
assert.equal(document.querySelector("#f2-dialog-title").textContent, unsafe);
assert.equal(document.activeElement.id, "entry", "A dialog starts at its first control so long forms do not open scrolled to Close");
assert.equal(document.querySelector("#f2-dialog input").getAttribute("onfocus"), null);
assert.equal(document.getElementById("entry").value, '" autofocus onfocus="window.__xss=3');
assert.equal(document.querySelector("#f2-dialog script,#f2-dialog img"), null);
const actionCount = actions.length;
document.getElementById("channel-0").click();
assert.equal(actions.length, actionCount, "Background clicks cannot invoke player actions under a modal");
document.getElementById("outside").focus();
assert(document.getElementById("f2-dialog").contains(document.activeElement), "Modal traps programmatic focus");
document.getElementById("entry").focus();
for (const command of ["play", "pause", "playPause", "stop", "channelUp", "channelDown", "volumeUp", "volumeDown", "mute", "menu", "guide", "info"]) {
    assert.equal(view.command(command, {}), true, "Text entry consumes control key " + command);
    assert.equal(actions.length, actionCount, "Text editing cannot trigger " + command);
}
assert.equal(view.command("left", { key: "ArrowLeft" }), false, "Native editor owns cursor movement");
assert.equal(view.command("digit1", { key: "1" }), false, "Native editor owns printable text");
for (let i = 0; i < 15; i += 1) {
    assert.equal(view.command("tab", { shiftKey: i % 2 === 1 }), true);
    assert(document.getElementById("f2-dialog").contains(document.activeElement), "Tab cannot leave the modal");
}
view.focus("entry");
document.getElementById("entry").value = "Edited text";
document.getElementById("confirm-entry").click();
assert.equal(actions.at(-1).name, "confirm");
assert.equal(actions.at(-1).fields.entry, "Edited text");
assert.equal(view.command("back", {}), true);
assert.equal(view.hasDialog(), false);
assert.equal(document.activeElement.id, prior, "Closing restores the actual pre-modal focus");

// Periodic EPG refreshes keep live DOM surfaces, focus and independent scroll
// positions while updating changed content safely on the existing page.
const normalNow = window.Date.now;
window.Date.now = () => 1000 * 1000;
const refreshModel = model("tv");
refreshModel.query = refreshModel.group = "";
refreshModel.channels = refreshModel.rows = [{ id: "refresh-a", name: "A", kind: "live" }, { id: "refresh-b", name: "B", kind: "live" }];
refreshModel.filteredTotal = 2;
refreshModel.currentChannel = refreshModel.channels[0];
refreshModel.nowById = { "refresh-a": { title: "Current A", start: 900, end: 1100 }, "refresh-b": { title: "Current B", start: 900, end: 1100, description: "Original description" } };
refreshModel.nextById = { "refresh-a": { title: "Next A", start: 1100, end: 1200 } };
refreshModel.logosById = { "refresh-a": "https://images.test/a.png" };
refreshModel.epgStatus = "EPG: ready";
view.render(refreshModel); view.focusChannel("refresh-b");
const stable = {
    row: document.getElementById("channel-1"), first: document.getElementById("channel-0"),
    programme: root.querySelector("#channel-0 .f2-program-title"), progress: root.querySelector("#channel-0 .f2-progress span"),
    logo: root.querySelector("#channel-0 img"), preview: document.getElementById("f2-preview-slot"),
    info: document.getElementById("f2-selected-info"), infoButton: document.getElementById("channel-details"),
    main: root.querySelector(".f2-main"), heading: document.getElementById("f2-heading-tools")
};
stable.main.scrollTop = 27; stable.heading.scrollLeft = 48; stable.info.scrollTop = 65;
let repeatedFocus = 0;
stable.row.addEventListener("focus", () => repeatedFocus++);
for (let tick = 1; tick <= 20; tick++) {
    window.Date.now = () => (1000 + tick) * 1000;
    view.render(JSON.parse(JSON.stringify(refreshModel)));
}
assert.equal(document.getElementById("channel-1"), stable.row, "Repeated same-page guide updates keep row nodes");
assert.equal(document.getElementById("f2-preview-slot"), stable.preview, "Guide refresh keeps the video preview anchor");
assert.equal(document.getElementById("f2-selected-info"), stable.info);
assert.equal(document.getElementById("channel-details"), stable.infoButton);
assert.equal(root.querySelector("#channel-0 .f2-program-title"), stable.programme, "Progress-only ticks do not replace programme text");
assert.equal(root.querySelector("#channel-0 .f2-progress span"), stable.progress);
assert.equal(stable.progress.style.width, "60%", "Progress still advances on the retained node");
assert.equal(root.querySelector("#channel-0 img"), stable.logo, "Unchanged logos are not reloaded");
assert.equal(document.activeElement, stable.row);
assert.equal(repeatedFocus, 0, "A background guide refresh does not dispatch another focus event");
assert.equal(stable.main.scrollTop, 27); assert.equal(stable.heading.scrollLeft, 48); assert.equal(stable.info.scrollTop, 65);
refreshModel.nowById["refresh-a"] = { title: unsafe, start: 1010, end: 1110 };
refreshModel.nextById["refresh-a"] = { title: unsafe, start: 1110, end: 1200 };
refreshModel.logosById["refresh-a"] = "https://images.test/new.png";
view.render(refreshModel);
assert.equal(document.getElementById("channel-0"), stable.first, "Programme transitions retain their channel button");
assert.equal(root.querySelector("#channel-0 .f2-program-title").textContent, unsafe);
assert(root.querySelector("#channel-0 .f2-next").textContent.includes(unsafe));
assert.equal(root.querySelector("#channel-0 img").getAttribute("src"), "https://images.test/new.png");
assert.equal(stable.info.scrollTop, 65, "Another channel's programme transition preserves the selected description position");
view.focus("channel-details");
refreshModel.nowById["refresh-b"].description = unsafe;
view.render(refreshModel);
assert.equal(document.activeElement, stable.infoButton, "Changed EPG keeps the focused remote Info control");
assert.equal(document.getElementById("f2-selected-description").textContent, unsafe);
assert.equal(stable.info.scrollTop, 0, "A changed description starts at its beginning");
assert.equal(root.querySelector("script,[onerror]"), null);
delete refreshModel.nowById["refresh-a"]; delete refreshModel.nextById["refresh-a"];
refreshModel.logosById["refresh-a"] = "javascript:alert(1)"; refreshModel.epgStatus = "";
view.render(refreshModel);
assert.equal(root.querySelector("#channel-0 .f2-progress"), null, "A guide gap removes expired progress");
assert.equal(root.querySelector("#channel-0 .f2-program-title").textContent, "Live broadcast");
assert.equal(root.querySelector("#channel-0 img"), null); assert.equal(document.getElementById("f2-epg-status"), null);
refreshModel.epgStatus = unsafe; view.render(refreshModel);
assert.equal(document.getElementById("f2-epg-status").textContent, unsafe, "EPG status can be restored without rebuilding the header");
view.setMenuOpen(true);
const menuFocus = document.activeElement;
view.render(refreshModel);
assert.equal(document.activeElement, menuFocus, "Refresh retains remote focus inside the open sidebar");
assert.equal(document.getElementById("f2-sidebar").style.display, "block");
view.setMenuOpen(false);
refreshModel.rows.reverse(); view.render(refreshModel);
assert.notEqual(document.getElementById("channel-0"), stable.first, "An in-place collection reorder takes the structural render path");
assert.equal(document.getElementById("channel-0").getAttribute("data-value"), "refresh-b");
window.Date.now = normalNow;

const playbackModel = model("tv");
playbackModel.homeVisible = false;
view.render(playbackModel);
assert.equal(view.command("play", {}), false, "Playback receives commands only outside home and modal");
view.dialog("Paused editor", view.field("second-entry", "Entry", ""));
document.getElementById("second-entry").focus();
assert.equal(view.command("stop", {}), true, "An editor over playback still owns control keys");
view.toast("Pending timer");
assert.equal(timers.size, 1, "Toast replacement cancels the earlier timer");
view.destroy(); view.destroy();
assert.equal(timers.size, 0, "Dispose clears pending UI timers");
assert.equal(document.getElementById("f2-dialog"), null, "Dispose removes the modal");
const afterDispose = actions.length;
document.getElementById("channel-0").click();
assert.equal(actions.length, afterDispose, "Dispose removes root click dispatch");
document.getElementById("outside").focus();
assert.equal(document.activeElement.id, "outside", "Dispose removes document focus trapping");
dom.window.close();
console.log("PASS: ES5 view plain-text metadata, opaque IDs, modal/edit focus ownership, action isolation and disposal");
