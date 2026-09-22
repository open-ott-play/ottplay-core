OTT2.define("view", function (require) {
    "use strict";
    function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
    function create(options) {
        var d = options.document, root = options.root, model, focused = "menu-toggle", modal = null, toastTimer, returnFocus = "menu-toggle", selectedId = "";
        var menuOpen = false, menuReturnFocus = "menu-toggle";
        var renderedStructure = "", rowSnapshots = [], detailSnapshot = null;
        var wheelTotal = 0, wheelTime = 0, wheelPageTime = -1000, wheelType = "", wheelDirection = 0, wheelHandled = false;
        var keyboard = require("keyboard").create({ document: d, focus: focus });
        var autoScroll = require("auto-scroll").create({ document: d, environment: options.environment, isActive: function () { return model && model.homeVisible && isChannelBrowser() && !modal && !menuOpen && focused !== "channel-details" && !keyboard.isOpen(); } });
        function t(ru, en) { return model && model.settings.language === "ru" ? ru : en; }
        function btn(id, action, title, value, style) {
            return '<button type="button" id="' + id + '" data-action="' + action + '" data-value="' + esc(value || "") + '" class="f2-button ' + (style || "") + '">' + title + '</button>';
        }
        function clock(seconds) { var date = new Date(seconds == null ? Date.now() : seconds * 1000); return ("0" + date.getHours()).slice(-2) + ":" + ("0" + date.getMinutes()).slice(-2); }
        function safeLogo(value) {
            return typeof value === "string" && value.length <= 8192 && /^https?:\/\/[^\/\s?#]+(?:[\/?#]|$)/i.test(value) && !/[\x00-\x20\x7f]/.test(value) ? value : "";
        }
        function logoUrl(channel) { return safeLogo(model.logosById && model.logosById[channel.id]) || safeLogo(channel.logo); }
        function logo(channel) {
            var url = logoUrl(channel);
            return '<span class="f2-channel-logo" aria-hidden="true">' + (url ? '<img src="' + esc(url) + '" alt="">' : '') + '</span>';
        }
        function hideBrokenLogo() { this.style.visibility = "hidden"; this.onerror = null; }
        function bindLogos() {
            var images = root.querySelectorAll(".f2-channel-logo img");
            for (var i = 0; i < images.length; i++) {
                images[i].onerror = hideBrokenLogo;
                if (images[i].complete && images[i].naturalWidth === 0) hideBrokenLogo.call(images[i]);
            }
        }
        function field(id, title, value, type) {
            return '<label class="f2-field" for="' + id + '"><span>' + esc(title) + '</span><input id="' + id + '" type="' + (type || "text") + '" value="' + esc(value || "") + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label>';
        }
        function header() {
            var nav = [["tv", "TV", t("Телевидение", "Television")], ["favorites", "★", t("Избранное", "Favorites")], ["guide", "EPG", t("Программа", "TV guide")], ["vod", "▶", t("Видеотека", "Video library")], ["sources", "+", t("Источники", "Sources")], ["settings", "…", t("Настройки", "Settings")]];
            var html = '<div id="f2-sidebar" class="f2-sidebar" style="display:' + (menuOpen ? 'block' : 'none') + '" aria-hidden="' + (menuOpen ? 'false' : 'true') + '"><div class="f2-brand">ott<span>play</span><div class="f2-edition">FOSS / 02</div></div><nav class="f2-nav" aria-label="' + t("Разделы", "Sections") + '">';
            for (var i = 0; i < nav.length; i++) html += btn("nav-" + nav[i][0], "screen", '<span class="f2-icon" aria-hidden="true">' + nav[i][1] + '</span><span class="f2-nav-label">' + nav[i][2] + '</span>', nav[i][0], model.screen === nav[i][0] ? "f2-active" : "");
            html += '</nav><div class="f2-side-note"><span class="f2-status-dot"></span>' + t(" Профиль устройства", " Device profile") + '<strong>' + esc(model.device.label || model.device.id) + '</strong>OTT-play FOSS 2</div></div>';
            return html;
        }
        function hero() {
            return '<div class="f2-hero"><h2 class="f2-hero-title">' + t("Подключите свой плейлист", "Connect your playlist") + '</h2><p class="f2-hero-copy">' +
                t("Добавьте M3U, Xtream или портал. Каналы и телепрограмма появятся здесь.", "Add M3U, Xtream or a portal. Your channels and programme guide will appear here.") + '</p><div class="f2-actions">' +
                btn("connect", "addSource", t("Добавить источник", "Add source"), "", "f2-primary") + btn("import", "import", t("Импорт настроек", "Import settings")) + '</div></div>';
        }
        function empty(title, detail) { return '<div class="f2-empty"><strong>' + esc(title) + '</strong><p>' + esc(detail) + '</p></div>'; }
        function epgStatus() { return model.epgStatus ? '<p id="f2-epg-status" class="f2-epg-status" role="status">' + esc(model.epgStatus) + '</p>' : ''; }
        function isChannelBrowser() { return model && (model.screen === "tv" || model.screen === "favorites"); }
        function rootClass() { return (isChannelBrowser() ? "f2-compact-tv" : "") + (menuOpen ? " f2-menu-open" : ""); }
        function channelFilters() {
            if (!model.channels.length) return "";
            return btn("search", "search", t("Поиск", "Search") + (model.query ? ": " + esc(model.query) : "")) + btn("groups", "groups", esc(model.group || t("Все группы", "All groups"))) +
                (model.group ? btn("edit-current-group", "editGroup", t("Изменить группу", "Edit group"), model.group) : "") + (model.screen === "favorites" ? btn("lists", "favoriteLists", esc(model.activeFavorites)) : "");
        }
        function heading(title) {
            var compact = isChannelBrowser(), label = compact && model.screen === "tv" ? t("Каналы", "Channels") : t(title[0], title[1]);
            return '<div class="f2-heading"><button type="button" id="menu-toggle" class="f2-button" data-action="toggleMenu" aria-controls="f2-sidebar" aria-expanded="' + (menuOpen ? 'true' : 'false') + '">' + t("Меню", "Menu") + '</button>' + (compact ? '<div id="f2-heading-tools" class="f2-heading-scroll">' : '') +
                '<h1 class="f2-title">' + label + (compact ? '<span class="f2-count">' + model.filteredTotal + '</span>' : '') + '</h1>' + (compact ? '<span id="f2-header-page" class="f2-header-page" aria-label="' + t("Страница", "Page") + '">' + (model.page + 1) + ' / ' + Math.max(1, Math.ceil(model.filteredTotal / (model.pageSize || 12))) + '</span><span class="f2-header-filters">' + channelFilters() + '</span>' : '') +
                '<p class="f2-subtitle">' + esc(model.loading ? t("Загрузка…", "Loading…") : model.sourceName || "OTT-play 2") + '</p>' + (compact ? epgStatus() + '</div>' : '') + '<time class="f2-clock">' + clock() + '</time></div>';
        }
        function fitHeader() {
            var tools = d.getElementById("f2-heading-tools"), status = tools && d.getElementById("f2-epg-status");
            if (status) {
                status.style.display = "";
                if (tools.clientWidth && tools.scrollWidth > tools.clientWidth) status.style.display = "none";
            }
        }
        function syncAutoScroll() {
            var channel = selectedChannel(), current = channel && model.nowById && model.nowById[channel.id], panel = d.getElementById("f2-selected-info");
            var key = JSON.stringify([channel ? channel.id : "", current ? current.start : "", current ? current.title : "", current ? current.description : ""]);
            autoScroll.update(panel, key, !!(model && model.homeVisible && isChannelBrowser() && !modal && !menuOpen && focused !== "channel-details" && panel && panel.clientHeight && panel.scrollHeight > panel.clientHeight + 1));
        }
        function rowIndexFor(id) {
            for (var i = 0; model && model.rows && i < model.rows.length; i++) if (model.rows[i].id === id) return i;
            return -1;
        }
        function selectedChannel() {
            var index = rowIndexFor(selectedId);
            return index >= 0 ? model.rows[index] : null;
        }
        function detailContent() {
            var channel = selectedChannel(), current = channel && model.nowById && model.nowById[channel.id], next = channel && model.nextById && model.nextById[channel.id];
            if (!channel) return "";
            return '<div class="f2-selected-heading"><span class="f2-detail-label">' + t("Выбранный канал", "Selected channel") + '</span>' + btn("channel-details", "channel", t("Инфо", "Info"), channel.id) + '<h2 id="f2-selected-channel">' + esc(channel.name) + '</h2></div>' +
                '<div class="f2-current-programme"><span class="f2-detail-label">' + t("Сейчас", "Now") + '</span><span id="f2-selected-time" class="f2-detail-time">' + (current ? clock(current.start) + "–" + clock(current.end) : '') + '</span>' +
                '<h3 id="f2-selected-programme">' + esc(current ? current.title : t("Нет информации о программе", "No programme information")) + '</h3><p id="f2-selected-description">' + esc(current && current.description ? current.description : current ? t("Описание отсутствует.", "No description available.") : t("Телепрограмма для этого канала пока недоступна.", "The programme guide for this channel is not available yet.")) + '</p></div>' +
                '<div id="f2-selected-next" class="f2-selected-next"><span class="f2-detail-label">' + t("Далее", "Next") + '</span><p>' + (next ? '<span class="f2-detail-time">' + clock(next.start) + '</span> ' + esc(next.title) : t("Нет информации о следующей программе", "No next programme information")) + '</p></div>';
        }
        function setText(node, value) {
            if (!node) return;
            value = String(value == null ? "" : value);
            if (node.textContent === value) return;
            while (node.firstChild) node.removeChild(node.firstChild);
            node.appendChild(d.createTextNode(value));
        }
        function refreshDetail() {
            var channel = selectedChannel(), current = channel && model.nowById && model.nowById[channel.id], next = channel && model.nextById && model.nextById[channel.id];
            if (!channel) return false;
            var values = [channel.id, channel.name, current ? clock(current.start) + "–" + clock(current.end) : "",
                current ? current.title : t("Нет информации о программе", "No programme information"),
                current && current.description ? current.description : current ? t("Описание отсутствует.", "No description available.") : t("Телепрограмма для этого канала пока недоступна.", "The programme guide for this channel is not available yet."),
                next ? '<span class="f2-detail-time">' + clock(next.start) + '</span> ' + esc(next.title) : t("Нет информации о следующей программе", "No next programme information")];
            var changed = JSON.stringify(values), button = d.getElementById("channel-details"), nextNode = d.getElementById("f2-selected-next");
            if (detailSnapshot === changed) return false;
            if (button) button.setAttribute("data-value", channel.id);
            setText(d.getElementById("f2-selected-channel"), values[1]);
            setText(d.getElementById("f2-selected-time"), values[2]);
            setText(d.getElementById("f2-selected-programme"), values[3]);
            setText(d.getElementById("f2-selected-description"), values[4]);
            if (nextNode && nextNode.querySelector("p")) {
                nextNode = nextNode.querySelector("p");
                if (nextNode._ott2Markup !== values[5]) { nextNode.innerHTML = values[5]; nextNode._ott2Markup = values[5]; }
            }
            detailSnapshot = changed;
            return true;
        }
        function channelDetail() {
            var playing = model.currentChannel;
            return '<aside id="f2-channel-detail" class="f2-channel-detail" aria-label="' + t("Предпросмотр и телепрограмма", "Preview and programme guide") + '"><div id="f2-preview-slot" class="f2-preview-slot" aria-hidden="true"><span>' + (playing ? '' : t("Выберите канал для просмотра", "Choose a channel to watch")) + '</span></div>' +
                '<div class="f2-playing-line"><span id="f2-preview-state" class="f2-preview-state" role="status"></span>' + (playing ? '<span id="f2-now-playing">' + t("Смотрим: ", "Watching: ") + esc(playing.name) + '</span>' + btn("resume-playback", "resumePlayback", t("К просмотру", "Resume")) : '<span id="f2-now-playing">' + t("OK — смотреть выбранный канал", "OK to watch the selected channel") + '</span>') + '</div>' +
                '<div id="f2-selected-info" aria-live="polite" aria-atomic="true">' + detailContent() + '</div></aside>';
        }
        function fitDetail() {
            var panel = d.getElementById("f2-channel-detail"), info = d.getElementById("f2-selected-info"), description = d.getElementById("f2-selected-description");
            if (!panel || !info || !description) return;
            var infoOffset = info.scrollTop;
            var preview = d.getElementById("f2-preview-slot"), panelStyle = panel.currentStyle;
            if (!panelStyle && d.defaultView && d.defaultView.getComputedStyle) panelStyle = d.defaultView.getComputedStyle(panel, null);
            if (preview) {
                preview.style.width = ""; preview.style.height = ""; preview.style.paddingBottom = "";
                if (panelStyle && panelStyle.position === "absolute" && panel.clientHeight && panel.clientWidth) {
                    // Reserve room for channel, controls, a two-line title and
                    // description. Keep a 16:9 preview independent of selection.
                    var panelTextSize = /px$/.test(panelStyle.fontSize) ? parseFloat(panelStyle.fontSize) : 0;
                    var previewLimit = panelTextSize ? panel.clientHeight - panelTextSize * 16 : panel.clientHeight * 0.36;
                    var previewWidth = Math.floor(Math.min(panel.clientWidth, Math.max(60, previewLimit) * 16 / 9));
                    preview.style.width = previewWidth + "px";
                    preview.style.height = previewWidth * 9 / 16 + "px";
                    preview.style.paddingBottom = "0";
                }
            }
            // Keep the complete guide in one scrollport below the fixed preview.
            info.style.height = "";
            if (panelStyle && panelStyle.position === "absolute" && panel.clientHeight) {
                info.style.height = Math.max(0, panel.getBoundingClientRect().bottom - info.getBoundingClientRect().top - 1) + "px";
            }
            // Clearing the height temporarily removes this scrollport in real
            // browsers. Restore its position after the final geometry is set.
            info.scrollTop = infoOffset;
        }
        function updateSelection(id) {
            if (!isChannelBrowser() || rowIndexFor(id) < 0) return;
            var panel = d.getElementById("f2-selected-info");
            var offset = panel && selectedId === id ? panel.scrollTop : 0;
            selectedId = id;
            if (panel) { if (refreshDetail()) fitDetail(); panel.scrollTop = offset; syncAutoScroll(); }
        }
        function focusChannel(id, fallbackRowIndex) {
            if (!model || !model.rows || !model.rows.length) return;
            var index = rowIndexFor(id);
            if (index < 0) index = Math.max(0, Math.min(model.rows.length - 1, Number(fallbackRowIndex) || 0));
            focus("channel-" + index, true);
        }
        function previewRect() {
            var slot = d.getElementById("f2-preview-slot");
            if (!slot || !model.homeVisible || !slot.offsetWidth || !slot.offsetHeight) return null;
            var rect = slot.getBoundingClientRect(), viewport = d.documentElement, main = root.querySelector(".f2-main"), bounds = main && main.getBoundingClientRect();
            if (rect.bottom <= rect.top || rect.right <= rect.left) return null;
            if (viewport.clientWidth && (rect.left < 0 || rect.right > viewport.clientWidth)) return null;
            if (viewport.clientHeight && (rect.top < 0 || rect.bottom > viewport.clientHeight)) return null;
            if (bounds && main.scrollHeight > main.clientHeight && (rect.top < bounds.top || rect.bottom > bounds.bottom)) return null;
            return { left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
        }
        function channelPage(page, rowIndex) {
            var size = model.pageSize || 12, target = Math.max(0, Math.min(Math.ceil(model.filteredTotal / size) - 1, page));
            if (target !== model.page) {
                options.onAction("channelPage", String(target), { rowIndex: rowIndex });
                focusChannel("", rowIndex);
            }
        }
        function rowSnapshot(row) {
            var current = model.nowById[row.id], next = model.nextById && model.nextById[row.id];
            var caption = current ? current.title : (row.kind === "folder" ? t("Открыть раздел", "Open folder") : row.kind === "vod" ? t("Видео по запросу", "Video on demand") : t("Прямой эфир", "Live broadcast"));
            var progress = current ? Math.max(0, Math.min(100, Math.round((Date.now() / 1000 - current.start) / Math.max(1, current.end - current.start) * 100))) : 0;
            return { key: JSON.stringify([caption, current && current.start, current && current.end]), logo: logoUrl(row), progress: progress,
                programme: (current ? '<span class="f2-program-time">' + clock(current.start) + '</span>' : '') + '<span class="f2-program-title">' + esc(caption) + '</span>' + (current ? '<span class="f2-progress"><span style="width:' + progress + '%"></span></span>' : ''),
                next: next ? '<span class="f2-program-time">' + clock(next.start) + '</span>' + esc(next.title) : '—' };
        }
        function channels() {
            var size = model.pageSize || 12, isLibrary = model.screen === "vod", html = model.screen === "vod" && model.breadcrumbs && model.breadcrumbs.length ? '<div class="f2-toolbar">' + btn("browse-back", "browseBack", t("Назад к разделам", "Back to folders")) + '<span>' + esc(model.breadcrumbs[model.breadcrumbs.length - 1].node.name) + '</span></div>' : "";
            if (!model.channels.length && model.screen === "tv" && !model.loading) return hero();
            if (isLibrary) html += '<div class="f2-channel-tools"><span class="f2-section-title">' + t("Фильмы и сериалы", "Movies and series") + '<span class="f2-count">' + model.filteredTotal + '</span></span><div class="f2-toolbar">' + channelFilters() + '</div></div>';
            if (!model.rows.length) return html + empty(model.loading ? t("Загружаем источник…", "Loading source…") : t("Каналы не найдены", "No channels found"), model.screen === "favorites" ? t("Откройте канал и добавьте его в избранное.", "Open a channel and add it to Favorites.") : t("Проверьте группу и поиск или добавьте другой источник.", "Check the group and search, or add another source."));
            if (!isLibrary) html += '<div class="f2-channel-browser" style="min-height:' + size + 'em"><div class="f2-channel-list">';
            if (isLibrary) html += '<div class="f2-list-heading f2-vod-list" aria-hidden="true"><span class="f2-channel-number">#</span><span class="f2-channel-name">' + t("Название", "Title") + '</span><span class="f2-program">' + t("Тип", "Type") + '</span></div>';
            html += '<div id="f2-channels"' + (isLibrary ? ' class="f2-vod-list"' : '') + '>';
            for (var i = 0; i < model.rows.length; i++) {
                var row = model.rows[i], snapshot = rowSnapshot(row);
                rowSnapshots.push(snapshot);
                html += btn("channel-" + i, row.kind === "vod" || row.kind === "folder" ? "channel" : "play", '<span class="f2-channel-number">' + (model.page * size + i + 1) + '</span><span class="f2-channel-name f2-channel-identity">' + logo(row) + esc(row.name) + '</span><span class="f2-program">' + snapshot.programme + '</span><span class="f2-next">' + snapshot.next + '</span>', row.id, "f2-channel" + (model.currentChannel && model.currentChannel.id === row.id ? " f2-playing" : ""));
            }
            html += '</div>';
            if (isLibrary) html += '<div class="f2-pages">' + (model.page > 0 ? btn("prev", "page", t("Назад", "Previous"), String(model.page - 1)) : "") + '<span>' + (model.page + 1) + " / " + Math.max(1, Math.ceil(model.filteredTotal / size)) + '</span>' + (model.page * size + size < model.filteredTotal ? btn("next", "page", t("Дальше", "Next"), String(model.page + 1)) : "") + '</div>';
            if (!isLibrary) html += '</div>' + channelDetail() + '</div>';
            return html;
        }
        function sources() {
            var html = '<div class="f2-toolbar">' + btn("add-source", "addSource", t("Добавить источник", "Add source"), "", "f2-primary") + '</div>';
            if (!model.sources.length) html += empty(t("Ваши источники", "Your sources"), t("Добавьте URL, вставьте M3U-текст или выберите локальный файл.", "Add a URL, paste M3U text or select a local file."));
            for (var i = 0; i < model.sources.length; i++) {
                var source = model.sources[i];
                html += '<div class="f2-source"><strong>' + esc(source.name) + '</strong><p>' + esc(source.type.toUpperCase()) + (source.id === model.activeSourceId ? " · " + t("выбран", "selected") : "") + '</p>' + btn("source-" + i, "loadSource", t("Открыть", "Open"), source.id) + btn("edit-" + i, "editSource", t("Изменить", "Edit"), source.id) + btn("remove-" + i, "deleteSource", t("Удалить", "Delete"), source.id) + '</div>';
            }
            return html;
        }
        function settings() {
            var html = '<div class="f2-settings"><h2>' + t("Воспроизведение", "Playback") + '</h2><div class="f2-toolbar">' + btn("engines", "engines", t("Движок плеера", "Player engine") + ': ' + esc(model.playerEngineLabel || t("Авто", "Auto"))) + '</div><h2>' + t("Шрифт интерфейса", "Interface font") + '</h2><div class="f2-font-list">';
            var fonts = ["system", "Roboto", "RobotoCondensed", "Caveat", "Liberation", "Gabriela", "PTSansNarrow"];
            for (var i = 0; i < fonts.length; i++) html += btn("font-" + i, "font", esc(fonts[i] === "system" ? t("Системный", "System") : fonts[i]) + (model.settings.fontFamily === fonts[i] ? " ✓" : ""), fonts[i]);
            html += '</div><h2>' + t("Размер и язык", "Size and language") + '</h2><div class="f2-toolbar">';
            var scales = [0.85, 1, 1.15, 1.3];
            for (i = 0; i < scales.length; i++) html += btn("scale-" + i, "scale", String(Math.round(scales[i] * 100)) + "%" + (model.settings.fontScale === scales[i] ? " ✓" : ""), String(scales[i]));
            html += btn("lang-en", "language", "English" + (model.settings.language === "en" ? " ✓" : ""), "en") + btn("lang-ru", "language", "Русский" + (model.settings.language === "ru" ? " ✓" : ""), "ru") + '</div><h2>' + t("Телепрограмма и данные", "Programme guide and data") + '</h2><div class="f2-toolbar">' +
                btn("epg-url", "epgSource", "XMLTV / EPG") + btn("export", "export", t("Экспорт", "Export")) + btn("import-settings", "import", t("Импорт", "Import")) + btn("sleep", "sleep", t("Таймер сна", "Sleep timer")) + btn("history", "history", t("История", "History")) + btn("reminders", "reminders", t("Напоминания", "Reminders")) + btn("preferences", "preferences", t("Поведение", "Preferences")) + btn("security", "security", t("Родительский контроль", "Parental control")) + btn("hidden-channels", "hiddenChannels", t("Скрытые каналы", "Hidden channels")) + '</div><p class="f2-help">' +
                t("Настройки сохраняются на этом устройстве. Вы можете экспортировать резервную копию в любое время.", "Your settings are saved on this device. You can export a backup at any time.") + '</p></div>';
            return html;
        }
        function guide() {
            var html = '<div class="f2-toolbar">' + btn("guide-source", "epgSource", t("Источник XMLTV", "XMLTV source")) + btn("guide-refresh", "refreshEPG", t("Обновить", "Refresh")) + btn("guide-search", "search", t("Поиск каналов", "Search channels")) + btn("guide-groups", "groups", t("Группы", "Groups")) + btn("guide-reminders", "reminders", t("Напоминания", "Reminders")) + '</div>' + epgStatus();
            if (!model.guideRows.length) return html + empty(t("Нет данных телепрограммы", "No programme data"), t("Подключите XMLTV-файл с tvg-id, совпадающими с каналами плейлиста.", "Connect an XMLTV file with matching playlist tvg-id values."));
            for (var i = 0; i < model.guideRows.length; i++) {
                var item = model.guideRows[i];
                html += btn("guide-" + i, "programme", '<span class="f2-guide-time">' + clock(item.programme.start) + "–" + clock(item.programme.end) + '</span><span class="f2-guide-description"><strong>' + esc(item.programme.title) + '</strong><small class="f2-channel-identity">' + logo(item.channel) + esc(item.channel.name) + '</small></span>', String(i), "f2-guide-row");
            }
            if (model.guideTotal > 30) html += '<div class="f2-pages">' + (model.guidePage > 0 ? btn("guide-prev", "guidePage", t("Назад", "Previous"), String(model.guidePage - 1)) : "") + '<span>' + (model.guidePage + 1) + ' / ' + Math.ceil(model.guideTotal / 30) + '</span>' + ((model.guidePage + 1) * 30 < model.guideTotal ? btn("guide-next", "guidePage", t("Дальше", "Next"), String(model.guidePage + 1)) : "") + '</div>';
            return html;
        }
        function channelStructure(next) {
            if (!next || (next.screen !== "tv" && next.screen !== "favorites") || !next.rows || !next.rows.length) return "";
            var parts = [next.screen, next.page, next.pageSize, next.filteredTotal, next.activeSourceId, next.sourceName,
                next.query, next.group, next.loading, next.activeFavorites, next.homeVisible, next.channels.length,
                next.settings.language, next.settings.fontFamily, next.settings.fontScale, next.settings.accent,
                next.device.id, next.device.label, next.currentChannel && next.currentChannel.id, next.currentChannel && next.currentChannel.name];
            for (var i = 0; i < next.rows.length; i++) parts.push([next.rows[i].id, next.rows[i].name, next.rows[i].kind]);
            return JSON.stringify(parts);
        }
        function refreshChannels() {
            var nodes = [], i, node, snapshot, previous, logoNode, image, progress;
            if (!d.getElementById("f2-selected-info") || rowSnapshots.length !== model.rows.length) return false;
            for (i = 0; i < model.rows.length; i++) {
                node = d.getElementById("channel-" + i);
                if (!node || !node.querySelector(".f2-program") || !node.querySelector(".f2-next") || !node.querySelector(".f2-channel-logo")) return false;
                nodes.push(node);
            }
            for (i = 0; i < nodes.length; i++) {
                node = nodes[i]; previous = rowSnapshots[i]; snapshot = rowSnapshot(model.rows[i]);
                if (previous.key !== snapshot.key) node.querySelector(".f2-program").innerHTML = snapshot.programme;
                else if (previous.progress !== snapshot.progress) {
                    progress = node.querySelector(".f2-progress span");
                    if (progress) progress.style.width = snapshot.progress + "%";
                }
                if (previous.next !== snapshot.next) node.querySelector(".f2-next").innerHTML = snapshot.next;
                if (previous.logo !== snapshot.logo) {
                    logoNode = node.querySelector(".f2-channel-logo");
                    logoNode.innerHTML = snapshot.logo ? '<img src="' + esc(snapshot.logo) + '" alt="">' : '';
                    image = logoNode.querySelector("img");
                    if (image) { image.onerror = hideBrokenLogo; if (image.complete && image.naturalWidth === 0) hideBrokenLogo.call(image); }
                }
                rowSnapshots[i] = snapshot;
            }
            var tools = d.getElementById("f2-heading-tools"), status = d.getElementById("f2-epg-status");
            if (model.epgStatus && tools) {
                if (!status) { status = d.createElement("p"); status.id = "f2-epg-status"; status.className = "f2-epg-status"; status.setAttribute("role", "status"); tools.appendChild(status); }
                setText(status, model.epgStatus);
            } else if (status && status.parentNode) status.parentNode.removeChild(status);
            setText(root.querySelector(".f2-clock"), clock());
            refreshDetail(); fitHeader(); fitDetail();
            return true;
        }
        function render(next) {
            var prior = model, priorFocused = focused, priorSelection = selectedId, wasChannel = /^channel-\d+$/.test(focused);
            var structure = channelStructure(next), incremental = structure && structure === renderedStructure;
            var keepScroll = prior && prior.screen === next.screen && prior.page === next.page && prior.guidePage === next.guidePage && prior.activeSourceId === next.activeSourceId && prior.query === next.query && prior.group === next.group;
            // The programme controller owns its own position and resets it when
            // the programme changes, even if the selected channel stays the same.
            var scrollSelectors = [".f2-main", "#f2-sidebar"], scrollPositions = [], scrollIndex, rootScroll = root.scrollTop;
            if (keepScroll) {
                for (scrollIndex = 0; scrollIndex < scrollSelectors.length; scrollIndex++) {
                    var oldScroll = root.querySelector(scrollSelectors[scrollIndex]);
                    scrollPositions.push(oldScroll ? oldScroll.scrollTop : 0);
                }
            }
            model = next;
            if (!model.homeVisible || (prior && prior.screen !== model.screen)) menuOpen = false;
            if (isChannelBrowser() && model.rows && model.rows.length) {
                var requested = model.selectedChannelId || selectedId;
                if (rowIndexFor(requested) < 0 && model.currentChannel) requested = model.currentChannel.id;
                selectedId = rowIndexFor(requested) >= 0 ? requested : model.rows[0].id;
                if (!prior || prior.screen !== model.screen || (model.homeVisible && !prior.homeVisible) || (model.selectedChannelId && model.selectedChannelId !== priorSelection) || wasChannel) focused = "channel-" + rowIndexFor(selectedId);
            }
            var titles = { tv: ["Телевидение", "Television"], favorites: ["Избранное", "Favorites"], guide: ["Телепрограмма", "TV guide"], vod: ["Видеотека", "Video library"], sources: ["Источники", "Sources"], settings: ["Настройки", "Settings"] };
            var title = titles[model.screen] || titles.tv;
            root.className = rootClass();
            if (incremental && refreshChannels()) {
                if (modal) focused = priorFocused;
                else if (model.homeVisible && (!d.activeElement || d.activeElement.id !== focused)) focus(focused, true);
                syncAutoScroll();
                return;
            }
            renderedStructure = structure; rowSnapshots = []; detailSnapshot = null;
            root.innerHTML = header() + '<main class="f2-main">' + heading(title) + '<div id="f2-content">' + (model.screen === "sources" ? sources() : model.screen === "settings" ? settings() : model.screen === "guide" ? guide() : channels()) + '</div></main><div class="f2-footer"><span class="f2-key">↑ ↓</span>' + t("Каналы", "Channels") + '<span class="f2-key">← →</span>' + t(isChannelBrowser() ? "Страница" : "Разделы", isChannelBrowser() ? "Page" : "Sections") + '<span class="f2-key">OK</span>' + t("Выбрать", "Select") + '<span class="f2-key">CH +/−</span>' + t("Страница", "Page") + '<span class="f2-key">MENU</span>' + t("Разделы", "Sections") + (isChannelBrowser() ? '<span class="f2-key">INFO</span>' + t("Описание", "Details") : '') + '<span class="f2-key">BACK</span>' + t("Назад", "Back") + '</div>';
            bindLogos(); refreshDetail(); fitHeader(); fitDetail();
            if (modal) focused = priorFocused;
            else if (model.homeVisible) focus(focused, true);
            if (keepScroll) {
                for (scrollIndex = 0; scrollIndex < scrollSelectors.length; scrollIndex++) {
                    var newScroll = root.querySelector(scrollSelectors[scrollIndex]);
                    if (newScroll) newScroll.scrollTop = scrollPositions[scrollIndex];
                }
                root.scrollTop = rootScroll;
            }
            syncAutoScroll();
        }
        function buttons() {
            var parent = keyboard.panel() || modal || root, elements = parent.querySelectorAll("button, input, select, textarea"), result = [], sidebar = d.getElementById("f2-sidebar");
            for (var i = 0; i < elements.length; i++) if (!elements[i].disabled && elements[i].type !== "hidden" && elements[i].offsetWidth && elements[i].offsetHeight && (menuOpen || !sidebar || !sidebar.contains(elements[i]))) result.push(elements[i]);
            return result;
        }
        function focusContent() {
            var content = d.getElementById("f2-content"), node = content && content.querySelector("button, input, select, textarea");
            focus(node ? node.id : "menu-toggle", true);
        }
        function setMenuOpen(open, restore) {
            if (modal || !model || !model.homeVisible) return;
            open = !!open;
            if (open === menuOpen) return;
            if (open) menuReturnFocus = focused === "menu-toggle" && isChannelBrowser() && rowIndexFor(selectedId) >= 0 ? "channel-" + rowIndexFor(selectedId) : focused;
            menuOpen = open;
            var sidebar = d.getElementById("f2-sidebar"), toggle = d.getElementById("menu-toggle");
            root.className = rootClass();
            if (sidebar) { sidebar.style.display = menuOpen ? "block" : "none"; sidebar.setAttribute("aria-hidden", menuOpen ? "false" : "true"); }
            if (toggle) toggle.setAttribute("aria-expanded", menuOpen ? "true" : "false");
            if (menuOpen) focus("nav-" + model.screen, true);
            else if (restore !== false) focus(menuReturnFocus, true);
            fitHeader(); fitDetail(); syncAutoScroll();
            options.onAction("menuLayout");
        }
        function focus(id, fallback) {
            var node = d.getElementById(id), old = d.getElementById(focused);
            if (!menuOpen && /^nav-/.test(id)) node = d.getElementById("menu-toggle");
            if (keyboard.isOpen() && (!node || !keyboard.panel().contains(node))) node = buttons()[0];
            if ((!node || (modal && !modal.contains(node))) && fallback) node = buttons()[0];
            if (!node) return;
            if (old) old.className = old.className.replace(/\s*f2-focused/g, "");
            focused = node.id; node.className += " f2-focused"; node.focus();
            var tools = d.getElementById("f2-heading-tools");
            if (tools && tools.contains(node)) {
                var buttonRect = node.getBoundingClientRect(), toolsRect = tools.getBoundingClientRect();
                if (buttonRect.left < toolsRect.left + 2) tools.scrollLeft -= toolsRect.left + 2 - buttonRect.left;
                else if (buttonRect.right > toolsRect.right - 2) tools.scrollLeft += buttonRect.right - toolsRect.right + 2;
            }
            var match = /^channel-(\d+)$/.exec(focused);
            if (match && model && model.rows && model.rows[Number(match[1])]) updateSelection(model.rows[Number(match[1])].id);
            else syncAutoScroll();
        }
        function move(direction) {
            var node = d.getElementById(focused), candidates = buttons();
            if (!node) { if (candidates[0]) focus(candidates[0].id); return; }
            var top = root.querySelector(".f2-heading");
            if (!modal && isChannelBrowser() && top && top.contains(node)) {
                if (direction === "down") { focusChannel(selectedId, 0); return; }
                if (direction === "left" || direction === "right") {
                    var controls = top.querySelectorAll("button"), step = direction === "right" ? 1 : -1;
                    for (var c = 0; c < controls.length; c++) if (controls[c] === node) { if (controls[c + step]) focus(controls[c + step].id); return; }
                }
            }
            if (!modal && model.rows && model.rows.length && ["tv", "favorites", "vod"].indexOf(model.screen) !== -1) {
                var rowMatch = /^channel-(\d+)$/.exec(focused), rowIndex = rowMatch ? Number(rowMatch[1]) : -1, size = model.pageSize || 12;
                if (rowIndex >= 0) {
                    if (isChannelBrowser() && (direction === "left" || direction === "right")) { channelPage(model.page + (direction === "right" ? 1 : -1), rowIndex); return; }
                    if (direction === "left") { focus("menu-toggle"); return; }
                    if (direction === "right") return;
                    if (direction === "up" && rowIndex > 0) { focus("channel-" + (rowIndex - 1)); return; }
                    if (direction === "down" && rowIndex + 1 < model.rows.length) { focus("channel-" + (rowIndex + 1)); return; }
                    if (direction === "down" && (model.page + 1) * size < model.filteredTotal) {
                        if (isChannelBrowser()) channelPage(model.page + 1, 0);
                        else { options.onAction("page", String(model.page + 1)); focus("channel-0", true); }
                        return;
                    }
                    if (direction === "up" && model.page > 0) {
                        if (isChannelBrowser()) channelPage(model.page - 1, size - 1);
                        else { options.onAction("page", String(model.page - 1)); focus("channel-" + (model.rows.length - 1), true); }
                        return;
                    }
                    if (isChannelBrowser()) {
                        var boundaryIndex = direction === "up" ? model.filteredTotal - 1 : 0;
                        var boundaryPage = Math.floor(boundaryIndex / size), boundaryRow = boundaryIndex % size;
                        if (boundaryPage === model.page) focusChannel("", boundaryRow);
                        else channelPage(boundaryPage, boundaryRow);
                        return;
                    }
                } else if (direction === "right" && /^nav-/.test(focused)) { setMenuOpen(false, false); focusChannel(selectedId, 0); return; }
                else if (isChannelBrowser() && direction === "up" && focused === "nav-tv") { setMenuOpen(false, false); focus("menu-toggle"); return; }
            }
            var a = node.getBoundingClientRect(), x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2, best, score = Infinity;
            for (var i = 0; i < candidates.length; i++) {
                if (candidates[i] === node) continue;
                var b = candidates[i].getBoundingClientRect(), dx = (b.left + b.right) / 2 - x, dy = (b.top + b.bottom) / 2 - y;
                var primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
                var secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
                if (primary > 2 && primary + secondary * 3 < score) { score = primary + secondary * 3; best = candidates[i]; }
            }
            if (best) focus(best.id);
        }
        function values() {
            var result = {}, fields = (modal || root).querySelectorAll("input, textarea, select");
            for (var i = 0; i < fields.length; i++) result[fields[i].id] = fields[i].type === "checkbox" ? fields[i].checked : fields[i].value;
            return result;
        }
        function click(event) {
            var node = event.target || event.srcElement;
            if (modal && !modal.contains(node)) return;
            if (keyboard.isOpen() && !keyboard.panel().contains(node)) return;
            if (node && node.nodeType === 3) node = node.parentNode;
            while (node && node !== d && !node.getAttribute("data-action")) node = node.parentNode;
            if (!node || node === d) return;
            if (node.getAttribute("data-action") === "toggleMenu") { setMenuOpen(!menuOpen); return; }
            focus(node.id);
            if (keyboard.handle(node.getAttribute("data-action"), node.getAttribute("data-value"), node)) {
                if (event.preventDefault) event.preventDefault(); else event.returnValue = false;
                return;
            }
            if (node.getAttribute("data-action") === "screen") setMenuOpen(false, false);
            options.onAction(node.getAttribute("data-action"), node.getAttribute("data-value"), values());
        }
        root.onclick = click;
        function cancelWheel(event) {
            if (event.preventDefault) event.preventDefault();
            event.returnValue = false;
            if (event.stopPropagation) event.stopPropagation();
        }
        function styleOf(node) {
            return node.currentStyle || (d.defaultView && d.defaultView.getComputedStyle ? d.defaultView.getComputedStyle(node, null) : null);
        }
        function scrollWheel(event) {
            if (!model || event.ctrlKey || event.metaKey) return;
            var node = event.target || event.srcElement, target = node;
            if (node && node.nodeType === 3) node = target = node.parentNode;
            if (!node || (!modal && !model.homeVisible)) return;
            var dx = 0, dy = 0;
            if (event.type === "wheel") {
                dx = Number(event.deltaX) || 0; dy = Number(event.deltaY) || 0;
                var factor = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? (root.clientHeight || 600) : 1;
                dx *= factor; dy *= factor;
            } else if (event.type === "mousewheel") {
                dx = -(Number(event.wheelDeltaX) || 0);
                dy = -(typeof event.wheelDeltaY === "number" ? event.wheelDeltaY : Number(event.wheelDelta) || 0);
            } else {
                dy = (Number(event.detail) || 0) * 20;
                if (event.axis === 1) { dx = dy; dy = 0; }
            }
            if (event.shiftKey && !dx) { dx = dy; dy = 0; }
            var delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            if (!delta) return;
            var now = Date.now(), direction = delta > 0 ? 1 : -1;
            // Some engines dispatch both modern and legacy events for one notch.
            if (wheelType && wheelType !== event.type && now - wheelTime < 60 && wheelDirection === direction) {
                if (wheelHandled) cancelWheel(event);
                return;
            }
            if (now - wheelTime > 250 || direction !== wheelDirection) wheelTotal = 0;
            wheelType = event.type; wheelTime = now; wheelDirection = direction; wheelHandled = false;
            if (modal && !modal.contains(node)) { cancelWheel(event); wheelHandled = true; return; }
            // The pointer's nearest scrollable container owns the gesture.
            // Flowing portrait panels may scroll the root, but never turn pages.
            var isolatedOrigin = false;
            while (node && node.nodeType === 1) {
                var style = styleOf(node), maxY = node.scrollHeight - node.clientHeight, maxX = node.scrollWidth - node.clientWidth;
                var beforeY = node.scrollTop, beforeX = node.scrollLeft;
                if (style && /auto|scroll|overlay/.test(style.overflowY || style.overflow || "") && maxY > 1 && dy) {
                    node.scrollTop = Math.max(0, Math.min(maxY, beforeY + dy));
                }
                if (style && /auto|scroll|overlay/.test(style.overflowX || style.overflow || "") && maxX > 1 && dx) {
                    node.scrollLeft = Math.max(0, Math.min(maxX, beforeX + dx));
                }
                if (node.scrollTop !== beforeY || node.scrollLeft !== beforeX) {
                    wheelTotal = 0; wheelHandled = true; cancelWheel(event);
                    options.onAction("menuLayout");
                    return;
                }
                if (node === modal || /(?:^|\s)f2-keyboard-layer(?:\s|$)/.test(node.className || "")) {
                    wheelTotal = 0; wheelHandled = true; cancelWheel(event); return;
                }
                if (node.id === "f2-sidebar" || node.id === "f2-selected-info" || node.id === "f2-channel-detail") {
                    isolatedOrigin = true;
                    if (style && (style.position === "absolute" || style.position === "fixed" ||
                        (/auto|scroll|overlay/.test(style.overflowY || style.overflow || "") && maxY > 1) ||
                        (/auto|scroll|overlay/.test(style.overflowX || style.overflow || "") && maxX > 1))) {
                        wheelTotal = 0; wheelHandled = true; cancelWheel(event); return;
                    }
                }
                if (node === root) break;
                node = node.parentNode;
            }
            if (isolatedOrigin) { wheelTotal = 0; wheelHandled = true; cancelWheel(event); return; }
            if (modal) return;
            var list = model.screen === "guide" ? d.getElementById("f2-content") : root.querySelector(".f2-channel-list") || d.getElementById("f2-channels");
            if (!list || !list.contains(target)) return;
            wheelHandled = true; cancelWheel(event);
            wheelTotal += delta;
            if (Math.abs(wheelTotal) < 60 || now - wheelPageTime < 140) return;
            wheelTotal = 0; wheelPageTime = now;
            if (model.screen === "guide") {
                var guidePage = Math.max(0, Math.min(Math.ceil(model.guideTotal / 30) - 1, model.guidePage + direction));
                if (guidePage !== model.guidePage) {
                    options.onAction("guidePage", String(guidePage));
                    if (direction < 0 && model.guideRows.length) focus("guide-" + (model.guideRows.length - 1), true);
                }
            } else if (isChannelBrowser()) {
                channelPage(model.page + direction, Math.max(0, rowIndexFor(selectedId)));
            } else if (model.screen === "vod") {
                command(direction > 0 ? "channelDown" : "channelUp", {});
            }
        }
        function bindWheel(node, add) {
            var names = ["wheel", "mousewheel", "DOMMouseScroll"];
            for (var i = 0; i < names.length; i++) {
                if (add && node.addEventListener) node.addEventListener(names[i], scrollWheel, false);
                else if (!add && node.removeEventListener) node.removeEventListener(names[i], scrollWheel, false);
            }
        }
        bindWheel(root, true);
        function dialog(title, body, settings) {
            closeDialog();
            returnFocus = focused;
            modal = d.createElement("div"); modal.id = "f2-dialog"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", "f2-dialog-title");
            modal.innerHTML = '<div class="f2-dialog-inner"><h2 id="f2-dialog-title">' + esc(title) + '</h2>' + body + (settings && settings.closeButton === false ? '' : '<div class="f2-dialog-footer">' + btn("dialog-close", "closeDialog", t("Закрыть", "Close")) + '</div>') + '</div>';
            modal.onclick = click; bindWheel(modal, true); keyboard.decorate(modal, model && model.settings.language); d.body.appendChild(modal);
            autoScroll.setEnabled(false);
            var initial = buttons(); focus(initial.length ? initial[0].id : "dialog-close", true);
        }
        function closeDialog() { if (modal) { if (options.onDialogClose) options.onDialogClose(); keyboard.destroy(); bindWheel(modal, false); modal.parentNode.removeChild(modal); modal = null; focus(returnFocus, true); syncAutoScroll(); } }
        function toast(message) {
            var node = d.getElementById("f2-toast"); node.textContent = message; node.style.display = "block";
            options.environment.clearTimeout(toastTimer); toastTimer = options.environment.setTimeout(function () { node.style.display = "none"; }, 5500);
        }
        function command(name, event) {
            var active = d.activeElement, editing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
            if (!modal && !model.homeVisible) return false;
            if (name === "tab" && modal) {
                var nodes = buttons(), index = nodes.indexOf(active), target = (index + (event && event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
                if (nodes[target]) focus(nodes[target].id); return true;
            }
            if (name === "back") { if (keyboard.close()) return true; if (modal) closeDialog(); else if (menuOpen) setMenuOpen(false); else options.onAction("back"); return true; }
            if (editing && name === "ok" && keyboard.openField(active)) return true;
            if (editing) return ["play", "pause", "playPause", "stop", "channelUp", "channelDown", "volumeUp", "volumeDown", "mute", "menu", "guide", "info"].indexOf(name) !== -1;
            if (!modal && name === "menu") { setMenuOpen(!menuOpen); return true; }
            if (!modal && name === "info" && isChannelBrowser() && /^channel-/.test(focused)) {
                var selected = selectedChannel();
                if (selected) options.onAction("channel", selected.id);
                return true;
            }
            if (!modal && model.rows && model.rows.length && ["tv", "favorites", "vod"].indexOf(model.screen) !== -1 && (name === "channelUp" || name === "channelDown")) {
                var size = model.pageSize || 12, nextPage = Math.max(0, Math.min(Math.ceil(model.filteredTotal / size) - 1, model.page + (name === "channelDown" ? 1 : -1)));
                if (isChannelBrowser()) channelPage(nextPage, Math.max(0, rowIndexFor(selectedId)));
                else if (nextPage !== model.page) { options.onAction("page", String(nextPage)); focus("channel-0", true); }
                return true;
            }
            if (["up", "down", "left", "right"].indexOf(name) !== -1) { move(name); return true; }
            if (name === "ok") { var node = d.getElementById(focused); if (node) node.click(); return true; }
            return !!modal;
        }
        function onFocus(event) {
            if (keyboard.isOpen() && !keyboard.panel().contains(event.target)) { focus(focused, true); return; }
            if (modal && !modal.contains(event.target)) { focus("dialog-close", true); return; }
            if ((root.contains(event.target) || (modal && modal.contains(event.target))) && event.target.id !== focused) focus(event.target.id);
        }
        if (d.addEventListener) d.addEventListener("focus", onFocus, true);
        return { render: render, dialog: dialog, closeDialog: closeDialog, toast: toast, command: command, btn: btn, field: field, escape: esc, t: t, focus: focus, focusContent: focusContent, setMenuOpen: setMenuOpen, hasDialog: function () { return !!modal; }, values: values, selectedChannelId: function () { return selectedId; }, focusChannel: focusChannel, previewRect: previewRect,
            destroy: function () {
                options.environment.clearTimeout(toastTimer);
                if (d.removeEventListener) d.removeEventListener("focus", onFocus, true);
                var images = root.querySelectorAll(".f2-channel-logo img");
                for (var i = 0; i < images.length; i++) images[i].onerror = null;
                root.onclick = null;
                bindWheel(root, false);
                keyboard.destroy();
                autoScroll.destroy();
                if (modal) { bindWheel(modal, false); modal.onclick = null; modal.parentNode.removeChild(modal); modal = null; }
            }
        };
    }
    return { create: create };
});
