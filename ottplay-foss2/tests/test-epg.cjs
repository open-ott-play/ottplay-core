const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");

const modules = {};
const browser = new JSDOM("<!doctype html><body></body>");
const sandbox = vm.createContext({ window: { OTT2: { define(name, factory) { modules[name] = factory((id) => modules[id]); } } } });
vm.runInContext("Promise = undefined; fetch = undefined; URL = undefined; Map = undefined; Set = undefined; Number.isFinite = undefined; Object.assign = undefined;", sandbox);
require("./load-core.cjs")(sandbox);
for (const name of ["providers", "epg"]) {
    const code = fs.readFileSync(path.join(__dirname, "../src/" + name + ".js"), "utf8");
    acorn.parse(code, { ecmaVersion: 5 });
    vm.runInContext(code, sandbox, { filename: name + ".js" });
}
const epg = modules.epg;
const parse = (text, sourceUrl) => epg.parseXML(text, browser.window.DOMParser, sourceUrl);
const plain = (value) => JSON.parse(JSON.stringify(value));
const utc = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000;

assert.equal(epg.parseTime("20260101053000 +0530"), utc);
assert.equal(epg.parseTime("20251231203000 -0330"), utc);
assert.equal(epg.parseTime("20260101000000"), utc, "XMLTV without a timezone uses UTC, not the device timezone");
assert.equal(epg.parseTime("202601010000 Z"), utc);
assert.equal(epg.parseTime("20260230010000 +0000"), null, "Impossible dates must not roll into another day");
assert.equal(epg.parseTime("20260101240000 +0000"), null);
assert.equal(epg.parseTime("20260101000000 +0565"), null);
assert.equal(epg.parseTime("202601"), null, "Partial dates do not invent a programme time");

const xml = '<?xml version="1.0"?><!DOCTYPE tv SYSTEM "https://no-network.test/xmltv.dtd"><tv>' +
    '<channel id="exact"><display-name>News</display-name><display-name>News Intl</display-name></channel>' +
    '<channel id="ambiguous"><display-name>News</display-name></channel>' +
    '<channel id="__proto__"><display-name>Prototype</display-name></channel>' +
    '<channel id="unique"><display-name>  Only   station </display-name></channel>' +
    '<programme channel="exact" start="20260101010000 +0100" stop="20260101020000 +0100"><title>&lt;img onerror="alert(1)"&gt;</title><desc>A &amp; B</desc></programme>' +
    '<programme channel="exact" start="20260101020000 +0100" stop="20260101030000 +0100" catchup-id="programme/42?x=1"><title>Next</title></programme>' +
    '<programme channel="exact" start="20260101020000 +0100" stop="20260101030000 +0100"><title>Next</title></programme>' +
    '<programme channel="exact" start="20260101040000 +0100" stop="20260101050000 +0100"><title>After gap</title></programme>' +
    '<programme channel="__proto__" start="20260101000000" stop="20260101010000"><title>Prototype programme</title></programme>' +
    '<programme channel="unique" start="20260101000000"><title>End inferred from next</title></programme>' +
    '<programme channel="unique" start="20260101010000" stop="20260101020000"><title>Second unique programme</title></programme>' +
    '<programme channel="unique" start="20260101020000"><title>Unknown final end</title></programme>' +
    '<programme channel="exact" start="bad" stop="20260101030000"><title>Invalid</title></programme></tv>';
const guide = parse(xml);
assert.equal(guide.channels.length, 4);
assert.equal(guide.byChannel.exact.length, 3, "Duplicate programmes do not create repeated rows");
assert.equal(guide.byChannel.__proto__.length, 1, "Provider IDs cannot mutate the lookup prototype");
assert.equal(Object.getPrototypeOf(guide.byChannel), null);
assert.equal(guide.byChannel.exact[0].title, '<img onerror="alert(1)">');
assert.equal(guide.byChannel.exact[0].description, "A & B");
assert.equal(browser.window.document.querySelector("img"), null, "Programme text is never rendered by the parser");
assert.equal(guide.byChannel.unique[0].end, utc + 3600);
assert.equal(guide.byChannel.unique.length, 2, "A final programme with no known stop is excluded");
assert(guide.warnings.length >= 2);
assert.equal(epg.matchChannel({ tvgId: "exact", name: "News" }, guide), guide.byChannel.exact, "Exact IDs win over ambiguous names");
assert.equal(epg.matchChannel({ name: "News" }, guide).length, 0, "An ambiguous channel name must not select someone else's EPG");
assert.equal(epg.matchChannel({ name: "only station" }, guide), guide.byChannel.unique);
assert.equal(epg.matchChannel({ tvgId: "missing", tvgName: "News Intl", name: "Custom name" }, guide), guide.byChannel.exact);
const emptyExact = parse('<tv><channel id="empty"><display-name>Empty</display-name></channel><channel id="other"><display-name>Other</display-name></channel><programme channel="other" start="20260101000000" stop="20260101010000"><title>Other title</title></programme></tv>');
assert.equal(epg.matchChannel({ tvgId: "empty", name: "Other" }, emptyExact).length, 0, "An exact ID with no schedule does not fall back to a different channel");
assert.equal(epg.matchChannel({ tvgId: "missing", tvgName: "Outdated provider name", name: "Only station" }, guide), guide.byChannel.unique, "An unmatched tvg-name must not suppress a valid channel-name match");
assert.equal(epg.matchChannel({ tvgName: "News", name: "Only station" }, guide), guide.byChannel.unique, "An ambiguous tvg-name may use a separate unambiguous channel-name match");
assert.equal(epg.matchChannel({ tvgName: "News Intl", name: "Only station" }, guide), guide.byChannel.exact, "An explicit unique tvg-name takes priority over the displayed channel name");

const icons = parse('<tv>' +
    '<channel id="exact"><display-name>News</display-name><display-name>News Intl</display-name><icon src="javascript:alert(1)"/><icon src="../logos/news.png?size=96&amp;theme=dark"/><icon src="https://fallback.test/news.png"/></channel>' +
    '<channel id="exact"><display-name>Another alias</display-name><icon src="https://later.test/news.png"/></channel>' +
    '<channel id="other"><display-name>News</display-name><icon src="//images.test/other.png"/></channel>' +
    '<channel id="root"><display-name>Root icon</display-name><icon src="/logos/root.png"/></channel>' +
    '<channel id="absolute"><icon src="HTTPS://images.test/absolute.png"/></channel>' +
    '<channel id="__proto__"><icon src="https://images.test/safe.png"/></channel>' +
    '</tv>', 'HTTPS://guide.test/xml/daily/guide.xml.gz?token=source');
assert.equal(icons.byId.exact.logo, 'https://guide.test/xml/logos/news.png?size=96&theme=dark', 'Relative icons resolve against the source document, including compressed-feed URLs');
assert.equal(icons.byId.other.logo, 'https://images.test/other.png');
assert.equal(icons.byId.root.logo, 'https://guide.test/logos/root.png');
assert.equal(icons.byId.absolute.logo, 'HTTPS://images.test/absolute.png');
assert.equal(icons.byId.exact.names.length, 3, 'Repeated channel declarations retain all display-name aliases');
assert.equal(Object.getPrototypeOf(icons.byId), null);
assert.equal(icons.byId.__proto__.logo, 'https://images.test/safe.png');
assert.deepEqual(plain(epg.matchMetadata({ tvgId: 'exact', name: 'News' }, icons)), { id: 'exact', names: ['News', 'News Intl', 'Another alias'], logo: 'https://guide.test/xml/logos/news.png?size=96&theme=dark' }, 'Metadata-only channels match an exact ID even without programmes');
assert.equal(epg.matchMetadata({ name: ' news intl ' }, icons).id, 'exact', 'Every XMLTV display-name alias participates in case-insensitive matching');
assert.equal(epg.matchMetadata({ tvgId: 'EXACT', name: 'NEWS INTL' }, icons).id, 'exact', 'A differently cased ID can fall back to a unique normalized display name');
assert.equal(epg.matchMetadata({ tvgId: 'EXACT' }, icons), null, 'Channel IDs remain case-sensitive without independent name evidence');
assert.equal(epg.matchMetadata({ name: 'News' }, icons), null, 'Ambiguous names do not borrow another channel icon');
assert.equal(epg.matchMetadata({ name: 'News Intl Extra' }, icons), null, 'Channel variants are never inferred through fuzzy name matching');
assert.equal(epg.matchMetadata({ tvgId: 'empty', name: 'Other' }, emptyExact).id, 'empty', 'Metadata and schedule matching share the same exact-ID preference');
assert.equal(epg.matchMetadata(null, icons), null);
assert.equal(epg.matchMetadata({ name: 'News' }, null), null);
assert.equal(parse('<tv><channel id="a"><icon src="../relative.png"/></channel></tv>').byId.a.logo, '', 'Relative icons without a source URL are not resolved against the player origin');
for (const unsafe of ['javascript:alert(1)', 'data:image/png;base64,a', 'file:///tmp/icon.png', 'blob:https://images.test/id', 'https://user:password@images.test/logo.png', 'https://images.test:65536/logo.png', 'https://images.test/space logo.png', 'https:\\images.test\\logo.png']) {
    assert.equal(parse('<tv><channel id="unsafe"><icon src="' + unsafe + '"/></channel></tv>', 'https://guide.test/tv.xml').byId.unsafe.logo, '', 'Unsafe or invalid image URLs are rejected: ' + unsafe);
}

let nowNext = epg.currentNext(guide.byChannel.exact, utc + 3599);
assert.equal(nowNext.current.title, '<img onerror="alert(1)">');
assert.equal(nowNext.next.title, "Next");
nowNext = epg.currentNext(guide.byChannel.exact, utc + 3600);
assert.equal(nowNext.current.title, "Next", "The end boundary belongs to the next programme");
nowNext = epg.currentNext(guide.byChannel.exact, utc + 7200);
assert.equal(nowNext.current, null, "A schedule gap does not extend an expired programme");
assert.equal(nowNext.next.title, "After gap");
assert.deepEqual(plain(epg.currentNext([], utc)), { current: null, next: null });
assert.deepEqual(plain(epg.currentNext(guide.byChannel.exact, NaN)), { current: null, next: null });
const overlapping = [{ start: utc, end: utc + 7200, title: "older" }, { start: utc + 3600, end: utc + 5400, title: "newer" }];
assert.equal(epg.currentNext(overlapping.reverse(), utc + 4000).current.title, "newer", "Overlapping schedules select the latest start regardless of array order");

// Cached lookups retain the exact current/next contract across overlaps, gaps,
// ties, negative clock corrections and channel metadata changes.
const cacheGuide = { byChannel: { cached: [
    { start: 10, end: 100, title: "Outer" },
    { start: 30, end: 40, title: "Inner" },
    { start: 120, end: 150, title: "After gap" },
    { start: 30, end: 45, title: "Tied start" },
    { start: NaN, end: 200, title: "Invalid" }
] }, byName: { station: ["cached"] }, byAlias: {}, byId: { cached: { id: "cached", logo: "https://images.test/a.png" } } };
const lookup = epg.createLookup({ limit: 2 });
const cachedChannel = { name: "Station", tvgShift: 0 };
for (const time of [0, 10, 11, 29, 30, 39, 40, 44, 45, 99, 100, 119, 120, 150, 151, 35, 29, -100, Infinity, NaN]) {
    const expected = epg.currentNext(cacheGuide.byChannel.cached, time);
    const result = lookup.lookup(cachedChannel, cacheGuide, time);
    assert.equal(result.current, expected.current, "Cached current at " + time);
    assert.equal(result.next, expected.next, "Cached next at " + time);
    assert.equal(result.entries, cacheGuide.byChannel.cached, "Unshifted schedules reuse their existing array");
    assert.equal(result.metadata, cacheGuide.byId.cached);
}
const shiftedChannel = { tvgId: "cached", name: "Station", tvgShift: 1 };
const shiftedFirst = lookup.lookup(shiftedChannel, cacheGuide, 3610);
assert.equal(shiftedFirst.current.title, "Outer");
assert.equal(shiftedFirst.entries, lookup.lookup({ ...shiftedChannel }, cacheGuide, 3611).entries, "Equivalent decorated channel objects reuse shifted entries");
shiftedChannel.tvgShift = 2;
assert.equal(lookup.lookup(shiftedChannel, cacheGuide, 3611).current, null, "Changed offsets invalidate the cached time interpretation");
assert.equal(lookup.lookup(shiftedChannel, cacheGuide, 7210).current.title, "Outer");
assert.notEqual(lookup.lookup(cachedChannel, cacheGuide, 11).entries, undefined);
assert.notEqual(lookup.lookup({ ...shiftedChannel, tvgShift: 1 }, cacheGuide, 3611).entries, shiftedFirst.entries, "Bounded lookup evicts old shifted schedules");
const renamed = lookup.lookup({ name: "Unmatched", tvgShift: 0 }, cacheGuide, 11);
assert.equal(renamed.metadata, null, "A changed channel name cannot reuse the previous station match");
assert.equal(renamed.entries.length, 0);
const replacementGuide = { ...cacheGuide, byChannel: { cached: [{ start: 0, end: 200, title: "Replacement" }] }, byId: { cached: { id: "cached", logo: "https://images.test/new.png" } } };
assert.equal(lookup.lookup(cachedChannel, replacementGuide, 11).current.title, "Replacement", "A new guide invalidates matches and intervals");
assert.equal(lookup.lookup(cachedChannel, replacementGuide, 11).metadata.logo, "https://images.test/new.png");
let startsRead = 0;
const observed = { end: 200, title: "Observed" };
Object.defineProperty(observed, "start", { get() { startsRead++; return 10; } });
const observedGuide = { byChannel: { observed: [observed] }, byId: { observed: { id: "observed" } } };
lookup.lookup({ tvgId: "observed" }, observedGuide, 20);
const firstReads = startsRead;
for (let time = 21; time < 150; time++) assert.equal(lookup.lookup({ tvgId: "observed" }, observedGuide, time).current, observed);
assert.equal(startsRead, firstReads, "Repeated ticks inside an unchanged interval do not scan the schedule");
lookup.clear(); lookup.lookup({ tvgId: "observed" }, observedGuide, 20);
assert(startsRead > firstReads, "Explicit teardown releases the lookup interval");

assert.throws(() => parse('<tv><channel></tv>'), (error) => error.code === "XML_FORMAT");
assert.throws(() => parse('<!DOCTYPE tv [<!ENTITY x "unsafe">]><tv/>'), (error) => error.code === "XML_ENTITIES");
assert.throws(() => epg.parseXML("<tv/>", null), (error) => error.code === "XML_UNAVAILABLE");
const literal = parse('<tv><programme channel="a" start="20260101000000" stop="20260101010000"><title><![CDATA[<!DOCTYPE tv SYSTEM "https://literal.test"> <!ENTITY text>]]></title></programme></tv>');
assert.equal(literal.programmes[0].title, '<!DOCTYPE tv SYSTEM "https://literal.test"> <!ENTITY text>', "Literal metadata must not be rewritten by DTD guards");
assert.throws(() => parse('<!DOCTYPE tv><!DOCTYPE tv><tv/>'), (error) => error.code === "XML_DOCTYPE");

const programme = { start: utc, end: utc + 3600, catchupId: "programme/42?x=1" };
const channel = { url: "https://stream.test/live.ts?token=a", catchup: { type: "default", source: "https://archive.test/play?start={utc}&end={utcend}&duration={duration}&now={lutc}", days: 2 } };
assert.equal(epg.archiveUrl(channel, programme, utc + 7200), "https://archive.test/play?start=" + utc + "&end=" + (utc + 3600) + "&duration=3600&now=" + (utc + 7200));
channel.catchup = { type: "append", source: "&start=${start}&mins={duration:60}&offset={offset:60}", days: 2 };
assert.equal(epg.archiveUrl(channel, programme, utc + 7200), "https://stream.test/live.ts?token=a&start=" + utc + "&mins=60&offset=120");
assert.equal(epg.archiveUrl({ url: "https://stream.test/live.ts#ignored", catchup: channel.catchup }, programme, utc + 7200), "https://stream.test/live.ts?start=" + utc + "&mins=60&offset=120", "Append parameters form a real query even if the live URL has none");
channel.catchup = { type: "vod", source: "https://archive.test/{catchup-id}?date={Y}-{m}-{d}T{H}:{M}:{S}", days: 2 };
assert.equal(epg.archiveUrl(channel, programme, utc + 7200), "https://archive.test/programme%2F42%3Fx%3D1?date=2026-01-01T00:00:00");
channel.catchup = { type: "default", source: "https://archive.test/?start={utc}", days: 2, correction: 1 };
assert.equal(epg.archiveUrl(channel, programme, utc + 7200), "https://archive.test/?start=" + (utc + 3600));
assert.equal(epg.archiveUrl(channel, programme, utc - 1), null, "Future programmes have no archive URL");
assert.equal(epg.archiveUrl(channel, programme, utc + 1800), null, "Only completed programmes use this finite archive contract");
assert.equal(epg.archiveUrl(channel, programme, utc + 2 * 86400 + 1), null, "Retention is enforced before URL creation");
assert.equal(epg.archiveUrl(channel, programme, utc + 2 * 86400), "https://archive.test/?start=" + (utc + 3600));
for (const catchup of [
    { type: "xc", days: 3, source: "https://archive.test/{utc}" },
    { type: "default", days: 3, source: "javascript:alert({utc})" },
    { type: "default", days: 3, source: "https://archive.test/{unknown}" },
    { type: "default", days: 3, source: "https://archive.test/static" },
    { type: "default", days: 3, source: "https://archive.test/{offset:0}" },
    { type: "default", days: 0, source: "https://archive.test/{utc}" },
    { type: "append", days: 3, source: "https://evil.test/{utc}" }
]) {
    assert.equal(epg.archiveUrl({ url: channel.url, catchup }, programme, utc + 7200), null, "Unsupported or unsafe archive templates must fail explicitly");
}
console.log("PASS: independent ES5 XMLTV timezone/matching/gap handling, inert metadata, exact archive templates and retention limits");

const shifted = epg.matchChannel({ tvgId: 'exact', tvgShift: 5.5 }, guide);
assert.equal(shifted[0].start, utc + 5.5 * 3600);
assert.equal(shifted[0].end, utc + 6.5 * 3600);
assert.equal(guide.byChannel.exact[0].start, utc, 'Per-channel shifts never mutate shared guide data');
const otherGuide = parse('<tv><channel id="extra"><display-name>Extra</display-name><display-name>Only station</display-name></channel><programme channel="extra" start="20260101000000" stop="20260101010000"><title>Extra show</title></programme></tv>');
const merged = epg.mergeGuides([guide, guide, otherGuide]);
assert.equal(merged.channels.length, 5);
assert.equal(merged.programmes.length, guide.programmes.length + 1, 'Duplicate guide sources do not duplicate programmes');
assert.equal(epg.matchChannel({name:'Only station'},merged).length,0,'Merged names remain ambiguous across channels');
assert.equal(epg.matchChannel({tvgId:'extra'},merged)[0].title,'Extra show');
assert.equal(epg.archiveUrl({url:'https://a.test/live?x=1',catchup:{type:'shift',days:1}},programme,utc+7200),'https://a.test/live?x=1&utc='+utc+'&lutc='+(utc+7200));


const programmeOnly = parse('<tv><programme channel="later" start="20260101000000" stop="20260101010000"><title>Retained</title></programme></tv>', icons.sourceUrl);
const channelOnly = parse('<tv><channel id="later"><display-name>Later channel declaration</display-name></channel></tv>', icons.sourceUrl);
assert.equal(epg.mergeGuides([programmeOnly, channelOnly]).byChannel.later[0].title, 'Retained', 'Later channel metadata cannot reset an existing merged schedule');
assert.deepEqual(plain(epg.matchMetadata({ tvgId: 'later' }, programmeOnly)), { id: 'later', names: [], logo: '' }, 'Programme-only feeds still report their exact matched ID');
const iconSupplement = parse('<tv><channel id="exact"><display-name>Supplement alias</display-name><icon src="https://secondary.test/news.png"/></channel><channel id="third"><display-name>News Intl</display-name><icon src="https://secondary.test/third.png"/></channel><channel id="later"><display-name>Later channel declaration</display-name><icon src="https://secondary.test/later.png"/></channel></tv>', icons.sourceUrl);
const iconMerged = epg.mergeGuides([programmeOnly, icons, iconSupplement, icons]);
assert.equal(iconMerged.byId.exact.logo, icons.byId.exact.logo, 'First valid logo wins for repeated fragments of the same guide');
assert.equal(iconMerged.byId.exact.names.indexOf('Supplement alias') >= 0, true, 'Repeated fragments retain aliases from the same feed');
assert.equal(epg.matchMetadata({ name: 'News Intl' }, iconMerged), null, 'Duplicate aliases across feed IDs remain ambiguous');
assert.equal(epg.matchMetadata({ tvgId: 'exact', name: 'News Intl' }, iconMerged).logo, icons.byId.exact.logo, 'Exact IDs retain a deterministic icon even when merged names are ambiguous');
assert.equal(epg.matchMetadata({ tvgId: 'later' }, iconMerged).logo, 'https://secondary.test/later.png', 'Later metadata supplements a programme-only feed');
assert.equal(epg.matchChannel({ tvgId: 'later' }, iconMerged)[0].title, 'Retained');
assert.equal(icons.byId.exact.names.indexOf('Supplement alias'), -1, 'Merging does not mutate metadata in a source guide');
assert.equal(epg.mergeGuides([channelOnly, iconSupplement]).byId.later.logo, 'https://secondary.test/later.png', 'Later valid icons fill missing metadata');
assert.equal(epg.mergeGuides([iconSupplement, icons]).byId.exact.logo, 'https://secondary.test/news.png', 'Fragment order defines duplicate icon precedence within one feed');
const qualityGuide = parse('<tv>' +
    '<channel id="ren"><display-name>РЕН ТВ</display-name><icon src="https://images.test/ren.png"/></channel>' +
    '<channel id="first"><display-name>Первый канал</display-name></channel>' +
    '<channel id="russia"><display-name>Россия 1</display-name></channel>' +
    '<channel id="alpha"><display-name>Alpha</display-name><display-name>Alpha HD</display-name></channel>' +
    '<channel id="beta"><display-name>Beta</display-name></channel>' +
    '<channel id="distinct-quality"><display-name>Beta HD</display-name></channel>' +
    '<programme channel="first" start="20260101000000" stop="20260101010000"><title>First programme</title></programme>' +
    '</tv>');
assert.equal(epg.canonicalName('  UHD  Первый   канал HD  '), 'первый канал');
assert.equal(epg.canonicalName('РЕН ТВ +2 HD'), 'рен тв +2', 'A time-shift label must remain part of the channel identity');
assert.equal(epg.canonicalName('News (North) HD'), 'news (north)', 'A region label must remain part of the channel identity');
assert.equal(epg.canonicalName('News HD RO'), 'news hd ro', 'A language label must remain part of the channel identity');
assert.equal(epg.canonicalName('HDTV'), 'hdtv', 'Quality stripping requires a separate token');
assert.equal(epg.matchMetadata({ tvgId: 'hlsproxy-382', name: 'РЕН ТВ HD' }, qualityGuide).id, 'ren');
assert.equal(epg.matchMetadata({ tvgId: 'hlsproxy-362', name: 'Первый канал FHD' }, qualityGuide).id, 'first');
assert.equal(epg.matchChannel({ tvgId: 'hlsproxy-362', name: 'Первый канал FHD' }, qualityGuide)[0].title, 'First programme');
assert.equal(epg.matchMetadata({ tvgId: 'hlsproxy-391', name: 'Россия 1 FHD' }, qualityGuide).id, 'russia');
assert.equal(epg.matchMetadata({ name: 'HD РЕН ТВ' }, qualityGuide).logo, 'https://images.test/ren.png');
assert.equal(epg.matchMetadata({ name: 'РЕН ТВ 4K' }, qualityGuide).id, 'ren');
assert.equal(epg.matchMetadata({ name: 'Alpha FHD' }, qualityGuide).id, 'alpha', 'Multiple equivalent aliases on one ID stay unambiguous');
assert.equal(epg.matchMetadata({ name: 'Beta FHD' }, qualityGuide), null, 'Quality aliases shared by distinct IDs must not guess a schedule');
assert.equal(epg.matchMetadata({ name: 'Beta HD' }, qualityGuide).id, 'distinct-quality', 'An exact quality-specific name wins over an ambiguous quality alias');
assert.equal(epg.matchMetadata({ tvgId: 'beta', name: 'Beta HD' }, qualityGuide).id, 'beta', 'An exact ID remains authoritative');
assert.equal(epg.matchMetadata({ tvgName: 'Alpha FHD', name: 'Первый канал' }, qualityGuide).id, 'first', 'Both exact names precede quality-alias matching');
assert.equal(epg.matchMetadata({ name: 'РЕН ТВ +2 HD' }, qualityGuide), null);
assert.equal(epg.matchMetadata({ name: 'РЕН ТВ (Регион) HD' }, qualityGuide), null);
const alternateQuality = parse('<tv><channel id="ren-other"><display-name>РЕН ТВ UHD</display-name></channel></tv>');
assert.equal(epg.matchMetadata({ name: 'РЕН ТВ FHD' }, epg.mergeGuides([qualityGuide, alternateQuality])), null, 'Feed merging preserves ambiguous quality aliases');
const limitedGuide = parse('<tv data-truncated="true" data-truncated-channels="2" data-window-start="1000" data-window-end="2000" data-programme-limit="100"/>');
assert.deepEqual(plain(limitedGuide.coverage), { limited: true, windowStart: 1000, windowEnd: 2000, programmeLimit: 100, truncatedChannels: 2 });
assert.deepEqual(plain(parse('<tv/>').coverage), { limited: false, windowStart: null, windowEnd: null, programmeLimit: null, truncatedChannels: 0 }, 'Plain XMLTV does not invent server coverage metadata');
assert.equal(parse('<tv data-truncated-channels="1"/>').coverage.limited, true, 'A positive truncation count alone marks a partial programme window');
assert.equal(parse('<tv data-truncated="true" data-truncated-channels="0"/>').coverage.limited, true, 'A global output limit can mark truncation without a channel count');
assert.equal(parse('<tv data-truncated="false" data-truncated-channels="0"/>').coverage.limited, false);
for (const attributes of ['data-truncated="yes" data-truncated-channels="NaN"', 'data-window-start="Infinity" data-window-end="2000"', 'data-window-start="2000" data-window-end="1000"', 'data-window-start="1000"', 'data-window-start="1000.5" data-window-end="2000"', 'data-window-start="0x10" data-window-end="2000"', 'data-window-start="0" data-window-end="999999999999999999"', 'data-programme-limit="-1" data-truncated-channels="-1"', 'data-programme-limit="100.1" data-truncated-channels="1.5"', 'data-programme-limit="999999999999" data-truncated-channels="999999999999"']) {
    assert.deepEqual(plain(parse('<tv ' + attributes + '/>').coverage), { limited: false, windowStart: null, windowEnd: null, programmeLimit: null, truncatedChannels: 0 }, 'Invalid optional coverage fields are ignored: ' + attributes);
}
const secondCoverage = parse('<tv data-truncated-channels="3" data-window-start="1500" data-window-end="2500" data-programme-limit="80"/>');
assert.deepEqual(plain(epg.mergeGuides([parse('<tv/>'), limitedGuide, secondCoverage]).coverage), { limited: true, windowStart: 1000, windowEnd: 2500, programmeLimit: 80, truncatedChannels: 5 }, 'Merged coverage unions limited state and declared window envelope without mutating source metadata');
assert.equal(limitedGuide.coverage.truncatedChannels, 2);
assert.equal(epg.mergeGuides([limitedGuide, parse('<tv/>')]).coverage.limited, true, 'An unrestricted later feed cannot erase an earlier truncation marker');
console.log('PASS: ES5 XMLTV icons, safe relative URLs, exact metadata matching, all-name fallback and deterministic merged metadata');
const anonymousA = parse('<tv><channel id="1"><display-name>Anonymous A</display-name></channel></tv>');
const anonymousB = parse('<tv><channel id="1"><display-name>Anonymous B</display-name></channel></tv>');
assert.equal(epg.matchMetadata({ tvgId: '1' }, epg.mergeGuides([anonymousA, anonymousB])), null, 'Anonymous files also retain separate namespaces');
assert.equal(epg.mergeGuides([anonymousA, anonymousA]).channels.length, 1, 'Repeated references to the same anonymous import are deduplicated');

// Independent XMLTV identities cannot be joined by a reused numeric ID.
const feedA = parse('<tv><channel id="1"><display-name>Alpha</display-name><icon src="/alpha.png"/></channel><programme channel="1" start="20260101000000" stop="20260101010000"><title>Alpha show</title></programme></tv>', 'https://a.test/guide.xml');
const feedB = parse('<tv><channel id="1"><display-name>Beta</display-name><icon src="/beta.png"/></channel><programme channel="1" start="20260101000000" stop="20260101010000"><title>Beta show</title></programme></tv>', 'https://b.test/guide.xml');
for (const feeds of [[feedA, feedB], [feedB, feedA]]) {
    const joined = epg.mergeGuides(feeds);
    const a = { tvgId: '1', name: 'Renamed by user', epgUrls: [feedA.sourceUrl] };
    const b = { tvgId: '1', name: 'Renamed by user', epgUrls: [feedB.sourceUrl] };
    assert.equal(epg.matchChannel(a, joined)[0].title, 'Alpha show');
    assert.equal(epg.matchChannel(b, joined)[0].title, 'Beta show');
    assert.equal(epg.matchMetadata(a, joined).logo, 'https://a.test/alpha.png');
    assert.equal(epg.matchMetadata(b, joined).logo, 'https://b.test/beta.png');
    assert.equal(epg.matchChannel({ tvgId: '1' }, joined).length, 0, 'Ambiguous IDs cannot select a feed by completion order');
    assert.equal(epg.matchChannel({ tvgId: '1', name: 'Beta' }, joined)[0].title, 'Beta show');
    assert.equal(epg.matchChannel({ tvgId: '1', epgUrls: ['https://missing.test/guide.xml'] }, joined).length, 0, 'Missing affinity does not reinterpret feed-local IDs');
    assert.equal(epg.matchChannel({ tvgId: '1', name: 'Alpha', epgUrls: ['https://missing.test/guide.xml'] }, joined)[0].title, 'Alpha show', 'A unique name is a safe channel-level fallback');
    const scopedLookup = epg.createLookup();
    assert.equal(scopedLookup.lookup(a, joined, utc + 1).current.title, 'Alpha show');
    assert.equal(scopedLookup.lookup(b, joined, utc + 1).current.title, 'Beta show', 'Cache keys retain feed affinity');
}
const emptyScoped = parse('<tv><channel id="1"><display-name>Alpha</display-name></channel></tv>', feedA.sourceUrl);
const noBorrow = epg.mergeGuides([emptyScoped, feedB]);
assert.equal(epg.matchChannel({ tvgId: '1', epgUrls: [feedA.sourceUrl, feedB.sourceUrl] }, noBorrow).length, 0);
assert.equal(epg.matchMetadata({ tvgId: '1', epgUrls: [feedA.sourceUrl, feedB.sourceUrl] }, noBorrow).logo, '', 'An exact empty station does not borrow another feed logo');

for (const [live, resource] of [['index.m3u8', 'archive-'], ['video.m3u8', 'video-'], ['mono.m3u8', 'mono-'], ['mpegts', 'archive-'], ['index.mpd', 'archive-']]) {
    const extension = live === 'mpegts' ? '.ts' : live === 'index.mpd' ? '.mpd' : '.m3u8';
    const input = { url: 'https://stream.test/path/' + live + '?token=a%2Fb&expires=22&x=1&x=2#player', catchup: { type: 'flussonic', days: 7, correction: 1 } };
    assert.equal(epg.archiveUrl(input, programme, utc + 7200), 'https://stream.test/path/' + resource + (utc + 3600) + '-3600' + extension + '?token=a%2Fb&expires=22&x=1&x=2');
}
for (const live of ['playlist.m3u8', 'index.m3u8/extra', 'index.m3u8x', 'unknown?file=index.m3u8', 'mpegts.mkv']) {
    assert.equal(epg.archiveUrl({ url: 'https://stream.test/' + live, catchup: { type: 'flussonic', days: 7 } }, programme, utc + 7200), null);
}
assert.equal(epg.archiveUrl({ url: 'https://stream.test/index.m3u8', catchup: { type: 'flussonic', days: 31 } }, programme, utc + 7200), null);
for (const url of ['https://index.m3u8?token=a', 'https://mpegts']) {
    assert.equal(epg.archiveUrl({ url, catchup: { type: 'flussonic', days: 7 } }, programme, utc + 7200), null, 'A hostname cannot be rewritten as a stream resource');
}

for (const count of [4095, 4096, 4097, 8000]) {
    let copies = 0;
    const many = { byChannel: Object.create(null), byId: Object.create(null) }, records = [];
    for (let i = 0; i < count; i++) {
        const id = 'channel-' + i, entry = { start: 0, end: 100, title: 'Show' };
        Object.defineProperty(entry, 'description', { enumerable: true, get() { copies++; return 'Description'; } });
        many.byChannel[id] = [entry, { start: 100, end: 200, title: 'Next' }]; many.byId[id] = { id };
        records.push({ tvgId: id, tvgShift: 1 });
    }
    const largeLookup = epg.createLookup({ limit: 4096 });
    records.forEach(record => largeLookup.lookup(record, many, 3610));
    copies = 0;
    records.forEach(record => largeLookup.lookup(record, many, 3611));
    assert(copies <= Math.max(0, count - 3072), 'Repeated scans retain a bounded stable working set at ' + count + ' channels; got ' + copies);
    largeLookup.clear(); copies = 0;
    records.forEach(record => largeLookup.lookup(record, many, 3612));
    assert.equal(copies, count, 'Teardown releases every retained shifted schedule');
}
const heapGuide = { byChannel: Object.create(null), byId: Object.create(null) };
for (let i = 0; i < 65; i++) {
    const id = 'heap-' + i;
    heapGuide.byChannel[id] = Array.from({ length: 1024 }, (_, p) => ({ start: p * 60, end: (p + 1) * 60, title: 'Programme ' + p }));
    heapGuide.byId[id] = { id };
}
const heapLookup = epg.createLookup({ limit: 4096 });
const retainedSchedule = heapLookup.lookup({ tvgId: 'heap-0', tvgShift: 1 }, heapGuide, 3610).entries;
for (let i = 1; i < 64; i++) heapLookup.lookup({ tvgId: 'heap-' + i, tvgShift: 1 }, heapGuide, 3610);
const overflowSchedule = heapLookup.lookup({ tvgId: 'heap-64', tvgShift: 1 }, heapGuide, 3610).entries;
assert.notEqual(heapLookup.lookup({ tvgId: 'heap-64', tvgShift: 1 }, heapGuide, 3611).entries, overflowSchedule, 'Schedules beyond 65536 retained shifted entries remain transient');
assert.equal(heapLookup.lookup({ tvgId: 'heap-0', tvgShift: 1 }, heapGuide, 3611).entries, retainedSchedule, 'Overflow does not discard the stable working set');
assert.equal(heapLookup.lookup({ tvgId: 'heap-64' }, heapGuide, 11).entries, heapGuide.byChannel['heap-64'], 'Unshifted entries remain zero-copy after the shifted-entry budget is full');
heapLookup.clear();
const afterHeapReset = heapLookup.lookup({ tvgId: 'heap-64', tvgShift: 1 }, heapGuide, 3610).entries;
assert.equal(heapLookup.lookup({ tvgId: 'heap-64', tvgShift: 1 }, heapGuide, 3611).entries, afterHeapReset, 'Clearing the cache releases its shifted-entry budget');
const rotatingHeap = epg.createLookup({ limit: 2, entryLimit: 2048 });
rotatingHeap.lookup({ tvgId: 'heap-0', tvgShift: 1 }, heapGuide, 3610);
rotatingHeap.lookup({ tvgId: 'heap-1', tvgShift: 1 }, heapGuide, 3610);
const replacedSchedule = rotatingHeap.lookup({ tvgId: 'heap-2', tvgShift: 1 }, heapGuide, 3610).entries;
assert.equal(rotatingHeap.lookup({ tvgId: 'heap-2', tvgShift: 1 }, heapGuide, 3611).entries, replacedSchedule, 'Evicted shifted entries free their budget for the next schedule');
browser.window.close();
