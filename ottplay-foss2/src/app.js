OTT2.define("app", function (require) {
    "use strict";
    function start(environment) {
        var d = environment.document, storage;
        try { storage = environment.localStorage; } catch (ignore) {}
        var repository = require("state").create(storage), saved = repository.snapshot();
        var devices = require("devices"), profile = devices.detect(environment);
        var request = require("transport").create(environment, { relay: function () { return saved.settings.relay; } }), providers = require("providers").create({ request: request, portalTransport: function () { return saved.settings.relay; } }), epg = require("epg");
        var guideLookup = epg.createLookup ? epg.createLookup({ limit: 4096 }) : null, decoratedCatalog = null, decoratedSource = null, overrideSignature = JSON.stringify(saved.channelOverrides), decoratedSignature = "";
        var channels = [], guide = null, sourceEpoch = 0, resolveEpoch = 0, cancelSource, cancelGuide, cancelResolve, sourceEpgUrls = [];
        var guideRefresh = new environment.OttPlayCore.BrowserGuideRefresh();
        var defaultEpgUrl = "https://cdn.epg.one/epg2.xml.gz", guideInfo = guideRefresh.snapshot().info;
        var identity = require("channel-identity"), identityReport = null, catalogSourceId = "";
        var guideFeeds = {}, hostSuspended = false;
        var television = ["pc", "pc2", "nodejs", "edem"].indexOf(profile.id) === -1;
        hostSuspended = television && !!(d.hidden || d.webkitHidden);
        var library = require("library"), browsing = false, browseItems = null, discovered = [], parentsById = {}, breadcrumbs = [], browseEpoch = 0, cancelBrowse, guidePage = 0, reminderTimer, notifiedReminders = {}, startupRestore = null, pinChallenge = null, pendingMigration = null;
        var current = null, currentReference = null, screen = "tv", group = "", query = "", page = 0, loading = false, homeVisible = true, pendingChannelFocus = "";
        var sleepTimer, pendingResume = 0, lastBookmark = 0, keyDigits = "", digitTimer;
        var quitRequested = false, autoplayBlocked = false, heldControls = {}, fullscreenState = false, fullscreenPending = false, fullscreenEpoch = 0, fullscreenExitRequested = false, nativeEscapePending = false, escapeTimer;
        var fullscreenEvents = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
        var destroyed = false, resolving = false, pendingPlayable = null, pendingPaused = false, loadingSourceId = "", fileReader = null;
        var downloadTimers = [], downloadUrls = [], previousKeydown = environment.onkeydown, previousKeyup = environment.onkeyup, previousBlur = environment.onblur;
        var root = d.getElementById("foss2-home"), video = d.getElementById("player-video"), guideRows = [], nowById = {}, nextById = {}, logosById = {};
        var view = require("view").create({ root: root, document: d, environment: environment, onAction: action, onDialogClose: function () {
            pinChallenge = null;
            if (quitRequested) { quitRequested = false; if (playbackInfo) playbackInfo.setEnabled(!destroyed && !homeVisible && !!current); }
            if (fileReader) { fileReader.onload = null; fileReader.onerror = null; try { fileReader.abort(); } catch (ignore) {} fileReader = null; }
        } });
        var playbackInfo = require("playback-info").create({ document: d, environment: environment, t: t, timeout: 6000, shouldAutoHide: function () { return !autoplayBlocked; } });
        var media = require("media").create({ video: video, environment: environment, onEvent: mediaEvent, options: { device: profile.id } });
        var playbackPreferences = require("playback-preferences").create({ media: media, persist: persist, state: function () { return saved; } });
        var playbackView = require("playback-view").create({ view: view, media: media, preferences: playbackPreferences, t: t, persist: persist, state: function () { return saved; }, changeEngine: changeEngine, changeFormat: changeFormat });
        var stopDevices = devices.init(environment, profile);
        var gate = require("security").create({ getState: function () { return saved; }, persist: function (dto) { persist(function (s) { s.security = dto; }); } });
        var features = require("features").create({ view: view, t: t, persist: persist, state: function () { return saved; }, channels: catalog, find: getChannel, render: render, gate: gate, onLock: function () { if (current && gate.isProtected(permissionId(current), "playback")) { stopPlayback(); showHome(); } } });
        function catalog(includeHidden) {
            if (decoratedSource !== channels || decoratedSignature !== overrideSignature || !decoratedCatalog) {
                decoratedSource = channels; decoratedSignature = overrideSignature;
                decoratedCatalog = library.decorate(channels, saved.channelOverrides, true);
            }
            return includeHidden ? decoratedCatalog.slice() : decoratedCatalog.filter(function (entry) { return !entry.hidden; });
        }
        function challenge(scope, id, proceed) {
            if (gate.authorize(scope, id).ok) { proceed(); return; }
            view.dialog(t("Требуется PIN", "PIN required"), view.field("access-pin", "PIN", "", "password") + view.btn("unlock", "unlock", t("Разблокировать", "Unlock")));
            pinChallenge = { scope: scope, id: id, proceed: proceed };
            view.focus("access-pin");
        }
        function actionScope(name, value) {
            if (["security", "configurePIN", "disablePIN", "protectChannel"].indexOf(name) >= 0) return "security";
            if (name === "screen") return value === "settings" ? "settings" : value === "sources" ? "source" : "";
            if (["addSource", "editSource", "saveSource", "loadSource", "deleteSource", "confirmDelete"].indexOf(name) >= 0) return "source";
            if (/Import/.test(name) || name === "import" || name === "legacyImport" || name === "applyMigration") return "import";
            if (["export", "makeExport", "download"].indexOf(name) >= 0) return "export";
            if (["settings", "preferences", "savePreferences", "selectEngine", "selectFormat", "security", "configurePIN", "disablePIN", "protectChannel", "font", "scale", "language", "saveEPG", "epgSource", "editChannel", "saveChannel", "resetChannel", "hiddenChannels", "unhideChannel", "editGroup", "saveGroup"].indexOf(name) >= 0) return "settings";
            return "";
        }
        function t(ru, en) { return saved.settings.language === "ru" ? ru : en; }
        function persist(change) {
            saved = repository.update(function (draft) {
                change(draft);
                if (catalogSourceId && draft.activeSourceId === catalogSourceId) identity.remember(draft, channels.concat(discovered), catalogSourceId);
            });
            overrideSignature = JSON.stringify(saved.channelOverrides);
            if (!repository.status().persistent) view.toast(t("Настройки доступны в этой сессии; сохранение недоступно.", "Settings are in memory; persistent storage is unavailable."));
        }
        function getChannel(id) { var all = library.decorate(channels.concat(discovered), saved.channelOverrides, true); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return savedItem(id); }
        function savedItem(id) { var item = saved.favoriteItems[id]; return item && item.sourceId === saved.activeSourceId ? { id: id, sourceId: item.sourceId, name: item.name, kind: "vod", group: "", restorePath: true } : null; }
        function favoriteCatalog() {
            var all = [], known = Object.create(null);
            channels.concat(discovered).forEach(function (entry) { if (!known[entry.id]) { known[entry.id] = true; all.push(entry); } });
            (saved.favorites[saved.activeFavorites] || []).forEach(function (id) { var item = savedItem(id); if (!known[id] && item) { known[id] = true; all.push(item); } });
            return library.decorate(all, saved.channelOverrides, false);
        }
        function programmeFor(channel, now) {
            if (guideLookup) return guideLookup.lookup(channel, guide, now);
            var entries = epg.matchChannel(channel, guide), result = epg.currentNext(entries, now);
            result.entries = entries; result.metadata = epg.matchMetadata ? epg.matchMetadata(channel, guide) : null;
            return result;
        }
        function permissionId(ch) {
            if (!ch) return "";
            var parents = parentsById[ch.id] || (saved.favoriteItems[ch.id] && saved.favoriteItems[ch.id].parents) || [], i;
            var reconciled = identity.permission(identityReport, ch.id, saved.security.protectedIds);
            if (gate.isProtected(reconciled, "playback")) return reconciled;
            for (i = 0; i < parents.length; i++) if (gate.isProtected(parents[i], "playback")) return parents[i];
            return ch.id;
        }
        function source(id) { for (var i = 0; i < saved.sources.length; i++) if (saved.sources[i].id === id) return saved.sources[i]; return null; }
        function rememberedReference(reference) {
            var result = {};
            Object.keys(reference).forEach(function (field) { result[field] = reference[field]; });
            if (!result.name) {
                for (var i = 0; i < saved.history.length; i++) {
                    if (saved.history[i].id === result.id) { result.name = saved.history[i].name; break; }
                }
            }
            return result;
        }
        function startupChannel() {
            if (!saved.settings.restore) return null;
            if (saved.lastChannel && source(saved.lastChannel.sourceId)) return rememberedReference(saved.lastChannel);
            // Older settings have history but no source-bound last-channel record.
            var last = saved.history[0], selected = saved.activeSourceId;
            if (!last) return null;
            for (var i = 0; i < saved.sources.length; i++) {
                var prefix;
                try { prefix = encodeURIComponent(saved.sources[i].id) + ":"; }
                catch (ignore) { continue; }
                if (last.id.indexOf(prefix) === 0) { selected = saved.sources[i].id; break; }
            }
            // History has no media kind and may outlive its source. Preserve its
            // exact-ID behavior without guessing a live channel from a VOD name.
            return source(selected) ? { sourceId: selected, id: last.id, exactOnly: true } : null;
        }
        function preferredEpgUrls() { return saved.settings.epgUrls.length ? saved.settings.epgUrls : saved.settings.epgUrl ? [saved.settings.epgUrl] : sourceEpgUrls.length ? sourceEpgUrls : [defaultEpgUrl]; }
        function epgError(code) {
            if (/^(?:RESPONSE_SIZE|RESPONSE_TOO_LARGE|EPG_TOO_LARGE|EPG_CHANNEL_LIMIT|EPG_REQUEST_TOO_LARGE|EPG_WIRE_TOO_LARGE|EPG_DECODED_TOO_LARGE|EPG_FIELD_TOO_LARGE)$/.test(code)) return t("источник слишком большой", "source is too large");
            if (/^(?:TIMEOUT|UPSTREAM_TIMEOUT|EPG_TIMEOUT)$/.test(code)) return t("превышено время ожидания", "request timed out");
            if (/^(?:XML_FORMAT|XML_DOCTYPE|XML_ENTITIES|INVALID_COMPRESSED_RESPONSE|EPG_XML|EPG_GZIP)$/.test(code)) return t("неверный формат XMLTV", "invalid XMLTV format");
            if (code === "EPG_BUSY") return t("источник занят, повторите обновление", "source is busy; refresh again");
            if (/^(?:RELAY_DISABLED|UPSTREAM_ORIGIN_NOT_ALLOWED|UPSTREAM_ADDRESS_NOT_ALLOWED)$/.test(code)) return t("источник не разрешён в relay", "source is not allowed by the relay");
            return t("ошибка сети, доступа или CORS", "network, access or CORS error");
        }
        function guideStatus(matched, currentCount) {
            if (!channels.length || loading) return "";
            if (guideInfo.phase === "loading") return t("EPG: загрузка… ", "EPG: loading… ") + guideInfo.done + "/" + guideInfo.total;
            if (guideInfo.phase === "error") return "EPG: " + epgError(guideInfo.errors[0]);
            if (!guide) return t("EPG: ожидание источника", "EPG: waiting for source");
            var label = matched ? "EPG: " + matched + t(" каналов", " channels") + " · " + currentCount + t(" сейчас", " on now") : t("EPG: нет совпадений с каналами плейлиста", "EPG: no matching playlist channels");
            if (matched && !currentCount) label += t(" · проверьте даты программы", " · check guide dates");
            if (guide.coverage && guide.coverage.limited) label += t(" · ближайшие передачи", " · nearby programmes only");
            if (guideInfo.errors.length) label += " · " + guideInfo.errors.length + t(" источников недоступно", " sources unavailable");
            return label;
        }
        function layout() {
            var width = environment.innerWidth || d.documentElement.clientWidth || 1280, height = environment.innerHeight || d.documentElement.clientHeight || 720;
            var portrait = width <= 700 && width <= height, compact = screen === "tv" || screen === "favorites", inset = 0;
            var textSize = (portrait ? 18 : Math.max(14, Math.min(width / 1280, height / 720) * 24)) * saved.settings.fontScale;
            // Read the actual home inset, including installed-app titlebar space.
            // Hidden home views still have computed styles, unlike clientHeight.
            try {
                var style = root.currentStyle || (environment.getComputedStyle && environment.getComputedStyle(root, null));
                if (style && /px$/.test(style.top)) inset = Math.max(0, parseFloat(style.top) || 0);
            } catch (ignore) {}
            var rowHeight = portrait ? 2.45 : compact ? 1 : 1.64;
            // TV chrome: main edges 1.38em and header 1.65em. Pagination is
            // inline, leaving only six padding pixels and the channel border.
            var chrome = portrait ? 7.7 : compact ? 3.03 : 9.1 + (screen === "vod" && breadcrumbs.length ? 2 : 0);
            var availableHeight = height - inset - (compact && !portrait ? 7 : 0);
            return { textSize: textSize, pageSize: Math.max(4, Math.floor((availableHeight / textSize - chrome) / rowHeight)) };
        }
        function buildModel() {
            var favorites = saved.favorites[saved.activeFavorites] || [], rows = [], search = query.toLowerCase(), i, all = screen === "favorites" ? favoriteCatalog() : screen === "vod" && browseItems ? library.decorate(browseItems, saved.channelOverrides, false) : catalog(false), guideAll = [], pageSize = layout().pageSize;
            var matched = 0, currentCount = 0, favoriteOrder = Object.create(null), nowSeconds = Date.now() / 1000;
            favorites.forEach(function (id, index) { favoriteOrder[id] = index; });
            nowById = {}; nextById = {}; logosById = {}; guideRows = [];
            for (i = 0; i < all.length; i++) {
                var ch = all[i];
                if (guide) {
                    var now = programmeFor(ch, nowSeconds), metadata = now.metadata, programmes = now.entries;
                    if (metadata && metadata.logo) logosById[ch.id] = metadata.logo;
                    if (programmes.length) matched++;
                    if (now.current) { nowById[ch.id] = now.current; currentCount++; }
                    if (now.next) nextById[ch.id] = now.next;
                    if (screen === "guide" && (!group || ch.group === group) && (!search || ch.name.toLowerCase().indexOf(search) >= 0)) for (var p = 0; p < programmes.length && guideAll.length < 50000; p++) {
                        if (programmes[p].end > Date.now() / 1000 - 7 * 86400) guideAll.push({ channel: ch, programme: programmes[p] });
                    }
                }
                if (screen === "favorites" && !Object.prototype.hasOwnProperty.call(favoriteOrder, ch.id)) continue;
                if (screen !== "favorites" && (screen === "vod" ? ch.kind !== "vod" && ch.kind !== "folder" : ch.kind === "vod" || ch.kind === "folder")) continue;
                if (group && ch.group !== group) continue;
                if (search && ch.name.toLowerCase().indexOf(search) === -1) continue;
                rows.push(ch);
            }
            if (screen === "favorites") rows.sort(function (a, b) { return favoriteOrder[a.id] - favoriteOrder[b.id]; });
            guideAll.sort(function (a, b) { return a.programme.start - b.programme.start; });
            guidePage = Math.max(0, Math.min(guidePage, Math.ceil(guideAll.length / 30) - 1));
            guideRows = guideAll.slice(guidePage * 30, guidePage * 30 + 30);
            page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1)));
            if (pendingChannelFocus) for (i = 0; i < rows.length; i++) if (rows[i].id === pendingChannelFocus) { page = Math.floor(i / pageSize); break; }
            var active = source(saved.activeSourceId);
            return { device: profile, settings: saved.settings, sources: saved.sources, activeSourceId: saved.activeSourceId,
                sourceName: active ? active.name : "", pageSize: pageSize, playerEngineLabel: engineLabel(saved.settings.playerEngine), screen: screen, page: page, query: query, group: group, loading: loading,
                selectedChannelId: pendingChannelFocus || (view.selectedChannelId ? view.selectedChannelId() : ""), currentChannel: current, currentState: resolving ? "loading" : media.getState().state,
                homeVisible: homeVisible, channels: channels, rows: rows.slice(page * pageSize, page * pageSize + pageSize), filteredTotal: rows.length,
                guidePage: guidePage, guideTotal: guideAll.length, breadcrumbs: breadcrumbs, activeFavorites: saved.activeFavorites, nowById: nowById, nextById: nextById, logosById: logosById, epgStatus: guideStatus(matched, currentCount), guideRows: guideRows };
        }
        function resize() {
            if (destroyed) return;
            var textSize = layout().textSize;
            root.style.fontSize = textSize + "px";
            d.body.style.fontSize = textSize + "px";
            d.body.style.fontFamily = (saved.settings.fontFamily === "system" ? "" : '"' + saved.settings.fontFamily + '",') + "Arial, Helvetica, sans-serif";
        }
        function render() {
            if (destroyed) return;
            resize(); d.documentElement.lang = saved.settings.language; d.body.className = "f2-accent-" + saved.settings.accent;
            var labels = { "player-home": t("Главная", "Home"), "player-pause": t("Играть / Пауза", "Play / Pause"), "player-stop": t("Стоп", "Stop"), "player-fullscreen": t("Полный экран", "Fullscreen"), "player-options": t("Параметры", "Options"), "player-engines": t("Движок", "Engine") };
            Object.keys(labels).forEach(function (id) { var node = d.getElementById(id); if (node) node.textContent = labels[id]; });
            root.style.display = homeVisible ? "block" : "none";
            view.render(buildModel());
            if (pendingChannelFocus && homeVisible && !view.hasDialog()) { if (view.focusChannel) view.focusChannel(pendingChannelFocus, 0); else view.focus("channel-0"); pendingChannelFocus = ""; }
            syncPlaybackPreview();
        }
        function syncPlaybackPreview() {
            if (destroyed) return;
            var stage = d.getElementById("player-stage"), rect = current && homeVisible && view.previewRect ? view.previewRect() : null;
            if (!stage) return;
            if (rect && rect.width > 0 && rect.height > 0) {
                stage.style.left = rect.left + "px"; stage.style.top = rect.top + "px";
                stage.style.width = rect.width + "px"; stage.style.height = rect.height + "px";
                stage.style.right = "auto"; stage.style.bottom = "auto"; stage.style.zIndex = "1501";
            } else {
                stage.style.left = ""; stage.style.top = ""; stage.style.right = ""; stage.style.bottom = "";
                stage.style.width = ""; stage.style.height = ""; stage.style.zIndex = "";
            }
            if (media && media.resize) media.resize();
            // Keep the exact media element/session; browsing only changes its rectangle.
            playbackInfo.setEnabled(!homeVisible && !!current && !quitRequested);
            updatePlaybackInfo();
            var status = d.getElementById("f2-preview-state"), playerStatus = d.getElementById("player-status");
            if (status && playerStatus && current) status.textContent = playerStatus.textContent;
        }
        function isFullscreen() {
            return !!(d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement || video.webkitDisplayingFullscreen);
        }
        function fullscreenChanged() {
            var active = isFullscreen();
            // Some browsers consume Escape before delivering keydown to the page.
            // Keep that native exit separate from the next windowed Escape press.
            if (fullscreenState && !active && !fullscreenExitRequested) {
                nativeEscapePending = true;
                environment.clearTimeout(escapeTimer);
                escapeTimer = environment.setTimeout(function () { nativeEscapePending = false; }, 300);
            }
            fullscreenState = active; fullscreenPending = false;
            if (!active) fullscreenExitRequested = false;
            if (!destroyed) syncPlaybackPreview();
        }
        function exitFullscreen() {
            fullscreenEpoch++; fullscreenPending = false;
            var active = d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement;
            var fn, result;
            try {
                fullscreenExitRequested = isFullscreen();
                if (active) {
                    fn = d.exitFullscreen || d.webkitExitFullscreen || d.webkitCancelFullScreen || d.mozCancelFullScreen || d.msExitFullscreen;
                    if (typeof fn === "function") result = fn.call(d);
                } else if (video.webkitDisplayingFullscreen && typeof video.webkitExitFullscreen === "function") result = video.webkitExitFullscreen();
                fullscreenPending = false;
                if (result && typeof result.then === "function") result.then(fullscreenChanged, function () { fullscreenExitRequested = false; });
                else fullscreenChanged();
            } catch (ignore) {}
        }
        function toggleFullscreen() {
            if (destroyed) return;
            if (isFullscreen()) { exitFullscreen(); return; }
            if (fullscreenPending) return;
            // Include dialogs and the channel browser in the fullscreen element.
            var target = d.documentElement, fn = target.requestFullscreen || target.webkitRequestFullscreen || target.webkitRequestFullScreen || target.mozRequestFullScreen || target.msRequestFullscreen;
            if (!fn) { target = d.getElementById("player-stage"); fn = target.requestFullscreen || target.webkitRequestFullscreen || target.webkitRequestFullScreen || target.mozRequestFullScreen || target.msRequestFullscreen; }
            if (!fn && typeof video.webkitEnterFullscreen === "function") { target = video; fn = video.webkitEnterFullscreen; }
            if (!fn) { view.toast(t("Полноэкранный режим недоступен.", "Fullscreen is unavailable.")); return; }
            fullscreenPending = true; fullscreenExitRequested = false;
            var epoch = ++fullscreenEpoch;
            try {
                var result = fn.call(target);
                if (result && typeof result.then === "function") result.then(function () { if (destroyed || epoch !== fullscreenEpoch) exitFullscreen(); else fullscreenChanged(); }, function () { if (epoch !== fullscreenEpoch) return; fullscreenPending = false; if (!destroyed) view.toast(t("Полноэкранный режим недоступен.", "Fullscreen is unavailable.")); });
                else fullscreenChanged();
            } catch (ignore) { fullscreenPending = false; view.toast(t("Полноэкранный режим недоступен.", "Fullscreen is unavailable.")); }
        }
        function requestQuit() {
            if (destroyed || quitRequested || view.hasDialog()) return;
            // Native video fullscreen cannot display an HTML confirmation dialog.
            if (video.webkitDisplayingFullscreen || d.fullscreenElement === d.getElementById("player-stage") || d.webkitFullscreenElement === d.getElementById("player-stage")) exitFullscreen();
            playbackInfo.setEnabled(false);
            view.dialog(t("Выйти из плеера?", "Exit player?"), '<p>' + t("Завершить воспроизведение и выйти?", "Stop playback and exit?") + '</p><div class="f2-toolbar">' +
                view.btn("quit-no", "cancelQuit", t("Нет", "No")) + view.btn("quit-yes", "confirmQuit", t("Да", "Yes")) + '</div>', { closeButton: false });
            quitRequested = true; view.focus("quit-no");
        }
        function confirmQuit() {
            if (!quitRequested || destroyed) return;
            exitPlayer();
        }
        function exitPlayer() {
            if (destroyed) return;
            quitRequested = false; destroy();
            d.getElementById("player-stage").style.display = "none";
            root.style.display = "block"; root.className = "";
            root.innerHTML = '<div id="player-exited" class="f2-empty" role="status"><strong>' + t("Плеер закрыт", "Player closed") + '</strong><p>' +
                t("Воспроизведение остановлено. Эту вкладку можно закрыть.", "Playback has stopped. You can close this tab.") + '</p><button id="restart-player" type="button" class="f2-button">' + t("Открыть плеер", "Open player") + '</button></div>';
            var restart = d.getElementById("restart-player");
            if (restart) { restart.onclick = function () { environment.location.reload(); }; restart.focus(); }
            // User-opened desktop tabs may reject close(); playback is already
            // released and the exit screen remains a complete stopped state.
            try { if (typeof environment.close === "function") environment.close(); } catch (ignore) {}
        }
        function engineLabel(id) { var labels = { auto: "Auto", native: /^lg\//.test(profile.id) ? "LG native" : "Native HTML5", "hls.js": "Hls.js", shaka: "Shaka", mpegts: "MPEG-TS" }; return labels[id] || id || labels.native; }
        function changeEngine(value) {
            if (["auto", "native", "hls.js", "shaka", "mpegts"].indexOf(value) < 0) return false;
            if (current && !gate.authorize("playback", permissionId(current)).ok) { challenge("playback", permissionId(current), function () { changeEngine(value); playbackView.openEngines(); }); return false; }
            persist(function (s) { s.settings.playerEngine = value; });
            if (!resolving && !pendingPlayable) media.setEngine(value);
            render(); return true;
        }
        function changeFormat(value) {
            if (["auto", "hls", "dash", "mpegts", "flv", "file"].indexOf(value) < 0) return false;
            if (current && !gate.authorize("playback", permissionId(current)).ok) { challenge("playback", permissionId(current), function () { changeFormat(value); playbackView.openEngines(); }); return false; }
            persist(function (s) { s.settings.streamFormat = value; });
            if (!resolving && !pendingPlayable) media.setFormat(value);
            render(); return true;
        }
        function showHome() {
            if (destroyed) return;
            if (!homeVisible && current) {
                if (current.kind !== "vod" && current.kind !== "folder" && current.kind !== "archive") {
                    screen = screen === "favorites" && (saved.favorites[saved.activeFavorites] || []).indexOf(current.id) !== -1 ? "favorites" : "tv";
                    var selected = getChannel(current.id) || current;
                    if (group && selected.group !== group) group = "";
                    if (query && selected.name.toLowerCase().indexOf(query.toLowerCase()) < 0) query = "";
                }
                pendingChannelFocus = current.id;
            }
            homeVisible = true; exitFullscreen(); render();
        }
        function resumePlayback() {
            if (destroyed || !current) return;
            view.closeDialog(); homeVisible = false; render(); showOSD();
        }
        function updatePlaybackInfo() {
            var now = { current: null, next: null };
            if (current && current.kind === "archive" && current.programme) now.current = current.programme;
            else if (current && guide) now = programmeFor(current, Date.now() / 1000);
            playbackInfo.update({ channel: current, programme: now.current, next: now.next });
        }
        function hideOSD() { playbackInfo.hide(); }
        function showOSD() {
            if (destroyed || homeVisible || quitRequested) return;
            playbackInfo.setEnabled(!!current); updatePlaybackInfo(); playbackInfo.show(false);
        }
        function advanceInfo() {
            if (destroyed || homeVisible || view.hasDialog() || !current) return;
            updatePlaybackInfo(); playbackInfo.advance();
        }
        function saveBookmark() {
            var snapshot = media.getState();
            if (current && current.kind === "vod" && snapshot.state !== "ended" && snapshot.channel && snapshot.channel.id === current.id && snapshot.position > 0 && !pendingResume && saved.bookmarks[current.id] !== snapshot.position) {
                persist(function (s) { s.bookmarks[current.id] = snapshot.position; });
            }
        }
        function flushBookmark() { if (!destroyed) saveBookmark(); }
        function visibilityChanged() {
            if (destroyed) return;
            if (d.hidden || d.webkitHidden) {
                flushBookmark();
                if (television && !hostSuspended) { hostSuspended = true; media.suspend({ paused: pendingPaused || autoplayBlocked }); }
                return;
            }
            refreshGuideIfDue();
            if (!hostSuspended) return;
            hostSuspended = false;
            if (!current || loading) return;
            if (!gate.authorize("playback", permissionId(current)).ok) { stopPlayback(); showHome(); return; }
            if (pendingPlayable && !pendingPaused) { var playable = pendingPlayable; pendingPlayable = null; startResolved(playable, resolveEpoch); }
            else media.resume();
        }
        function stopPlayback() {
            saveBookmark();
            playbackPreferences.reset();
            resolveEpoch++;
            if (typeof cancelResolve === "function") cancelResolve();
            cancelResolve = null; resolving = false; pendingPlayable = null; pendingPaused = false;
            environment.clearTimeout(digitTimer); keyDigits = "";
            pendingResume = 0; current = null; currentReference = null; autoplayBlocked = false;
            media.stop();
        }
        function mediaEvent(event) {
            if (destroyed) return;
            updatePlaybackInfo();
            var snapshot = media ? media.getState() : event;
            if (playbackPreferences) playbackPreferences.restore(snapshot, event.type);
            if (snapshot.state === "playing") autoplayBlocked = false;
            if (event.error && event.error.code === "autoplay_blocked") autoplayBlocked = true;
            var node = d.getElementById("player-status");
            var engineNode = d.getElementById("player-engine-status"), pickerNode = d.getElementById("engine-active-status"), position = Math.max(0, Math.floor(snapshot.position || 0)), formatLabel = snapshot.format === "unknown" ? "Auto" : String(snapshot.format || "auto").toUpperCase();
            if (engineNode) engineNode.textContent = engineLabel(saved.settings.playerEngine) + " → " + engineLabel(snapshot.backend) + " · " + formatLabel + " · " + Math.floor(position / 60) + ":" + ("0" + position % 60).slice(-2);
            if (pickerNode) pickerNode.textContent = snapshot.channel && snapshot.state !== "stopped" ? t("Сейчас: ", "Active: ") + engineLabel(snapshot.backend) + " · " + formatLabel : t("Нет активного потока", "No stream playing");
            if (snapshot.state === "detecting" || snapshot.detecting) { if (node) node.textContent = t("Определение формата потока…", "Detecting stream format…"); }
            var states = { idle: t("Готово", "Ready"), detecting: t("Определение потока…", "Detecting stream…"), switching: t("Переключение движка…", "Switching engine…"), loading: t("Загрузка…", "Loading…"), playing: t("Воспроизведение", "Playing"), buffering: t("Буферизация…", "Buffering…"), retrying: t("Повторное подключение…", "Reconnecting…"), paused: t("Пауза", "Paused"), stopped: t("Остановлено", "Stopped"), suspended: t("Приостановлено устройством", "Suspended by device"), ended: t("Воспроизведение завершено", "Playback ended"), error: t("Не удалось воспроизвести поток", "Stream playback failed") };
            if (node) node.textContent = states[snapshot.state || event.state] || "";
            // Browser and adapter errors can include credential-bearing stream URLs.
            if (event.type === "piperror") { view.toast(t("Режим картинки в картинке недоступен.", "Picture in picture is unavailable.")); return; }
            if (node && event.error) {
                if (event.error.code === "autoplay_blocked") node.textContent = t("Нажмите воспроизведение, чтобы начать.", "Press Play to start playback.");
                else if (snapshot.state === "retrying") node.textContent = t("Повторное подключение: ", "Reconnecting: ") + snapshot.retries + "/3";
                else node.textContent = t("Поток не воспроизводится. Откройте «Движок» для смены проигрывателя. ", "Playback failed. Open Engine to change the player. ") + String(event.error.code || "media_error").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
            }
            if (node && autoplayBlocked) node.textContent = t("Нажмите воспроизведение, чтобы начать.", "Press Play to start playback.");
            if (homeVisible) { var previewStatus = d.getElementById("f2-preview-state"); if (previewStatus && node) previewStatus.textContent = node.textContent; }
            if (event.error || event.type === "playing") showOSD();
            if (event.error && event.error.code === "autoplay_blocked" && !homeVisible && !view.hasDialog()) {
                var playButton = d.getElementById("player-pause");
                if (playButton && typeof playButton.focus === "function") playButton.focus();
            }
            if (snapshot.state === "ended" && current && current.kind === "vod") persist(function (s) { delete s.bookmarks[current.id]; });
            if (snapshot.state === "playing" && current && snapshot.channel && snapshot.channel.id === current.id) {
                if (pendingResume > 0) {
                    var resumeAt = pendingResume;
                    pendingResume = 0; // seek emits synchronously; consume before calling it.
                    if (!media.seek(resumeAt)) pendingResume = resumeAt;
                }
                var historyChanged = saved.history.length === 0 || saved.history[0].id !== current.id;
                var channelChanged = currentReference && JSON.stringify(saved.lastChannel) !== JSON.stringify(currentReference);
                var previous = saved.lastChannel, sameBroadcast = channelChanged && previous && currentReference && previous.sourceId === currentReference.sourceId ? library.restoreChannel(channels, previous) : null;
                if (historyChanged || channelChanged) persist(function (s) {
                    if (historyChanged) {
                        s.history = environment.OttPlayCore.recordBrowserHistory(s.history, current.id, current.name, Date.now());
                    }
                    // Save confirmed playback immediately; power loss may omit unload.
                    if (channelChanged) {
                        if (previous && (!sameBroadcast || sameBroadcast.id !== current.id)) s.previousChannel = previous;
                        s.lastChannel = currentReference;
                    }
                });
                if (current.kind === "vod" && !pendingResume && event.type === "timeupdate" && snapshot.position > 0 && Date.now() - lastBookmark > 15000) {
                    lastBookmark = Date.now(); persist(function (s) { s.bookmarks[current.id] = snapshot.position; });
                }
            }
        }
        function play(ch, resume) {
            if (!ch || destroyed || loading) return;
            if (ch.kind === "folder") { browse(ch); return; }
            if (!gate.authorize("playback", permissionId(ch)).ok) { challenge("playback", permissionId(ch), function () { play(ch, resume); }); return; }
            if (ch.restorePath) { restoreSavedItem(ch, resume); return; }
            stopPlayback();
            var epoch = ++resolveEpoch;
            view.closeDialog(); current = ch; pendingResume = resume ? saved.bookmarks[ch.id] || 0 : 0;
            if (ch.kind !== "vod" && ch.kind !== "folder" && source(ch.sourceId || saved.activeSourceId)) {
                var original = ch;
                for (var i = 0; i < channels.length; i++) if (channels[i].id === ch.id) { original = channels[i]; break; }
                currentReference = library.channelReference(original, ch.sourceId || saved.activeSourceId);
            }
            playbackPreferences.begin(ch, currentReference || library.channelReference(ch, ch.sourceId || saved.activeSourceId), channels);
            resolving = true; lastBookmark = Date.now();
            homeVisible = false; render();
            d.getElementById("player-title").textContent = ch.name; showOSD();
            d.getElementById("player-status").textContent = t("Получение потока…", "Resolving stream…");
            cancelResolve = providers.resolve(ch, function (error, resolved) {
                if (destroyed || epoch !== resolveEpoch) return;
                resolving = false;
                if (error || !resolved || typeof resolved.url !== "string") { stopPlayback(); view.toast(t("Не удалось получить поток.", "Could not resolve stream.")); showHome(); return; }
                var playable = {}; Object.keys(ch).forEach(function (key) { playable[key] = ch[key]; }); playable.url = resolved.url;
                if (pendingPaused || hostSuspended) { pendingPlayable = playable; return; }
                startResolved(playable, epoch);
            });
        }
        function startResolved(playable, epoch) {
            if (destroyed || epoch !== resolveEpoch || !current || current.id !== playable.id) return;
            if (!gate.authorize("playback", permissionId(current)).ok) {
                pendingPlayable = playable; pendingPaused = true;
                challenge("playback", permissionId(current), function () { if (!destroyed && epoch === resolveEpoch) playbackCommand("play"); }); return;
            }
            if (hostSuspended) { pendingPlayable = playable; return; }
            media.volume(saved.settings.volume); media.mute(saved.settings.muted); media.load(playable, { engine: saved.settings.playerEngine, format: saved.settings.streamFormat });
            var picture = playbackPreferences.settings();
            media.setAspect(picture.aspect === "auto" ? "fit" : picture.aspect); media.setZoom(picture.zoom);
        }
        function clearBrowse() { browsing = false; browseEpoch++; if (cancelBrowse) cancelBrowse(); cancelBrowse = null; browseItems = null; discovered = []; parentsById = {}; breadcrumbs = []; }
        function rememberBrowse(node, items) {
            items.forEach(function (entry) { parentsById[entry.id] = (parentsById[node.id] || []).concat([node.id]); discovered = discovered.filter(function (old) { return old.id !== entry.id; }); discovered.push(entry); });
        }
        function restoreSavedItem(ch, resume) {
            var record = saved.favoriteItems[ch.id], sourceConfig = source(ch.sourceId);
            if (!record || !record.parents.length || !sourceConfig || !providers.browse) return;
            if (cancelBrowse) cancelBrowse(); var epoch = ++browseEpoch, generation = sourceEpoch, parents = record.parents.slice();
            browsing = true; loading = true; render();
            function step(items, index) {
                if (destroyed || epoch !== browseEpoch || generation !== sourceEpoch) return;
                var wanted = index < parents.length ? parents[index] : ch.id, item = null;
                items.forEach(function (entry) { if (entry.id === wanted) item = entry; });
                if (!item) { browsing = false; loading = false; view.toast(t("Элемент больше не доступен в источнике.", "This item is no longer available from the source.")); render(); return; }
                if (index === parents.length) { browsing = false; loading = false; play(item, resume); return; }
                cancelBrowse = providers.browse(sourceConfig, item, function (error, result) {
                    if (destroyed || epoch !== browseEpoch || generation !== sourceEpoch) return;
                    if (error) { browsing = false; loading = false; view.toast(t("Не удалось восстановить элемент избранного.", "Could not restore this favorite.")); render(); return; }
                    rememberBrowse(item, result.items || []); step(result.items || [], index + 1);
                });
            }
            step(channels, 0);
        }
        function browse(node) {
            if (!gate.authorize("playback", permissionId(node)).ok) { challenge("playback", permissionId(node), function () { browse(node); }); return; }
            var item = source(node.sourceId || saved.activeSourceId); if (!item || !providers.browse) return;
            if (cancelBrowse) cancelBrowse(); var epoch = ++browseEpoch, sourceGeneration = sourceEpoch; browsing = true; loading = true; render();
            cancelBrowse = providers.browse(item, node, function (error, result) {
                if (destroyed || epoch !== browseEpoch || sourceGeneration !== sourceEpoch) return;
                browsing = false; loading = false;
                if (error) { view.toast(t("Не удалось открыть раздел.", "Could not open this folder.")); render(); return; }
                breadcrumbs.push({ node: node, items: browseItems }); browseItems = result.items || [];
                rememberBrowse(node, browseItems);
                screen = "vod"; query = ""; group = ""; page = 0; view.closeDialog(); render();
            });
        }
        function loadSource(item, restore) {
            if (!item || destroyed) return;
            if (!restore) startupRestore = null;
            gate.lock();
            if (cancelSource) cancelSource(); if (cancelGuide) cancelGuide(); if (cancelBrowse) cancelBrowse();
            clearBrowse(); identityReport = null; catalogSourceId = ""; guideRefresh.reset(true); guideFeeds = {}; sourceEpgUrls = []; guideInfo = guideRefresh.snapshot().info; if (providers.close && saved.activeSourceId) providers.close(saved.activeSourceId);
            var epoch = ++sourceEpoch; stopPlayback(); channels = []; guide = null; if (guideLookup) guideLookup.clear(); loading = true; loadingSourceId = item.id; showHome();
            function done(error, result) {
                if (destroyed || epoch !== sourceEpoch) return;
                var restoreNow = restore && startupRestore === restore;
                if (restoreNow) startupRestore = null;
                loading = false; loadingSourceId = "";
                if (error) { view.toast(t("Источник недоступен. Проверьте адрес, сеть и разрешение CORS.", "Source unavailable. Check the address, network and CORS permissions.")); render(); return; }
                channels = result.channels; group = ""; query = ""; page = 0;
                catalogSourceId = item.id;
                persist(function (s) { s.activeSourceId = item.id; identityReport = identity.reconcile(s, channels, item.id); });
                if (identityReport.unresolved) view.toast(t("Некоторые сохранённые каналы требуют повторного выбора; PIN-защита сохранена.", "Some saved channels need review; PIN protection has been retained."));
                if (!restore || restoreNow) { screen = "tv"; pendingChannelFocus = (catalog(false).filter(function (entry) { return entry.kind !== "vod" && entry.kind !== "folder"; })[0] || {}).id || ""; }
                render();
                if (result.warnings && result.warnings.length) view.toast(t("Источник загружен с предупреждениями: ", "Source loaded with warnings: ") + result.warnings.length);
                if (restoreNow && (saved.settings.restore || restore.userRequested) && !view.hasDialog()) restoreReference(restore);
                sourceEpgUrls = (result.epgUrls || []).slice();
                if (channels.length) loadEPG(preferredEpgUrls());
            }
            if (item.text) {
                try { done(null, providers.parseM3U ? providers.parseM3U(item.text, item) : require("providers").parseM3U(item.text, item)); }
                catch (error) { done(error); }
            } else cancelSource = providers.load(item, done);
        }
        function restoreReference(reference) {
            var last = getChannel(reference.id);
            if (!last && !reference.exactOnly) {
                var matched = library.restoreChannel(channels, reference);
                if (matched) last = getChannel(matched.id);
            }
            if (!last || last.kind === "folder") { view.toast(t("Последний канал недоступен. Выберите другой канал.", "The last channel is unavailable. Choose another channel.")); return; }
            if (last.id !== reference.id && saved.security.protectedIds.indexOf(reference.id) !== -1 && saved.security.protectedIds.indexOf(last.id) === -1) {
                persist(function (s) {
                    if (s.security.protectedIds.length < 50000) s.security.protectedIds.push(last.id);
                    else s.security.protectedIds[s.security.protectedIds.indexOf(reference.id)] = last.id;
                });
            }
            play(last, true);
        }
        function previousChannel() {
            var reference = saved.previousChannel, target = reference && source(reference.sourceId);
            if (!target) { view.toast(t("Предыдущий просмотренный канал отсутствует.", "No previously watched channel.")); return; }
            if (reference.sourceId === saved.activeSourceId) restoreReference(reference);
            else {
                var proceed = function () { startupRestore = rememberedReference(reference); startupRestore.userRequested = true; loadSource(source(reference.sourceId), startupRestore); };
                if (!gate.authorize("source").ok) challenge("source", "", proceed);
                else proceed();
            }
        }
        function refreshGuideIfDue() {
            if (!loading && !(d.hidden || d.webkitHidden) && channels.length && guideRefresh.isDue(Date.now())) loadEPG(preferredEpgUrls(), true);
        }
        function loadEPG(urls, automatic) {
            if (destroyed) return;
            urls = guideRefresh.normalize(urls);
            if (!urls.length) { view.toast(t("Укажите URL XMLTV в настройках.", "Set an XMLTV URL in Settings.")); return; }
            if (cancelGuide) cancelGuide();
            var change = guideRefresh.begin(urls, !!automatic), epoch = change.generation, cancellations = [], previousFeeds = guideFeeds;
            guideFeeds = {};
            change.feeds.forEach(function (url) { guideFeeds[url] = previousFeeds[url]; });
            if (change.merge) {
                var retained = change.feeds.map(function (url) { return guideFeeds[url]; });
                guide = retained.length ? epg.mergeGuides(retained) : null;
                if (guideLookup) guideLookup.clear();
            }
            guideInfo = change.info; if (homeVisible) render();
            cancelGuide = function () { cancellations.forEach(function (cancel) { if (typeof cancel === "function") cancel(); }); };
            urls.forEach(function (url, index) {
                cancellations.push(request(url, function (error, content) {
                    if (!guideRefresh.accepts(epoch)) return;
                    var parsed, errorCode = null;
                    try { if (error) throw error; parsed = epg.parseXML(content, environment.DOMParser, url); guideFeeds[url] = parsed; }
                    catch (parseError) { errorCode = parseError.code || "NETWORK"; }
                    var update = guideRefresh.complete(epoch, index, !!parsed, errorCode, Date.now());
                    guideInfo = update.info;
                    if (update.merge) guide = epg.mergeGuides(update.feeds.map(function (feed) { return guideFeeds[feed]; }));
                    if (homeVisible) render();
                    if (update.notify) view.toast(update.feeds.length ? t("Часть источников EPG недоступна.", "Some EPG sources are unavailable.") : "EPG: " + epgError(guideInfo.errors[0]));
                }, { builtinEPG: url === defaultEpgUrl || url === "http://epg.it999.ru/epg2.xml.gz", channels: channels.filter(function (channel) { return channel.kind !== "vod" && channel.kind !== "folder"; }).map(function (channel) { return { id: channel.id, tvgId: channel.tvgId || "", tvgName: channel.tvgName || "", name: channel.name, archiveDays: Math.max(0, Math.min(7, (Number(channel.catchup && channel.catchup.days || channel.archiveDays) || 0))) }; }) }));
            });
        }
        function channelDialog(ch) {
            if (!ch) return;
            if (ch.kind === "folder") { browse(ch); return; }
            var isFavorite = (saved.favorites[saved.activeFavorites] || []).indexOf(ch.id) !== -1;
            var html = '<p>' + view.escape(ch.group || (ch.kind === "vod" ? "VOD" : t("Прямой эфир", "Live broadcast"))) + '</p><div class="f2-actions">' + view.btn("watch", "play", t("Смотреть", "Watch"), ch.id, "f2-primary");
            if (saved.bookmarks[ch.id] && ch.kind === "vod") html += view.btn("resume", "resume", t("Продолжить", "Resume"), ch.id);
            html += view.btn("favorite", "favorite", isFavorite ? t("Убрать из избранного", "Remove favorite") : t("В избранное", "Add favorite"), ch.id) + '</div>';
            html += '<div class="f2-toolbar">' + view.btn("channel-edit", "editChannel", t("Изменить", "Edit"), ch.id) + view.btn("channel-protect", "protectChannel", gate.isProtected(ch.id, "playback") ? t("Снять защиту", "Unprotect") : t("Защитить PIN", "Protect with PIN"), ch.id);
            if (isFavorite) html += view.btn("favorite-up", "favoriteUp", t("Выше в списке", "Move up"), ch.id) + view.btn("favorite-down", "favoriteDown", t("Ниже в списке", "Move down"), ch.id);
            html += '</div>';
            var programme = nowById[ch.id]; if (programme) html += '<h3>' + view.escape(programme.title) + '</h3><p>' + view.escape(programme.description) + '</p>';
            view.dialog(ch.name, html); view.focus("watch");
        }
        function sourceForm(item) {
            item = item || { id: "", name: "", url: "", type: "m3u" };
            view.dialog(t("Подключение источника", "Connect source"), '<input id="source-id" type="hidden" value="' + view.escape(item.id) + '">' +
                view.field("source-name", t("Название", "Name"), item.name) + '<label class="f2-field"><span>' + t("Тип", "Type") + '</span><select id="source-type"><option value="m3u">M3U / M3U8</option><option value="xtream"' + (item.type === "xtream" ? ' selected="selected"' : "") + '>Xtream Codes</option><option value="stalker"' + (item.type === "stalker" ? ' selected="selected"' : "") + '>Stalker / Ministra</option></select></label>' +
                view.field("source-url", "URL (http / https)", item.url, "url") + view.field("source-user", t("Логин Xtream", "Xtream username"), item.username) + view.field("source-password", t("Пароль Xtream", "Xtream password"), item.password, "password") + view.field("source-mac", "Stalker MAC", item.mac) +
                '<label class="f2-field"><span>' + t("Или вставьте M3U-текст", "Or paste M3U text") + '</span><textarea id="source-text" rows="4">' + view.escape(item.text || "") + '</textarea></label><label class="f2-field"><span>' + t("Или выберите M3U-файл", "Or select an M3U file") + '</span><input type="file" id="source-file" accept=".m3u,.m3u8,text/plain"></label><p class="f2-help">' +
                t("Источник сохраняется только в этом браузере. Для удалённого URL сервер должен разрешать CORS.", "The source is saved in this browser. A remote URL must permit CORS requests.") + '</p>' + view.btn("save-source", "saveSource", t("Сохранить и открыть", "Save and open"), "", "f2-primary"));
            view.focus("source-name");
        }
        function saveSource(values) {
            var file = d.getElementById("source-file"), selected = file && file.files && file.files[0];
            function save(body) {
                if (destroyed) return;
                if (!values["source-url"] && !body) { view.toast(t("Укажите URL или M3U-текст.", "Enter a URL or M3U text.")); return; }
                var item = { id: values["source-id"] || "source-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1000000).toString(36), name: values["source-name"] || "Playlist", type: values["source-type"], url: String(values["source-url"] || "").replace(/^\s+|\s+$/g, ""), text: body, username: values["source-user"], password: values["source-password"], mac: values["source-mac"] };
                if (item.type !== "m3u") item.text = "";
                try { persist(function (s) { s.sources = s.sources.filter(function (entry) { return entry.id !== item.id; }); s.sources.push(item); }); }
                catch (error) { view.toast(t("Проверьте поля источника: нужен HTTP/HTTPS URL.", "Check source fields: an HTTP/HTTPS URL is required.")); return; }
                view.closeDialog(); loadSource(item);
            }
            if (selected) {
                if (!environment.FileReader || selected.size > 10 * 1024 * 1024) { view.toast(t("Файл недоступен или больше 10 МБ.", "File is unavailable or larger than 10 MB.")); return; }
                if (fileReader) { try { fileReader.abort(); } catch (ignore) {} }
                var reader = new environment.FileReader(); fileReader = reader;
                reader.onload = function () { if (destroyed || fileReader !== reader) return; fileReader = null; if (!view.hasDialog()) return; challenge("source", "", function () { save(String(reader.result)); }); };
                reader.onerror = function () { if (destroyed || fileReader !== reader) return; fileReader = null; view.toast(t("Не удалось прочитать файл.", "Could not read file.")); };
                reader.readAsText(selected);
            } else save(values["source-text"]);
        }
        function action(name, value, values) {
            if (destroyed) return;
            startupRestore = null;
            values = values || {};
            if (name === "confirmQuit") { confirmQuit(); return; }
            if (name === "cancelQuit") { if (quitRequested) { view.closeDialog(); showOSD(); } return; }
            if (name === "unlock") {
                var pending = pinChallenge;
                if (!pending) return;
                var access = gate.authorize(pending.scope, pending.id, values["access-pin"] || "");
                if (!access.ok) { view.toast(t("PIN не принят. Повторите позже при блокировке.", "PIN not accepted. If locked out, try again later.")); return; }
                pinChallenge = null; view.closeDialog(); pending.proceed(); return;
            }
            var scope = actionScope(name, value);
            if (scope && !gate.authorize(scope).ok) { challenge(scope, "", function () { action(name, value, values); }); return; }
            if (features.handle(name, value, values) || playbackView.handle(name, value, values)) return;
            var html, list, i, ch;
            if (name === "screen") { if (browsing) { browseEpoch++; if (cancelBrowse) cancelBrowse(); browsing = false; loading = false; } screen = value; page = 0; guidePage = 0; group = ""; query = ""; pendingChannelFocus = ""; render(); if ((value === "tv" || value === "favorites" || value === "vod") && view.focusChannel) view.focusChannel(current ? current.id : "", 0); else if (view.focusContent) view.focusContent(); else view.focus("menu-toggle"); }
            else if (name === "menuLayout") syncPlaybackPreview();
            else if (name === "back") { if (current) resumePlayback(); else { screen = "tv"; render(); if (view.focusChannel) view.focusChannel("", 0); } }
            else if (name === "resumePlayback") resumePlayback();
            else if (name === "closeDialog") { pinChallenge = null; view.closeDialog(); }
            else if (name === "browseBack") { if (cancelBrowse) cancelBrowse(); browseEpoch++; browsing = false; loading = false; var crumb = breadcrumbs.pop(); browseItems = crumb ? crumb.items : null; page = 0; render(); }
            else if (name === "guidePage") { guidePage = Math.max(0, Number(value) || 0); render(); view.focus("guide-0"); }
            else if (name === "addSource") sourceForm();
            else if (name === "editSource") sourceForm(source(value));
            else if (name === "saveSource") saveSource(values);
            else if (name === "loadSource") loadSource(source(value));
            else if (name === "deleteSource") view.dialog(t("Удалить источник?", "Delete source?"), '<p>' + t("Остальные источники и избранное сохранятся.", "Other sources and favorites will be preserved.") + '</p>' + view.btn("confirm-delete", "confirmDelete", t("Удалить", "Delete"), value));
            else if (name === "confirmDelete") {
                if (value === saved.activeSourceId || value === loadingSourceId) { if (cancelSource) cancelSource(); if (cancelGuide) cancelGuide(); sourceEpoch++; guideRefresh.reset(false); clearBrowse(); identityReport = null; catalogSourceId = ""; guideFeeds = {}; stopPlayback(); channels = []; guide = null; if (guideLookup) guideLookup.clear(); loading = false; loadingSourceId = ""; }
                if (providers.close) providers.close(value);
                persist(function (s) { s.sources = s.sources.filter(function (entry) { return entry.id !== value; }); }); view.closeDialog(); render();
            } else if (name === "channel") channelDialog(getChannel(value));
            else if (name === "play" || name === "resume") play(getChannel(value), name === "resume");
            else if (name === "favorite") {
                persist(function (s) { var items = s.favorites[s.activeFavorites], entry = getChannel(value); if (environment.OttPlayCore.editFavoriteSelection(items, value, "toggle") && entry && parentsById[value] && parentsById[value].length) s.favoriteItems[value] = { name: entry.name, sourceId: entry.sourceId, parents: parentsById[value].slice() }; }); channelDialog(getChannel(value));
            } else if (name === "favoriteLists") {
                html = '<div class="f2-toolbar">'; Object.keys(saved.favorites).forEach(function (entry, index) { html += view.btn("favorite-list-" + index, "useFavoriteList", view.escape(entry), entry); });
                html += '</div>' + view.btn("rename-list", "renameFavoriteList", t("Переименовать текущий", "Rename current")) + view.btn("delete-list", "deleteFavoriteList", t("Удалить текущий", "Delete current")) + view.field("list-name", t("Новый список", "New list"), "") + view.btn("add-list", "addFavoriteList", t("Создать", "Create")); view.dialog(t("Списки избранного", "Favorite lists"), html);
            } else if (name === "useFavoriteList") { persist(function (s) { s.activeFavorites = value; }); view.closeDialog(); render(); }
            else if (name === "addFavoriteList") {
                var newName = String(values["list-name"] || "").replace(/^\s+|\s+$/g, "");
                if (!newName || ["__proto__", "constructor", "prototype"].indexOf(newName) !== -1 || newName.length > 100) { view.toast(t("Введите допустимое имя.", "Enter a valid name.")); return; }
                persist(function (s) { environment.OttPlayCore.favoriteListChange(s, "browser", "add", newName, ""); }); view.closeDialog(); render();
            } else if (name === "channelPage") {
                pendingChannelFocus = "";
                page = isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
                render(); if (view.focusChannel) view.focusChannel("", Number(values.rowIndex) || 0);
            } else if (name === "page") { pendingChannelFocus = ""; page = isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0; render(); view.focus("channel-0"); }
            else if (name === "search") view.dialog(t("Поиск каналов", "Search channels"), view.field("search-query", t("Название", "Name"), query) + view.btn("search-apply", "applySearch", t("Найти", "Search")));
            else if (name === "applySearch") { query = String(values["search-query"] || ""); page = 0; guidePage = 0; view.closeDialog(); render(); }
            else if (name === "groups") {
                list = []; html = view.btn("group-all", "group", t("Все группы", "All groups"));
                catalog(false).forEach(function (entry) { if (entry.group && list.indexOf(entry.group) === -1) list.push(entry.group); });
                list.forEach(function (entry, index) { html += view.btn("group-" + index, "group", view.escape(entry), entry); }); view.dialog(t("Группы каналов", "Channel groups"), '<div class="f2-toolbar">' + html + '</div>');
            } else if (name === "group") { group = value; page = 0; view.closeDialog(); render(); }
            else if (name === "font" || name === "scale" || name === "language") { persist(function (s) { s.settings[name === "font" ? "fontFamily" : name === "scale" ? "fontScale" : "language"] = name === "scale" ? Number(value) : value; }); render(); }
            else if (name === "epgSource") view.dialog("XMLTV / EPG", '<p class="f2-help">' + t("Оставьте поле пустым для EPG из плейлиста или встроенного источника EPG.ONE.", "Leave empty to use the playlist EPG or the built-in EPG.ONE source.") + '</p><label class="f2-field"><span>' + t("URL XMLTV, по одному в строке", "XMLTV URLs, one per line") + '</span><textarea id="epg-url-value" rows="5">' + view.escape(saved.settings.epgUrls.length ? saved.settings.epgUrls.join("\n") : saved.settings.epgUrl) + '</textarea></label>' + view.btn("epg-save", "saveEPG", t("Сохранить и загрузить", "Save and load")));
            else if (name === "saveEPG") {
                var epgUrls = String(values["epg-url-value"] || "").split(/\r?\n/).map(function (url) { return url.replace(/^\s+|\s+$/g, ""); }).filter(function (url) { return !!url; });
                if (epgUrls.length > 10 || epgUrls.some(function (url) { return !require("providers").httpUrl(url); })) { view.toast(t("Укажите до 10 HTTP/HTTPS URL.", "Enter up to 10 HTTP/HTTPS URLs.")); return; }
                persist(function (s) { s.settings.epgUrls = epgUrls; s.settings.epgUrl = epgUrls[0] || ""; }); view.closeDialog(); loadEPG(preferredEpgUrls());
            }
            else if (name === "refreshEPG") { if (channels.length) loadEPG(preferredEpgUrls()); }
            else if (name === "programme") {
                var entry = guideRows[Number(value)]; if (!entry) return;
                html = '<p>' + view.escape(entry.programme.description) + '</p>' + view.btn("programme-live", "play", t("Прямой эфир", "Watch live"), entry.channel.id);
                if (entry.programme.start > Date.now() / 1000) html += view.btn("programme-reminder", "remindProgramme", t("Напомнить / отменить", "Toggle reminder"), value);
                if (epg.archiveUrl(entry.channel, entry.programme, Date.now() / 1000)) html += view.btn("programme-archive", "archive", t("Смотреть архив", "Watch archive"), value);
                view.dialog(entry.programme.title, html);
            } else if (name === "remindProgramme") { var reminder = guideRows[Number(value)]; if (reminder) persist(function (s) { library.toggleReminder(s, reminder.channel, reminder.programme); }); view.closeDialog(); view.toast(t("Напоминание обновлено.", "Reminder updated."));
            } else if (name === "archive") {
                var selected = guideRows[Number(value)], url = selected && epg.archiveUrl(selected.channel, selected.programme, Date.now() / 1000);
                if (url) { ch = {}; Object.keys(selected.channel).forEach(function (key) { ch[key] = selected.channel[key]; }); ch.url = url; ch.kind = "archive"; ch.programme = selected.programme; play(ch, false); }
            } else if (name === "export") view.dialog(t("Экспорт настроек", "Export settings"), '<p>' + t("По умолчанию источники исключены: URL и плейлисты могут содержать пароли.", "Sources are excluded by default: URLs and playlists may contain credentials.") + '</p><label><input id="include-secrets" type="checkbox"> ' + t("Включить источники и учётные данные", "Include sources and credentials") + '</label><br>' + view.btn("make-export", "makeExport", t("Создать JSON", "Create JSON")));
            else if (name === "makeExport") {
                var json = repository.exportJSON(values["include-secrets"] === true);
                view.dialog(t("Настройки JSON", "Settings JSON"), '<label class="f2-field"><textarea id="export-json" rows="12" readonly>' + view.escape(json) + '</textarea></label>' + view.btn("download", "download", t("Скачать файл", "Download file")));
            } else if (name === "download") {
                if (!environment.Blob || !environment.URL || !environment.URL.createObjectURL) { view.toast(t("Скопируйте JSON из поля.", "Copy JSON from the text field.")); return; }
                var blobUrl = environment.URL.createObjectURL(new environment.Blob([values["export-json"]], { type: "application/json" })), link = d.createElement("a"); link.href = blobUrl; link.download = "ottplay2-settings.json"; d.body.appendChild(link); link.click(); link.parentNode.removeChild(link);
                downloadUrls.push(blobUrl); downloadTimers.push(environment.setTimeout(function () { environment.URL.revokeObjectURL(blobUrl); }, 2000));
            } else if (name === "import") view.dialog(t("Импорт настроек", "Import settings"), '<p>' + t("Вставьте резервную копию OTT-play 2 или исходный экспорт OTT-Play в JSON/XML. Перед импортом можно проверить результат.", "Paste an OTT-play 2 backup or an original OTT-Play JSON/XML export. You can review the result before importing.") + '</p><label class="f2-field"><textarea id="import-json" rows="9"></textarea></label>' + view.btn("apply-import", "previewImport", t("Проверить и импортировать", "Validate and import")));
            else if (name === "previewImport") {
                try {
                    pendingMigration = require("migration").preview(String(values["import-json"] || ""));
                    if (pendingMigration.legacy) pendingMigration.proposed.security = saved.security;
                    html = '<p>' + t("Источников: ", "Sources: ") + pendingMigration.summary.sources + '</p><p>' + t("Язык: ", "Language: ") + view.escape(pendingMigration.summary.language) + '</p>';
                    pendingMigration.warnings.forEach(function (warning) { html += '<p>' + view.escape(warning) + '</p>'; });
                    if (pendingMigration.requiresParentalReview) html += '<label class="f2-check"><input type="checkbox" id="migration-parental"> ' + t("Я проверю PIN и защищённые каналы перед просмотром.", "I will review the PIN and protected channels before playback.") + '</label>';
                    html += view.btn("confirm-import", "confirmImport", t("Заменить настройки", "Replace settings")); view.dialog(t("Проверка импорта", "Review import"), html);
                } catch (error) { pendingMigration = null; view.toast(t("Не удалось распознать настройки.", "Settings could not be recognized.")); }
            } else if (name === "confirmImport") {
                if (!pendingMigration) return;
                if (pendingMigration.requiresParentalReview && !values["migration-parental"]) { view.toast(t("Подтвердите проверку родительского контроля.", "Confirm the parental-control review.")); return; }
                var migration = pendingMigration; pendingMigration = null;
                if (migration.requiresParentalReview) { migration.proposed.settings.restore = false; migration.proposed.settings.startupVersion = 1; migration.proposed.activeSourceId = ""; }
                action("applyImport", "", { "import-json": JSON.stringify(migration.proposed), reviewParental: migration.requiresParentalReview });
            } else if (name === "applyImport") {
                try {
                    var incoming = require("state").validate(JSON.parse(values["import-json"]));
                    stopPlayback(); // Finish old-session bookmarks before replacing the settings document.
                    saved = repository.importJSON(JSON.stringify(incoming)); overrideSignature = JSON.stringify(saved.channelOverrides); if (guideLookup) guideLookup.clear(); view.closeDialog();
                    gate.lock(); startupRestore = false;
                    if (saved.activeSourceId && !values.reviewParental) loadSource(source(saved.activeSourceId));
                    else { sourceEpoch++; guideRefresh.reset(false); if (cancelSource) cancelSource(); if (cancelGuide) cancelGuide(); clearBrowse(); identityReport = null; catalogSourceId = ""; guideFeeds = {}; channels = []; guide = null; loading = false; loadingSourceId = ""; showHome(); }
                }
                catch (error) { view.toast(t("Импорт отклонён. Текущие настройки сохранены.", "Import rejected. Current settings were preserved.")); }
            } else if (name === "sleep") {
                html = ""; [0, 15, 30, 60, 120].forEach(function (minutes) { html += view.btn("sleep-" + minutes, "setSleep", minutes ? minutes + t(" минут", " minutes") : t("Выключить", "Off"), String(minutes)); }); view.dialog(t("Таймер сна", "Sleep timer"), '<div class="f2-toolbar">' + html + '</div>');
            } else if (name === "setSleep") { environment.clearTimeout(sleepTimer); if ([15, 30, 60, 120].indexOf(Number(value)) !== -1) sleepTimer = environment.setTimeout(function () { if (destroyed) return; stopPlayback(); showHome(); }, Number(value) * 60000); view.closeDialog(); view.toast(t("Таймер обновлён.", "Sleep timer updated.")); }
        }
        function playbackCommand(command) {
            var osd = d.getElementById("player-osd"), active = d.activeElement, controls, controlIndex;
            if (!destroyed && osd.style.display !== "none" && osd.contains && osd.contains(active) && active.tagName === "BUTTON") {
                if (command === "ok") { active.click(); return true; }
                if (command === "left" || command === "right") {
                    controls = osd.querySelectorAll("button");
                    for (controlIndex = 0; controlIndex < controls.length; controlIndex++) if (controls[controlIndex] === active) break;
                    if (controls.length) controls[(controlIndex + (command === "left" ? -1 : 1) + controls.length) % controls.length].focus();
                    showOSD(); return true;
                }
                if (command === "up" || command === "down") { hideOSD(); return true; }
            }
            if (command === "up" || command === "next") command = "channelUp";
            if (command === "down" || command === "previous") command = "channelDown";
            if (command === "forward") command = "right";
            if (command === "rewind") command = "left";
            if (destroyed) return false;
            var snapshot = media.getState(), index = -1, i;
            if (command === "back" || command === "menu" || command === "home") { showHome(); if (command === "menu" && view.setMenuOpen) view.setMenuOpen(true); return true; }
            if (command === "info") { advanceInfo(); return true; }
            if (command === "audio" || command === "subtitle" || command === "aspect" || command === "zoom") { playbackView.open(); return true; }
            if (command === "pip") { playbackView.handle("togglePip"); return true; }
            if (command === "previousChannel") { previousChannel(); return true; }
            if (command === "yellow") { playbackView.openEngines(); return true; }
            if (command === "ok") { showOSD(); d.getElementById("player-pause").focus(); return true; }
            if (command === "playPause") command = pendingPaused || snapshot.paused || snapshot.state === "error" || (!resolving && snapshot.state === "stopped") || snapshot.state === "ended" ? "play" : "pause";
            if (command === "pause") { pendingPaused = true; saveBookmark(); media.pause(); if (resolving || pendingPlayable) d.getElementById("player-status").textContent = t("Пауза", "Paused"); }
            else if (command === "play") {
                if (current && !gate.authorize("playback", permissionId(current)).ok) { challenge("playback", permissionId(current), function () { playbackCommand("play"); }); return true; }
                pendingPaused = false;
                if (pendingPlayable) { var playable = pendingPlayable; pendingPlayable = null; startResolved(playable, resolveEpoch); }
                else if (!resolving) media.play();
            }
            else if (command === "stop") { stopPlayback(); showHome(); }
            else if (command === "left" || command === "right" || command === "rewind" || command === "fastForward") {
                if (!resolving && !pendingPlayable) media.seek(Math.max(0, snapshot.position + (command === "left" || command === "rewind" ? -15 : 15)));
            }
            else if (command === "volumeUp" || command === "volumeDown") { persist(function (s) { s.settings.volume = Math.max(0, Math.min(1, s.settings.volume + (command === "volumeUp" ? 0.05 : -0.05))); }); media.volume(saved.settings.volume); }
            else if (command === "mute") { persist(function (s) { s.settings.muted = !s.settings.muted; }); media.mute(saved.settings.muted); }
            else if (command === "channelUp" || command === "channelDown") {
                var live = catalog(false).filter(function (entry) { return entry.kind !== "vod" && entry.kind !== "folder"; });
                for (i = 0; i < live.length; i++) if (current && live[i].id === current.id) index = i;
                if (live.length) play(live[environment.OttPlayCore.playbackChannelIndex(index, live.length, command === "channelUp" ? 1 : -1, "browser")], false);
            } else if (/^digit[0-9]$/.test(command || "")) {
                if (current && (current.kind === "vod" || current.kind === "archive")) {
                    if (!resolving && !pendingPlayable && isFinite(snapshot.duration) && snapshot.duration > 0) media.seek(snapshot.duration * Number(command.slice(-1)) / 10);
                    showOSD(); return true;
                }
                keyDigits = (keyDigits + command.slice(-1)).slice(-5); environment.clearTimeout(digitTimer); view.toast(keyDigits);
                digitTimer = environment.setTimeout(function () { if (destroyed) return; var number = parseInt(keyDigits, 10); keyDigits = ""; var numbered = catalog(false).filter(function (entry) { return entry.kind !== "vod" && entry.kind !== "folder"; }); if (number > 0 && numbered[number - 1]) play(numbered[number - 1], false); }, 1200);
            } else return false;
            showOSD(); return true;
        }
        function consumeKey(event) { if (event.preventDefault) event.preventDefault(); event.returnValue = false; }
        function releaseControl(code) {
            if (heldControls[code]) environment.clearTimeout(heldControls[code].timer);
            delete heldControls[code];
        }
        function repeatedControl(event, code) {
            var repeated = event.repeat || !!heldControls[code];
            if (code) {
                releaseControl(code);
                var held = {};
                heldControls[code] = held;
                // Remote profiles recover from a missing release after a quiet gap.
                // Desktop keyboards keep strict release tracking for held keys.
                if (profile.keyReleaseTimeout) held.timer = environment.setTimeout(function () {
                    if (heldControls[code] === held) delete heldControls[code];
                }, profile.keyReleaseTimeout);
            }
            return repeated;
        }
        function onKeyUp(event) {
            event = event || environment.event || {};
            releaseControl(devices.keyCode(event));
            if (devices.normalize(event, profile) === "exit") { nativeEscapePending = false; environment.clearTimeout(escapeTimer); }
        }
        function onBlur() {
            for (var code in heldControls) if (Object.prototype.hasOwnProperty.call(heldControls, code)) releaseControl(code);
        }
        function scrollDescription(node, command) {
            var top = node.scrollTop || 0, left = node.scrollLeft || 0;
            var maxTop = Math.max(0, (node.scrollHeight || 0) - (node.clientHeight || 0));
            var maxLeft = Math.max(0, (node.scrollWidth || 0) - (node.clientWidth || 0));
            var page = Math.max(40, Math.round((node.clientHeight || 240) * 0.9));
            if (command === "up") top -= 40;
            else if (command === "down") top += 40;
            else if (command === "left") left -= 40;
            else if (command === "right") left += 40;
            else if (command === "pageUp") top -= page;
            else if (command === "pageDown") top += page;
            else if (command === "home") top = 0;
            else if (command === "end") top = maxTop;
            else return false;
            node.scrollTop = Math.max(0, Math.min(maxTop, top));
            node.scrollLeft = Math.max(0, Math.min(maxLeft, left));
            return true;
        }
        function onKey(event) {
            if (destroyed) return;
            event = event || environment.event;
            if (!event) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            var active = d.activeElement, editing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable || (active.getAttribute && active.getAttribute("contenteditable") === "true")), command = devices.normalize(event, profile);
            if (!command) return;
            startupRestore = null;
            if (editing && ["back", "exit", "ok", "tab"].indexOf(command) === -1) return;
            if (command === "exit" || command === "quit" || command === "fullscreen" || command === "info") {
                consumeKey(event);
                var code = devices.keyCode(event);
                if (repeatedControl(event, code)) return;
                if (command === "quit") exitPlayer();
                else if (command === "exit") {
                    if (isFullscreen() || fullscreenPending || nativeEscapePending) { nativeEscapePending = false; exitFullscreen(); }
                    else if (view.hasDialog()) view.command("back", event);
                    else requestQuit();
                } else if (!view.hasDialog()) {
                    if (command === "fullscreen") toggleFullscreen();
                    else if (homeVisible) view.command("info", event);
                    else advanceInfo();
                }
                return;
            }
            // Profile navigation scrolls the description even when a remote code
            // has no native browser scrolling behavior.
            if (active && active.id === "player-description" && playbackInfo.isExpanded() && !view.hasDialog() &&
                scrollDescription(active, command)) { consumeKey(event); return; }
            if (["playPause", "play", "pause", "stop", "mute", "pip", "previousChannel", "audio", "subtitle", "aspect", "zoom"].indexOf(command) !== -1 && repeatedControl(event, devices.keyCode(event))) { consumeKey(event); return; }
            if (command === "guide" && !editing && !view.hasDialog()) {
                consumeKey(event);
                if (repeatedControl(event, devices.keyCode(event))) return;
                homeVisible = true; exitFullscreen(); action("screen", "guide");
                if (view.setMenuOpen) view.setMenuOpen(false);
                return;
            }
            var handled = view.command(command, event);
            if (!handled && !editing && (!homeVisible || ["play", "pause", "playPause", "stop", "volumeUp", "volumeDown", "mute", "previousChannel", "audio", "subtitle", "aspect", "zoom", "pip"].indexOf(command) !== -1)) handled = playbackCommand(command);
            if (handled) consumeKey(event);
        }
        d.getElementById("player-home").onclick = showHome;
        d.getElementById("player-pause").onclick = function () { playbackCommand("playPause"); };
        d.getElementById("player-stop").onclick = function () { playbackCommand("stop"); };
        d.getElementById("player-fullscreen").onclick = toggleFullscreen;
        if (d.getElementById("player-options")) d.getElementById("player-options").onclick = playbackView.open;
        if (d.getElementById("player-engines")) d.getElementById("player-engines").onclick = playbackView.openEngines;
        video.onclick = function () {
            if (destroyed || view.hasDialog()) return;
            if (homeVisible && current && (screen === "tv" || screen === "favorites")) resumePlayback();
            else showHome();
            if (view.setMenuOpen) view.setMenuOpen(false);
        };
        if (root.addEventListener) root.addEventListener("scroll", syncPlaybackPreview, true);
        if (environment.addEventListener) { environment.addEventListener("keydown", onKey, true); environment.addEventListener("keyup", onKeyUp, true); environment.addEventListener("blur", onBlur, false); environment.addEventListener("resize", render, false); }
        else { environment.onkeydown = onKey; environment.onkeyup = onKeyUp; environment.onblur = onBlur; }
        if (d.addEventListener) fullscreenEvents.forEach(function (name) { d.addEventListener(name, fullscreenChanged, false); });
        if (environment.addEventListener) { environment.addEventListener("pagehide", flushBookmark, false); environment.addEventListener("beforeunload", flushBookmark, false); }
        if (d.addEventListener) { d.addEventListener("visibilitychange", visibilityChanged, false); d.addEventListener("webkitvisibilitychange", visibilityChanged, false); }
        if (video.addEventListener) { video.addEventListener("webkitbeginfullscreen", fullscreenChanged, false); video.addEventListener("webkitendfullscreen", fullscreenChanged, false); }
        fullscreenState = isFullscreen();
        function checkReminders() {
            if (destroyed) return;
            refreshGuideIfDue();
            var now = Date.now() / 1000;
            saved.reminders.forEach(function (entry) { if (entry.start <= now && entry.end > now && !notifiedReminders[entry.id]) { notifiedReminders[entry.id] = true; view.toast(t("Сейчас: ", "Starting now: ") + entry.title); } });
            if (guide && homeVisible && !view.hasDialog()) render();
            else updatePlaybackInfo();
            reminderTimer = environment.setTimeout(checkReminders, 30000);
        }
        checkReminders();
        render();
        if (!repository.status().persistent) view.toast(t("Хранилище недоступно. Изменения останутся в этой сессии.", "Storage is unavailable. Changes remain in this session."));
        startupRestore = startupChannel();
        if (startupRestore) loadSource(source(startupRestore.sourceId), startupRestore);
        else if (saved.activeSourceId) loadSource(source(saved.activeSourceId));
        function destroy() {
            if (destroyed) return;
            saveBookmark(); gate.lock(); destroyed = true; browseEpoch++; if (cancelBrowse) cancelBrowse(); environment.clearTimeout(reminderTimer); sourceEpoch++; guideRefresh.destroy(); resolveEpoch++;
            if (cancelSource) cancelSource(); if (cancelGuide) cancelGuide(); if (cancelResolve) cancelResolve();
            if (fileReader) { fileReader.onload = null; fileReader.onerror = null; try { fileReader.abort(); } catch (ignore) {} fileReader = null; }
            exitFullscreen(); if (providers.close) saved.sources.forEach(function (entry) { providers.close(entry.id); }); media.destroy(); if (typeof stopDevices === "function") stopDevices();
            environment.clearTimeout(sleepTimer); environment.clearTimeout(digitTimer); environment.clearTimeout(escapeTimer); onBlur(); playbackInfo.destroy();
            for (var i = 0; i < downloadTimers.length; i++) environment.clearTimeout(downloadTimers[i]);
            if (environment.URL && environment.URL.revokeObjectURL) for (i = 0; i < downloadUrls.length; i++) environment.URL.revokeObjectURL(downloadUrls[i]);
            if (environment.removeEventListener) { environment.removeEventListener("keydown", onKey, true); environment.removeEventListener("keyup", onKeyUp, true); environment.removeEventListener("blur", onBlur, false); environment.removeEventListener("resize", render, false); }
            else { if (environment.onkeydown === onKey) environment.onkeydown = previousKeydown; if (environment.onkeyup === onKeyUp) environment.onkeyup = previousKeyup; if (environment.onblur === onBlur) environment.onblur = previousBlur; }
            if (d.removeEventListener) fullscreenEvents.forEach(function (name) { d.removeEventListener(name, fullscreenChanged, false); });
            if (environment.removeEventListener) { environment.removeEventListener("pagehide", flushBookmark, false); environment.removeEventListener("beforeunload", flushBookmark, false); }
            if (d.removeEventListener) { d.removeEventListener("visibilitychange", visibilityChanged, false); d.removeEventListener("webkitvisibilitychange", visibilityChanged, false); }
            if (guideLookup) guideLookup.clear();
            decoratedCatalog = decoratedSource = null; playbackPreferences.reset();
            if (video.removeEventListener) { video.removeEventListener("webkitbeginfullscreen", fullscreenChanged, false); video.removeEventListener("webkitendfullscreen", fullscreenChanged, false); }
            ["player-home", "player-pause", "player-stop", "player-fullscreen"].forEach(function (id) { d.getElementById(id).onclick = null; }); if (d.getElementById("player-options")) d.getElementById("player-options").onclick = null; if (d.getElementById("player-engines")) d.getElementById("player-engines").onclick = null; video.onclick = null;
            if (root.removeEventListener) root.removeEventListener("scroll", syncPlaybackPreview, true);
            if (typeof view.destroy === "function") view.destroy(); else view.closeDialog();
        }
        return { destroy: destroy, snapshot: buildModel };
    }
    return { start: start };
});
