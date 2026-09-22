/* XMLTV decoding and browser adapter for the shared guide/archive rules. */
(function (root) {
    "use strict";
    root.OTT2.define("epg", function (require) {
        var providers = require("providers");
        var core = root.OttPlayCore;
        if (!core) throw new Error("OttPlay core is not loaded");
        var httpUrl = providers.httpUrl;
        var anonymousFeed = 0;

        function error(code, message) {
            var result = new Error(message);
            result.code = code;
            return result;
        }

        function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

        function parseTime(value) {
            return core.parseBrowserXmltvTime(String(value == null ? "" : value));
        }

        function content(node) {
            var result = "";
            var child;
            if (!node) return "";
            if (typeof node.textContent === "string") return node.textContent;
            for (child = node.firstChild; child; child = child.nextSibling) {
                result += child.nodeType === 3 || child.nodeType === 4 ? child.nodeValue || "" : content(child);
            }
            return result;
        }

        function children(node, tag) {
            var result = [];
            var child;
            for (child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === 1 && child.nodeName === tag) result.push(child);
            }
            return result;
        }

        function firstText(node, tag) {
            var values = children(node, tag);
            return values.length ? content(values[0]) : "";
        }

        function canonicalName(name) { return core.canonicalChannelName(String(name == null ? "" : name)); }

        function iconUrl(value, sourceUrl) {
            var absolute = httpUrl(value);
            var base;
            if (absolute) return absolute;
            base = httpUrl(sourceUrl).replace(/^https?:/i, function (scheme) { return scheme.toLowerCase(); });
            return base ? providers.relativeUrl(value, base) : "";
        }

        function inertDeclaration(xml) {
            var cursor = 0;
            var end;
            var quote;
            var declaration;
            var found = false;
            while (cursor < xml.length) {
                while (/\s/.test(xml.charAt(cursor)) && cursor < xml.length) cursor += 1;
                if (xml.slice(cursor, cursor + 2) === "<?") {
                    end = xml.indexOf("?>", cursor + 2);
                    if (end < 0) return xml;
                    cursor = end + 2;
                } else if (xml.slice(cursor, cursor + 4) === "<!--") {
                    end = xml.indexOf("-->", cursor + 4);
                    if (end < 0) return xml;
                    cursor = end + 3;
                } else if (xml.slice(cursor, cursor + 9) === "<!DOCTYPE") {
                    if (found) throw error("XML_DOCTYPE", "Multiple XML document declarations are not supported");
                    quote = "";
                    for (end = cursor + 9; end < xml.length; end += 1) {
                        if (quote) {
                            if (xml.charAt(end) === quote) quote = "";
                        } else if (xml.charAt(end) === '"' || xml.charAt(end) === "'") quote = xml.charAt(end);
                        else if (xml.charAt(end) === "[") throw error("XML_ENTITIES", "XMLTV entity declarations are not supported");
                        else if (xml.charAt(end) === ">") break;
                    }
                    declaration = xml.slice(cursor, end + 1);
                    if (!/^<!DOCTYPE\s+tv(?:\s+SYSTEM\s+(?:"[^"<>]*"|'[^'<>]*'))?\s*>$/.test(declaration)) throw error("XML_DOCTYPE", "Unsupported XMLTV document declaration");
                    xml = xml.slice(0, cursor) + xml.slice(end + 1);
                    found = true;
                } else break;
            }
            return xml;
        }

        function parseXML(text, DOMParserCtor, sourceUrl) {
            var xml = String(text == null ? "" : text).replace(/^\ufeff/, "");
            var Parser = DOMParserCtor || root.DOMParser;
            var doc, nodes, nested, row, i, j;
            var stations = [], programmes = [], fields = {};
            var source = httpUrl(sourceUrl);
            var identity = source || "anonymous:" + (++anonymousFeed);
            xml = inertDeclaration(xml);
            if (typeof Parser !== "function") throw error("XML_UNAVAILABLE", "This device has no XML parser");
            try { doc = new Parser().parseFromString(xml, "text/xml"); }
            catch (ignore) { throw error("XML_FORMAT", "The programme guide is not valid XML"); }
            if (!doc || !doc.documentElement || doc.documentElement.nodeName !== "tv" || doc.getElementsByTagName("parsererror").length) throw error("XML_FORMAT", "The programme guide is not valid XMLTV");
            ["data-window-start", "data-window-end", "data-programme-limit", "data-truncated-channels", "data-truncated"].forEach(function (key) {
                fields[key] = doc.documentElement.getAttribute(key);
            });
            nodes = children(doc.documentElement, "channel");
            for (i = 0; i < nodes.length; i += 1) {
                row = { id: nodes[i].getAttribute("id"), names: [], icons: [] };
                nested = children(nodes[i], "display-name");
                for (j = 0; j < nested.length; j += 1) row.names.push(content(nested[j]));
                nested = children(nodes[i], "icon");
                for (j = 0; j < nested.length; j += 1) row.icons.push(nested[j].getAttribute("src"));
                stations.push(row);
            }
            nodes = children(doc.documentElement, "programme");
            for (i = 0; i < nodes.length; i += 1) {
                row = nodes[i];
                programmes.push({ channel: row.getAttribute("channel"), start: row.getAttribute("start"), stop: row.getAttribute("stop"),
                    title: firstText(row, "title"), description: firstText(row, "desc"),
                    catchupAttribute: row.getAttribute("catchup-id"), catchupElement: firstText(row, "catchup-id") });
            }
            return core.parseBrowserGuide(stations, programmes, fields, source, identity, function (value) { return iconUrl(value, sourceUrl); });
        }

        function matchedId(channel, guide) { return core.matchedGuideChannel(channel, guide); }

        function matchMetadata(channel, guide) {
            var id = matchedId(channel, guide);
            var i;
            if (!id) return null;
            if (guide.byId && has(guide.byId, id)) return guide.byId[id];
            for (i = 0; i < (guide.channels || []).length; i += 1) if (guide.channels[i].id === id) return guide.channels[i];
            // Programme-only XMLTV feeds still have an exact ID match.
            return { id: id, names: [], logo: "" };
        }

        function matchChannel(channel, guide) {
            var id = matchedId(channel, guide);
            return id ? shiftedEntries(guide.byChannel[id], channel.tvgShift) : [];
        }

        function shiftedEntries(entries, hours) { return core.shiftBrowserGuide(entries, Number(hours)); }

        function mergeGuides(guides) { return core.mergeBrowserGuides(guides, httpUrl); }

        function currentNext(entries, nowSeconds) {
            var rows = entries || [];
            var selected = core.selectGuideSchedule(rows, Number(nowSeconds), false);
            return { current: selected.current < 0 ? null : rows[selected.current], next: selected.next < 0 ? null : rows[selected.next] };
        }

        function createLookup(options) {
            var lookup = new core.BrowserGuideLookup(Number(options && options.limit), Number(options && options.entryLimit));
            return {
                clear: function () { lookup.clear(); },
                lookup: function (channel, guide, nowSeconds) {
                    var key = JSON.stringify([channel && channel.tvgId, channel && channel.tvgName, channel && channel.name, channel && channel.tvgShift, channel && channel.epgUrls]);
                    return lookup.lookup(key, guide, Number(nowSeconds), function () {
                        var id = matchedId(channel, guide), unshifted = id ? guide.byChannel[id] : [];
                        return { metadata: matchMetadata(channel, guide), entries: id ? shiftedEntries(unshifted, channel.tvgShift) : unshifted, unshifted: unshifted };
                    });
                }
            };
        }

        function archiveUrl(channel, programme, nowSeconds) {
            var catchup = channel && channel.catchup;
            if (!catchup || !programme) return null;
            return core.archiveUrl({
                url: httpUrl(channel.url), mode: String(catchup.type || ""), source: String(catchup.source || ""),
                start: Number(programme.start), end: Number(programme.end), now: Number(nowSeconds),
                days: Number(catchup.days), correction: Number(catchup.correction || 0),
                programmeId: String(programme.catchupId || ""), base: httpUrl(catchup.base),
                username: catchup.username == null ? null : String(catchup.username),
                password: catchup.password == null ? null : String(catchup.password),
                streamId: String(catchup.streamId), extension: String(catchup.extension || "")
            }, function (seconds) {
                var date = new Date(seconds * 1000);
                return isFinite(date.getTime()) ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()] : [];
            }, function (url) { return httpUrl(url) || null; });
        }

        return { parseXML: parseXML, parseTime: parseTime, mergeGuides: mergeGuides, canonicalName: canonicalName, matchMetadata: matchMetadata, matchChannel: matchChannel, currentNext: currentNext, createLookup: createLookup, archiveUrl: archiveUrl };
    });
}(window));
