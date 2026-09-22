OTT2.define("features", function (require) {
    "use strict";
    function create(context) {
        var view = context.view, t = context.t, library = require("library");
        function done() { view.closeDialog(); context.render(); }
        function checked(id, label, value) { return '<label class="f2-check"><input id="' + id + '" type="checkbox"' + (value ? ' checked="checked"' : '') + '> ' + view.escape(label) + '</label>'; }
        function handle(action, value, values) {
            var state = context.state(), html = "", channel, i, result;
            if (action === "history") {
                state.history.forEach(function (entry, index) {
                    html += '<div class="f2-source"><strong>' + view.escape(entry.name) + '</strong><p>' + view.escape(new Date(entry.time).toLocaleString()) + '</p>' +
                        (context.find(entry.id) ? view.btn("history-play-" + index, "resume", t("Смотреть", "Watch"), entry.id) : '<p>' + t("Откройте исходный источник для воспроизведения.", "Open the original source to play this item.") + '</p>') +
                        view.btn("history-remove-" + index, "removeHistory", t("Удалить", "Remove"), entry.id) + '</div>';
                });
                view.dialog(t("История просмотра", "Watch history"), html || '<p>' + t("История пуста.", "Your history is empty.") + '</p>');
            } else if (action === "removeHistory") {
                context.persist(function (s) { s.history = s.history.filter(function (entry) { return entry.id !== value; }); delete s.bookmarks[value]; }); handle("history", "", {});
            } else if (action === "renameFavoriteList") {
                view.dialog(t("Переименовать список", "Rename collection"), view.field("collection-name", t("Название", "Name"), state.activeFavorites) + view.btn("collection-rename", "saveFavoriteName", t("Сохранить", "Save")));
            } else if (action === "saveFavoriteName") {
                try { context.persist(function (s) { library.renameList(s, s.activeFavorites, values["collection-name"]); }); done(); }
                catch (error) { view.toast(t("Нужно уникальное допустимое имя.", "Enter a unique, valid name.")); }
            } else if (action === "deleteFavoriteList") {
                view.dialog(t("Удалить подборку?", "Delete collection?"), '<p>' + view.escape(state.activeFavorites) + '</p>' + view.btn("collection-delete", "confirmDeleteFavoriteList", t("Удалить", "Delete")));
            } else if (action === "confirmDeleteFavoriteList") {
                context.persist(function (s) { library.removeList(s, s.activeFavorites); }); done();
            } else if (action === "favoriteUp" || action === "favoriteDown") {
                context.persist(function (s) { library.moveFavorite(s, value, action === "favoriteUp" ? -1 : 1); }); done();
            } else if (action === "editChannel") {
                channel = context.find(value); if (!channel) return true;
                view.dialog(t("Настройки канала", "Channel settings"), view.field("channel-name", t("Название", "Name"), channel.name) + view.field("channel-group", t("Группа", "Group"), channel.group) + view.field("channel-order", t("Позиция", "Position"), String(channel.order + 1), "number") + checked("channel-hidden", t("Скрыть канал", "Hide channel"), channel.hidden) + view.btn("save-channel", "saveChannel", t("Сохранить", "Save"), value) + view.btn("reset-channel", "resetChannel", t("Вернуть исходные поля", "Reset fields"), value));
            } else if (action === "saveChannel") {
                context.persist(function (s) { library.edit(s, value, { name: values["channel-name"], group: values["channel-group"], order: Number(values["channel-order"]) - 1, hidden: values["channel-hidden"] }); }); done();
            } else if (action === "resetChannel") {
                context.persist(function (s) { delete s.channelOverrides[value]; }); done();
            } else if (action === "hiddenChannels") {
                context.channels(true).filter(function (entry) { return entry.hidden; }).forEach(function (entry, index) { html += view.btn("unhide-" + index, "unhideChannel", view.escape(entry.name), entry.id); });
                view.dialog(t("Скрытые каналы", "Hidden channels"), html || '<p>' + t("Скрытых каналов нет.", "No hidden channels.") + '</p>');
            } else if (action === "unhideChannel") {
                context.persist(function (s) { if (s.channelOverrides[value]) s.channelOverrides[value].hidden = false; }); handle("hiddenChannels", "", {}); context.render();
            } else if (action === "editGroup") {
                view.dialog(t("Переименовать группу", "Rename group"), view.field("group-old", t("Текущее имя", "Current name"), value) + view.field("group-new", t("Новое имя", "New name"), value) + view.btn("rename-group", "saveGroup", t("Сохранить", "Save")));
            } else if (action === "saveGroup") {
                context.persist(function (s) { context.channels(true).forEach(function (entry) { if (entry.group === values["group-old"]) { var change = s.channelOverrides[entry.id] || {}; change.group = String(values["group-new"] || "").slice(0, 160); s.channelOverrides[entry.id] = change; } }); }); done();
            } else if (action === "reminders") {
                state.reminders.forEach(function (entry, index) { html += '<div class="f2-source"><strong>' + view.escape(entry.title) + '</strong><p>' + view.escape(new Date(entry.start * 1000).toLocaleString()) + '</p>' + view.btn("reminder-remove-" + index, "removeReminder", t("Удалить", "Remove"), entry.id) + '</div>'; });
                view.dialog(t("Напоминания", "Reminders"), html || '<p>' + t("Выберите будущую передачу в телепрограмме.", "Choose a future programme in the guide.") + '</p>');
            } else if (action === "removeReminder") {
                context.persist(function (s) { s.reminders = s.reminders.filter(function (entry) { return entry.id !== value; }); }); handle("reminders", "", {});
            } else if (action === "preferences") {
                html = checked("pref-restore", t("Возобновлять последний канал при запуске", "Restore the last channel on startup"), state.settings.restore) + checked("pref-relay", t("Использовать настроенный локальный ретранслятор", "Use the configured local relay"), state.settings.relay);
                html += '<p class="f2-help">' + t("Для ретранслятора администратор должен разрешить адреса источников на сервере плеера.", "The player server must allow the source addresses before the relay can be used.") + '</p><h3>' + t("Акцент интерфейса", "Accent color") + '</h3><select id="pref-accent"><option value="amber"' + (state.settings.accent === "amber" ? " selected" : "") + '>' + t("Янтарный", "Amber") + '</option><option value="blue"' + (state.settings.accent === "blue" ? " selected" : "") + '>' + t("Синий", "Blue") + '</option><option value="green"' + (state.settings.accent === "green" ? " selected" : "") + '>' + t("Зелёный", "Green") + '</option></select>';
                view.dialog(t("Поведение плеера", "Player preferences"), html + view.btn("save-preferences", "savePreferences", t("Сохранить", "Save")));
            } else if (action === "savePreferences") {
                context.persist(function (s) { s.settings.restore = values["pref-restore"] === true; s.settings.relay = values["pref-relay"] === true; s.settings.accent = values["pref-accent"]; }); done();
            } else if (action === "security") {
                var status = context.gate.status();
                html = '<p>' + (status.enabled ? t("Защита включена.", "Protection is enabled.") : t("Задайте PIN для защищённых каналов и настроек.", "Set a PIN to protect channels and settings.")) + '</p>';
                if (!status.enabled && value && context.find(value)) html += '<p>' + t("Защитить канал: ", "Protect channel: ") + view.escape(context.find(value).name) + '</p><input type="hidden" id="pin-channel" value="' + view.escape(value) + '">';
                if (status.enabled) html += view.field("pin-old", t("Текущий PIN", "Current PIN"), "", "password");
                html += view.field("pin-new", t("Новый PIN", "New PIN"), "", "password") + view.field("pin-repeat", t("Повтор PIN", "Repeat PIN"), "", "password") + view.btn("pin-configure", "configurePIN", t("Сохранить PIN", "Save PIN"));
                if (status.enabled) html += view.btn("pin-disable", "disablePIN", t("Отключить защиту", "Disable protection")) + view.btn("pin-lock", "lockPIN", t("Заблокировать сейчас", "Lock now"));
                view.dialog(t("Родительский контроль", "Parental control"), html);
            } else if (action === "configurePIN") {
                if (values["pin-new"] !== values["pin-repeat"]) { view.toast(t("PIN не совпадают.", "PINs do not match.")); return true; }
                result = context.gate.configure(values["pin-old"] || "", values["pin-new"] || "");
                if (result.ok) { if (values["pin-channel"] && context.find(values["pin-channel"])) { context.gate.verify(values["pin-new"]); context.gate.setProtected(values["pin-channel"], true); context.gate.lock(); } done(); view.toast(t("PIN сохранён.", "PIN saved.")); } else view.toast(t("PIN не принят. Используйте 4–12 цифр или повторите позже.", "PIN not accepted. Use 4–12 digits or try again later."));
            } else if (action === "disablePIN") {
                result = context.gate.disable(values["pin-old"] || "");
                if (result.ok) done(); else view.toast(t("PIN не принят.", "PIN not accepted."));
            } else if (action === "lockPIN") { context.gate.lock(); if (context.onLock) context.onLock(); done(); }
            else if (action === "protectChannel") {
                result = context.gate.setProtected(value, !context.gate.isProtected(value, "playback"));
                if (result.ok) done(); else { handle("security", value, {}); }
            } else return false;
            return true;
        }
        return { handle: handle };
    }
    return { create: create };
});
