/* On-screen editor: no global listeners, native key hooks or player coupling. */
OTT2.define("keyboard", function () {
    "use strict";
    var instance = 0;
    function create(options) {
        var d = options.document;
        var prefix = "f2-kb-" + (++instance) + "-";
        var mount = null, layer = null, preview = null, target = null, opener = null;
        var controls = [], serial = 0, start = 0, end = 0, upper = false, alphabet = "latin", language = "en";

        function t(ru, en) { return language === "ru" ? ru : en; }
        function element(tag, className, text) {
            var node = d.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.appendChild(d.createTextNode(text));
            return node;
        }
        function button(id, action, value, title, className) {
            var node = element("button", className, title);
            node.type = "button";
            node.id = prefix + id;
            node.setAttribute("data-action", action);
            node.setAttribute("data-value", value);
            return node;
        }
        function editable(field) {
            var tag = field && field.tagName;
            var type = String(field && field.type || "text").toLowerCase();
            return !!field && !field.disabled && !field.readOnly && !field.hidden && field.style.display !== "none" && (tag === "TEXTAREA" || (tag === "INPUT" && /^(text|url|password|search)$/.test(type)));
        }
        function focus(id) { if (options.focus) options.focus(id, true); }
        function selection() {
            start = end = target.value.length;
            try {
                if (typeof target.selectionStart === "number" && typeof target.selectionEnd === "number") {
                    start = target.selectionStart;
                    end = target.selectionEnd;
                }
            } catch (ignore) {}
        }
        function clamp() {
            var length = target.value.length;
            start = Math.max(0, Math.min(length, start));
            end = Math.max(start, Math.min(length, end));
        }
        function setSelection() {
            clamp();
            try { if (target.setSelectionRange) target.setSelectionRange(start, end); } catch (ignore) {}
        }
        function label(field) {
            var node = field.parentNode, children, i;
            var aria = field.getAttribute("aria-label");
            if (aria) return aria;
            while (node && node !== mount) {
                if (node.tagName === "LABEL") {
                    children = node.childNodes;
                    for (i = 0; i < children.length; i += 1) {
                        if (children[i].nodeType === 1 && children[i].tagName === "SPAN" && children[i].className !== "f2-edit-control") return children[i].textContent || children[i].innerText || field.id;
                    }
                }
                node = node.parentNode;
            }
            return field.name || field.id || t("Текст", "Text");
        }
        function display() {
            var value, left, right, selected, cursor;
            if (!target || !preview) return;
            clamp();
            value = target.value;
            if (target.type === "password") value = new Array(value.length + 1).join("•");
            left = Math.max(0, start - 40);
            right = Math.min(value.length, end + 40);
            selected = value.slice(start, Math.min(end, start + 60));
            if (end - start > 60) selected += "…";
            preview.innerHTML = "";
            preview.appendChild(d.createTextNode((left ? "…" : "") + value.slice(left, start)));
            cursor = element("span", "f2-kb-cursor", selected || "│");
            cursor.setAttribute("aria-hidden", "true");
            preview.appendChild(cursor);
            preview.appendChild(d.createTextNode(value.slice(end, right) + (right < value.length ? "…" : "")));
        }
        function update(value, position) {
            var event;
            target.value = value;
            start = end = position;
            setSelection();
            display();
            if (d.createEvent && target.dispatchEvent) {
                event = d.createEvent("Events");
                event.initEvent("input", true, false);
                target.dispatchEvent(event);
            }
        }
        function insert(text) {
            var value, maximum, remaining;
            if (!target) return;
            clamp();
            value = target.value;
            maximum = target.maxLength;
            if (typeof maximum === "number" && maximum >= 0) {
                remaining = Math.max(0, maximum - (value.length - (end - start)));
                text = text.slice(0, remaining);
                if (!text) return;
            }
            update(value.slice(0, start) + text + value.slice(end), start + text.length);
        }
        function previous(value, position) {
            var result = Math.max(0, position - 1);
            if (result > 0 && /[\udc00-\udfff]/.test(value.charAt(result)) && /[\ud800-\udbff]/.test(value.charAt(result - 1))) result -= 1;
            return result;
        }
        function next(value, position) {
            var result = Math.min(value.length, position + 1);
            if (result < value.length && /[\ud800-\udbff]/.test(value.charAt(position)) && /[\udc00-\udfff]/.test(value.charAt(result))) result += 1;
            return result;
        }
        function erase() {
            if (!target) return;
            clamp();
            if (start === end) start = previous(target.value, start);
            update(target.value.slice(0, start) + target.value.slice(end), start);
        }
        function moveCursor(direction) {
            if (!target) return;
            clamp();
            if (direction < 0) start = start === end ? previous(target.value, start) : start;
            else start = start === end ? next(target.value, end) : end;
            end = start;
            setSelection(); display();
        }
        function render() {
            var panel, title, rows, row, text, actions, i, j, number = 0;
            layer.innerHTML = "";
            panel = element("div", "f2-keyboard-panel");
            title = element("h3", "f2-kb-title", label(target));
            title.id = prefix + "title";
            panel.appendChild(title);
            preview = element("div", "f2-kb-preview");
            preview.setAttribute("aria-label", t("Текст и положение курсора", "Text and cursor position"));
            panel.appendChild(preview);
            rows = alphabet === "latin" ? ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"] : ["1234567890", "йцукенгшщзхъ", "фывапролджэ", "ячсмитьбюё"];
            rows.push(".:/?&=_-@#%+");
            rows.push("!$()[];,\"'~");
            rows.push("*\\{}|<>");
            for (i = 0; i < rows.length; i += 1) {
                row = element("div", "f2-kb-row");
                for (j = 0; j < rows[i].length; j += 1) {
                    text = rows[i].charAt(j);
                    if (upper) text = text.toUpperCase();
                    row.appendChild(button("key-" + number, "keyboardKey", text, text, "f2-kb-key"));
                    number += 1;
                }
                panel.appendChild(row);
            }
            actions = element("div", "f2-kb-actions");
            actions.appendChild(button("layout", "keyboardCommand", "layout", alphabet === "latin" ? "Русский" : "ABC", "f2-kb-control"));
            actions.appendChild(button("shift", "keyboardCommand", "shift", upper ? "ABC → abc" : "abc → ABC", "f2-kb-control"));
            actions.appendChild(button("space", "keyboardCommand", "space", t("Пробел", "Space"), "f2-kb-control"));
            actions.appendChild(button("erase", "keyboardCommand", "erase", t("Стереть ←", "Delete ←"), "f2-kb-control"));
            actions.appendChild(button("cursor-left", "keyboardCommand", "cursorLeft", "← " + t("Курсор", "Cursor"), "f2-kb-control"));
            actions.appendChild(button("cursor-right", "keyboardCommand", "cursorRight", t("Курсор", "Cursor") + " →", "f2-kb-control"));
            if (target.tagName === "TEXTAREA") actions.appendChild(button("newline", "keyboardCommand", "newline", t("Новая строка", "New line"), "f2-kb-control"));
            actions.appendChild(button("clear", "keyboardCommand", "clear", t("Очистить", "Clear"), "f2-kb-control"));
            actions.appendChild(button("done", "keyboardCommand", "done", t("Готово", "Done"), "f2-kb-control f2-primary"));
            panel.appendChild(actions);
            panel.appendChild(element("p", "f2-help", t("Стрелки — выбрать клавишу · OK — ввести · Back — вернуться к полю", "Arrows select a key · OK enters it · Back returns to the field")));
            layer.appendChild(panel);
            display();
        }
        function close(restore) {
            var buttonId = opener && opener.id;
            if (!layer) return false;
            if (layer.parentNode) layer.parentNode.removeChild(layer);
            layer = preview = target = opener = null;
            if (restore !== false && buttonId) focus(buttonId);
            return true;
        }
        function openField(field) {
            var i;
            if (!mount || !editable(field)) return false;
            for (i = 0; i < controls.length; i += 1) if (controls[i].field === field) break;
            if (i === controls.length) return false;
            close(false);
            target = field; opener = controls[i].trigger;
            upper = false;
            if (target.type === "url" || target.type === "password") alphabet = "latin";
            selection();
            layer = element("div", "f2-keyboard-layer");
            layer.id = prefix + "layer";
            layer.setAttribute("role", "group");
            layer.setAttribute("aria-labelledby", prefix + "title");
            mount.appendChild(layer);
            render(); focus(prefix + "key-0");
            return true;
        }
        function handle(action, value, node) {
            var i;
            if (action === "keyboardOpen") {
                for (i = 0; i < controls.length; i += 1) if (controls[i].trigger === node) openField(controls[i].field);
                return true;
            }
            if (action !== "keyboardKey" && action !== "keyboardCommand") return false;
            if (!layer || !target) return true;
            if (action === "keyboardKey") insert(value);
            else if (value === "done") close();
            else if (value === "space") insert(" ");
            else if (value === "newline" && target.tagName === "TEXTAREA") insert("\n");
            else if (value === "erase") erase();
            else if (value === "clear") update("", 0);
            else if (value === "cursorLeft") moveCursor(-1);
            else if (value === "cursorRight") moveCursor(1);
            else if (value === "layout") { alphabet = alphabet === "latin" ? "cyrillic" : "latin"; render(); focus(prefix + "layout"); }
            else if (value === "shift") { upper = !upper; render(); focus(prefix + "shift"); }
            return true;
        }
        function destroy() {
            var i, control;
            close(false);
            for (i = 0; i < controls.length; i += 1) {
                control = controls[i];
                if (control.wrapper.parentNode) {
                    control.wrapper.parentNode.insertBefore(control.field, control.wrapper);
                    control.wrapper.parentNode.removeChild(control.wrapper);
                }
            }
            controls = []; mount = null;
        }
        function decorate(modal, locale) {
            var fields, field, wrapper, trigger, i;
            destroy(); mount = modal; language = locale === "ru" ? "ru" : "en";
            fields = modal.querySelectorAll("input, textarea");
            for (i = 0; i < fields.length; i += 1) {
                field = fields[i];
                if (!editable(field)) continue;
                serial += 1;
                if (!field.id) field.id = prefix + "input-" + serial;
                wrapper = element("span", "f2-edit-control");
                trigger = button("open-" + serial, "keyboardOpen", "", t("Клавиатура", "Keyboard"), "f2-keyboard-open");
                trigger.setAttribute("aria-label", t("Клавиатура: ", "Keyboard: ") + label(field));
                trigger.setAttribute("aria-controls", field.id);
                field.parentNode.insertBefore(wrapper, field);
                wrapper.appendChild(field); wrapper.appendChild(trigger);
                controls.push({ field: field, wrapper: wrapper, trigger: trigger });
            }
        }
        return { decorate: decorate, openField: openField, handle: handle, close: close, destroy: destroy, panel: function () { return layer; }, isOpen: function () { return !!layer; } };
    }
    return { create: create };
});
