OTT2.define("playback-info", function () {
    "use strict";
    function create(context) {
        var d = context.document, environment = context.environment || d.defaultView;
        var t = context.t || function (ru, en) { return en; };
        var osd = d.getElementById("player-osd"), hitarea = d.getElementById("player-info-hitarea");
        var title = d.getElementById("player-title"), programmeTitle = d.getElementById("player-programme-title");
        var programmeTime = d.getElementById("player-programme-time"), details = d.getElementById("player-programme-details");
        var description = d.getElementById("player-description"), next = d.getElementById("player-next");
        var timeout = Number(context.timeout) > 0 ? Number(context.timeout) : 6000;
        var enabled = false, visible = false, expanded = false, destroyed = false, timer = null, contentKey = "";
        function setText(node, value) {
            value = value === null || value === undefined ? "" : String(value);
            // Media time updates must preserve text selection while reading EPG.
            if (node && node.textContent !== value) { node.textContent = value; }
        }
        function clock(seconds) {
            var date, hours, minutes;
            if (typeof seconds !== "number" || !isFinite(seconds)) { return ""; }
            date = new Date(seconds * 1000);
            if (!isFinite(date.getTime())) { return ""; }
            hours = date.getHours(); minutes = date.getMinutes();
            return (hours < 10 ? "0" : "") + hours + ":" + (minutes < 10 ? "0" : "") + minutes;
        }
        function clearTimer() {
            if (timer !== null) { environment.clearTimeout(timer); timer = null; }
        }
        function contains(parent, node) {
            while (node) { if (node === parent) { return true; } node = node.parentNode; }
            return false;
        }
        function sync() {
            if (osd) {
                osd.style.display = enabled && visible ? "block" : "none";
                osd.setAttribute("aria-hidden", enabled && visible ? "false" : "true");
                osd.setAttribute("data-expanded", expanded ? "true" : "false");
            }
            if (details) {
                details.style.display = expanded ? "block" : "none";
                details.setAttribute("aria-hidden", expanded ? "false" : "true");
            }
            if (hitarea) {
                hitarea.style.display = enabled && !visible ? "block" : "none";
                hitarea.setAttribute("aria-hidden", enabled && !visible ? "false" : "true");
            }
        }
        function hide() {
            var active = d.activeElement;
            clearTimer(); visible = false; expanded = false;
            // Hidden playback controls must not retain keyboard focus.
            if (osd && contains(osd, active) && typeof active.blur === "function") { active.blur(); }
            sync();
        }
        function show(expand) {
            if (!enabled || destroyed) { return; }
            visible = true; expanded = !!expand;
            if (osd) { osd.scrollTop = 0; }
            if (description && !expanded) { description.scrollTop = 0; }
            sync(); clearTimer();
            // A browser-blocked start keeps its Play instruction available.
            // Ordinary pausing retains the standard information timeout.
            if (!context.shouldAutoHide || context.shouldAutoHide()) {
                timer = environment.setTimeout(function () { timer = null; if (!destroyed) { hide(); } }, timeout);
            }
        }
        function advance() { show(visible); }
        function update(data) {
            var channel, programme, following, range, key;
            if (destroyed) { return; }
            data = data || {}; channel = data.channel || {}; programme = data.programme; following = data.next;
            key = String(channel.id || channel.name || "") + "\n" + (programme ? String(programme.start) + "\n" + String(programme.title) + "\n" + String(programme.description) : "");
            if (key !== contentKey) {
                if (description) { description.scrollTop = 0; }
                if (osd) { osd.scrollTop = 0; }
                contentKey = key;
            }
            setText(title, channel.name || "OTT-play 2");
            setText(programmeTitle, programme && programme.title ? programme.title : t("Нет информации о программе", "No programme information"));
            range = programme ? clock(programme.start) : "";
            if (range && clock(programme.end)) { range += "–" + clock(programme.end); }
            setText(programmeTime, range);
            if (programmeTime) { programmeTime.style.display = range ? "inline" : "none"; }
            setText(description, programme && programme.description ? programme.description : t("Описание отсутствует.", "No description available."));
            setText(next, following ? t("Далее: ", "Next: ") + (clock(following.start) ? clock(following.start) + " " : "") + String(following.title || "") : "");
            if (next) { next.style.display = following ? "block" : "none"; }
            if (osd) { osd.setAttribute("aria-label", t("Информация о канале", "Channel information")); }
            if (hitarea) { hitarea.setAttribute("aria-label", t("Показать информацию о канале", "Show channel information")); }
        }
        function interactive(node) {
            var name;
            while (node && node !== osd) {
                name = String(node.nodeName || "").toLowerCase();
                if (/^(button|a|input|textarea|select|label)$/.test(name) || (node.getAttribute && node.getAttribute("role") === "button")) { return true; }
                node = node.parentNode;
            }
            return false;
        }
        function click(event) {
            event = event || environment.event;
            if (!event || !enabled || destroyed || interactive(event.target || event.srcElement)) { return; }
            advance();
            if (event.stopPropagation) { event.stopPropagation(); }
            event.cancelBubble = true;
        }
        function hitClick(event) {
            if (!enabled || destroyed) { return; }
            advance(); event = event || environment.event;
            if (event && event.stopPropagation) { event.stopPropagation(); }
            if (event) { event.cancelBubble = true; }
        }
        function listen(node, name, handler, add) {
            if (!node) { return; }
            if (node.addEventListener) { node[add ? "addEventListener" : "removeEventListener"](name, handler, false); }
            else if (node.attachEvent) { node[add ? "attachEvent" : "detachEvent"]("on" + name, handler); }
        }
        function setEnabled(value) {
            if (destroyed) { return; }
            enabled = !!value;
            if (!enabled) { hide(); } else { sync(); }
        }
        function destroy() {
            if (destroyed) { return; }
            enabled = false; hide(); destroyed = true;
            listen(osd, "click", click, false); listen(hitarea, "click", hitClick, false);
        }
        listen(osd, "click", click, true); listen(hitarea, "click", hitClick, true);
        update({}); sync();
        return { update: update, show: show, advance: advance, hide: hide, setEnabled: setEnabled,
            isVisible: function () { return enabled && visible; }, isExpanded: function () { return enabled && visible && expanded; }, destroy: destroy };
    }
    return { create: create };
});
