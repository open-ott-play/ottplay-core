OTT2.define("auto-scroll", function () {
    "use strict";
    function create(options) {
        var d = options.document, environment = options.environment || d.defaultView;
        var now = options.now || function () { return Date.now(); };
        var element = null, identity = null, enabled = false, destroyed = false, timer = null;
        var position = 0, expectedTop = 0, deadline = 0, previous = null, phase = "reading";
        var running = false, pointerDown = false, manualUntil = 0;
        var readingDelay = 3000, bottomDelay = 4000, manualDelay = 8000, speed = 14;

        function listen(node, name, handler, add) {
            if (!node) { return; }
            if (node.addEventListener) { node[add ? "addEventListener" : "removeEventListener"](name, handler, false); }
            else if (node.attachEvent) { node[add ? "attachEvent" : "detachEvent"]("on" + name, handler); }
        }
        function hidden() {
            return d.hidden === true || d.webkitHidden === true || d.msHidden === true;
        }
        function clearTimer() {
            if (timer !== null) { environment.clearTimeout(timer); timer = null; }
        }
        function schedule(delay) {
            if (!destroyed && enabled && element && !hidden() && timer === null) {
                timer = environment.setTimeout(tick, delay);
            }
        }
        function styleOf(node) {
            return node.currentStyle || (d.defaultView && d.defaultView.getComputedStyle ? d.defaultView.getComputedStyle(node, null) : null);
        }
        function eligible() {
            var style, node;
            if (!element || !enabled || hidden() || pointerDown) { return false; }
            if (options.isActive && !options.isActive()) { return false; }
            if (!element.clientHeight || element.scrollHeight - element.clientHeight <= 1) { return false; }
            style = styleOf(element);
            // A flowing portrait panel belongs to page scrolling, not this timer.
            if (!style || !/^(auto|scroll|overlay)$/.test(style.overflowY || style.overflow || "")) { return false; }
            node = element;
            while (node && node !== d.documentElement) {
                style = styleOf(node);
                if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) { return false; }
                node = node.parentNode;
            }
            return node === d.documentElement;
        }
        function readPosition() {
            var node = element;
            while (node && node !== d.documentElement) { node = node.parentNode; }
            // Browsers report zero for detached elements. A view replacement
            // must retain the last observed position until its new node exists.
            if (element && node === d.documentElement) { position = Number(element.scrollTop) || 0; expectedTop = position; }
        }
        function writePosition(value) {
            if (!element) { return; }
            element.scrollTop = value;
            expectedTop = Number(element.scrollTop) || 0;
        }
        function pause() {
            running = false; previous = null; readPosition();
        }
        function tick() {
            var time = now(), maximum, elapsed;
            timer = null;
            if (destroyed || !element || !enabled) { return; }
            if (!eligible()) {
                pause(); schedule(500); return;
            }
            if (!running) {
                running = true; phase = "reading";
                deadline = Math.max(time + readingDelay, manualUntil); previous = time;
                readPosition();
            }
            maximum = element.scrollHeight - element.clientHeight;
            if (Math.abs((Number(element.scrollTop) || 0) - expectedTop) > 0.75) {
                manual();
            }
            if (time < deadline) { previous = time; schedule(100); return; }
            if (phase === "bottom") {
                position = 0; writePosition(0); phase = "reading";
                deadline = time + readingDelay; previous = time;
            } else if (position >= maximum) {
                phase = "bottom"; deadline = time + bottomDelay; previous = time;
            } else {
                // Limit delayed ticks so returning from a suspended browser never
                // jumps through unread text. Fractional progress supports old
                // engines that round scrollTop to integer CSS pixels.
                elapsed = previous === null ? 0 : Math.max(0, Math.min(250, time - previous));
                previous = time;
                position = Math.min(maximum, position + speed * elapsed / 1000);
                writePosition(Math.floor(position));
                phase = position >= maximum ? "bottom" : "scrolling";
                if (phase === "bottom") { deadline = time + bottomDelay; }
            }
            schedule(100);
        }
        function manual() {
            if (destroyed || !element) { return; }
            readPosition(); manualUntil = now() + manualDelay;
            phase = "reading"; deadline = manualUntil; previous = now();
        }
        function scrolled() {
            // Programmatic scrolling also emits scroll events. Only a position
            // different from our last write represents user/external movement.
            if (element && Math.abs((Number(element.scrollTop) || 0) - expectedTop) > 0.75) { manual(); }
        }
        function press() { pointerDown = true; manual(); }
        function release() {
            if (!pointerDown) { return; }
            pointerDown = false; manual(); schedule(100);
        }
        function bind(node, add) {
            var events = ["wheel", "mousewheel", "DOMMouseScroll"];
            for (var i = 0; i < events.length; i++) { listen(node, events[i], manual, add); }
            listen(node, "scroll", scrolled, add);
            listen(node, "mousedown", press, add); listen(node, "touchstart", press, add);
        }
        function visibility() {
            pause(); clearTimer(); schedule(100);
        }
        function setEnabled(value) {
            if (destroyed) { return; }
            value = !!value;
            if (value !== enabled) { enabled = value; pause(); clearTimer(); }
            schedule(100);
        }
        function update(node, key, active) {
            var changed = identity !== String(key == null ? "" : key);
            if (destroyed) { return; }
            if (node !== element) {
                readPosition(); bind(element, false); element = node || null;
                bind(element, true); pointerDown = false;
                if (element && !changed) { writePosition(expectedTop); }
                if (!element) { pause(); clearTimer(); }
            }
            if (changed) {
                identity = String(key == null ? "" : key);
                position = 0; writePosition(0); running = false; previous = null; manualUntil = 0;
            }
            setEnabled(active !== false);
        }
        function destroy() {
            if (destroyed) { return; }
            destroyed = true; enabled = false; clearTimer(); bind(element, false); element = null;
            listen(d, "visibilitychange", visibility, false); listen(d, "webkitvisibilitychange", visibility, false);
            listen(d, "msvisibilitychange", visibility, false); listen(d, "mouseup", release, false);
            listen(d, "touchend", release, false); listen(d, "touchcancel", release, false);
            listen(d.defaultView, "blur", release, false);
        }
        listen(d, "visibilitychange", visibility, true); listen(d, "webkitvisibilitychange", visibility, true);
        listen(d, "msvisibilitychange", visibility, true); listen(d, "mouseup", release, true);
        listen(d, "touchend", release, true); listen(d, "touchcancel", release, true);
        listen(d.defaultView, "blur", release, true);
        return { update: update, setEnabled: setEnabled, destroy: destroy };
    }
    return { create: create };
});
