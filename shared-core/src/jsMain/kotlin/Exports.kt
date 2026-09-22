@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.GuideNames
import play.ott.core.GuideTime
import play.ott.core.GuideTimeFormat
import play.ott.core.GuideSchedule
import play.ott.core.NativeGuideNames
import play.ott.core.NativeGuideFormat
import play.ott.core.NativeGuideIndex
import play.ott.core.NativeGuideEntry
import play.ott.core.NativeGuideWindow
import play.ott.core.NativeGuideClock
import play.ott.core.Archive
import play.ott.core.ArchiveRequest
import play.ott.core.OperatorPlaylist
import play.ott.core.Playlist
import play.ott.core.PlaylistFormat
import play.ott.core.PlaylistFailure
import play.ott.core.ProviderPlaylist
import play.ott.core.ProviderPlaylistFormat
import play.ott.core.ArchiveFormat

/** Only ABI conversion: the implementation is compiled from commonMain for every target. */
@JsExport
fun parseXmltvTimestamp(value: String): Double? = GuideTime.milliseconds(value)

@JsExport
fun parseBrowserXmltvTime(value: String): Double? = GuideTime.milliseconds(value, GuideTimeFormat.BROWSER)?.div(1000)

@JsExport
fun normalizedChannelName(value: String): String = GuideNames.normalized(value)

@JsExport
fun canonicalChannelName(value: String): String = GuideNames.canonical(value)

@JsExport
fun chooseGuideChannel(ids: Array<String>, exact: Array<Array<String>>, aliases: Array<Array<String>>): String? =
    GuideNames.chooseOrdered(ids.toList(), exact.map { it.toList() }, aliases.map { it.toList() })

@JsExport
class ScheduleSelection(val current: Int, val next: Int, val from: Double, val until: Double)

/** JS objects stay with the adapter; only numbers enter the common schedule rules. */
@JsExport
fun selectGuideSchedule(entries: dynamic, now: Double, openEnds: Boolean): ScheduleSelection {
    fun field(index: Int, name: String): Double {
        val entry = entries[index]
        if (entry == null) return Double.NaN
        val value = entry[name]
        if (name == "end" && value == null && openEnds) return Double.POSITIVE_INFINITY
        return if (jsTypeOf(value) == "number") value.unsafeCast<Double>() else Double.NaN
    }
    val result = GuideSchedule.select(entries.length.unsafeCast<Int>(), { field(it, "start") }, { field(it, "end") }, now, openEnds)
    return ScheduleSelection(result.current, result.next, result.from, result.until)
}

private fun nativeFormat(value: String): NativeGuideFormat = when (value) {
    "rust" -> NativeGuideFormat.RUST
    "web" -> NativeGuideFormat.WEB
    "swift" -> NativeGuideFormat.SWIFT
    "archived-android" -> NativeGuideFormat.ARCHIVED_ANDROID
    else -> error("Unknown native guide format: $value")
}

@JsExport
fun nativeGuideTime(value: String, format: String): Double = nativeClocks.getValue(nativeFormat(format)).seconds(value)

private val nativeClocks = NativeGuideFormat.entries.associateWith { NativeGuideClock(it) }

@JsExport
fun nativeGuideName(value: String, format: String): String = NativeGuideNames.normalized(value, nativeFormat(format))

@JsExport
fun nativeGuideStripShift(value: String, format: String): String = NativeGuideNames.stripShift(value, nativeFormat(format))

@JsExport
fun nativeGuideShift(value: String, format: String): Int = NativeGuideNames.regionalShift(value, nativeFormat(format))

@JsExport
class NativeMatch(val id: String, val score: Double)

@JsExport
class NativeGuide(rows: Array<Array<String>>, format: String, measure: (String) -> Int, precision: (Double) -> Double) {
    private val index = NativeGuideIndex(rows.map { NativeGuideEntry(it[0], it[1]) }, nativeFormat(format), measure, precision)
    fun match(value: String): NativeMatch? = index.match(value)?.let { NativeMatch(it.id, it.score) }
    fun resolve(id: String, candidates: Array<String>): String? = index.resolve(id, candidates.toList())
}

/** Flat triples: source row index, shifted start, shifted stop. */
@JsExport
fun nativeGuideSlice(times: Array<Array<Double>>, now: Double, archiveHours: Double, shiftHours: Double): Array<Array<Double>> {
    val window = NativeGuideWindow(now, archiveHours, shiftHours)
    return times.mapIndexedNotNull { index, pair ->
        if (window.includes(pair[0], pair[1])) arrayOf(index.toDouble(), pair[0] + window.shift, pair[1] + window.shift) else null
    }.toTypedArray()
}

@JsExport
fun archiveUrl(input: dynamic, calendar: (Double) -> Array<Int>, resolveUrl: (String) -> String?): String? {
    fun text(key: String): String = if (input[key] == null) "" else input[key].unsafeCast<String>()
    val request = ArchiveRequest(
        url = text("url"), mode = text("mode"), source = text("source"),
        days = input.days.unsafeCast<Double>(), start = input.start.unsafeCast<Double>(),
        end = input.end.unsafeCast<Double>(), now = input.now.unsafeCast<Double>(), correction = input.correction.unsafeCast<Double>(),
        programmeId = text("programmeId"), base = text("base"), streamId = text("streamId"), extension = text("extension"),
        username = input.username.unsafeCast<String?>(), password = input.password.unsafeCast<String?>(),
    )
    return Archive.resolve(request, ArchiveFormat.BROWSER, { calendar(it).toList() }, resolveUrl)
}

@JsExport
fun providerArchiveUrl(profile: String, url: String, source: String, mode: String, start: Double, end: Double, now: Double, dune: Boolean, variant: Int): String? =
    Archive.provider(profile, url, source, mode, start, end, now, dune, variant)

@JsExport
fun parseBrowserPlaylist(text: String, prefix: String, sourceId: String, resolve: (String) -> String,
    hash: (String) -> String, component: (String) -> String): dynamic {
    val result: dynamic = js("({})")
    val parsed = try { Playlist.read(text, PlaylistFormat.BROWSER, prefix, resolve, { hash(it[0]) }, component) }
        catch (failure: PlaylistFailure) { result.failure = failure.code; return result }
    result.channels = parsed.entries.map { entry ->
        val row: dynamic = js("({})")
        row.id = entry.id; row.name = entry.name; row.url = entry.url; row.group = entry.group; row.logo = entry.logo
        row.tvgId = entry.epgId; row.tvgName = entry.epgName; row.kind = if (entry.movie) "vod" else "live"
        row.sourceId = sourceId; row.tvgShift = entry.shift; row.epgUrls = entry.epgUrls.toTypedArray()
        entry.archive?.let {
            val archive: dynamic = js("({})")
            archive.type = it.mode; archive.source = it.source; archive.days = it.days; archive.correction = it.correction
            row.catchup = archive
        }
        row
    }.toTypedArray()
    result.epgUrls = parsed.epgUrls.toTypedArray(); result.warnings = parsed.warnings.toTypedArray()
    return result
}

@JsExport
fun legacyPlaylistAttribute(text: String, name: String): String = ProviderPlaylist.attribute(text, name)

@JsExport
fun parseProviderPlaylist(text: String, profile: String, hash: (String) -> Double, fallbackHours: Double): dynamic {
    val parsed = ProviderPlaylist.read(text, if (profile == "generic") ProviderPlaylistFormat.GENERIC else ProviderPlaylistFormat.M3U, hash, fallbackHours)
    val result: dynamic = js("({})")
    result.header = parsed.header
    result.ids = parsed.entries.map { it.id }.toTypedArray()
    result.groups = js("Object.create(null)")
    parsed.groups.forEach { (key, ids) -> result.groups[key] = ids.toTypedArray() }
    result.groupOrder = parsed.groupOrder.toTypedArray()
    result.channels = js("Object.create(null)")
    result.entries = parsed.entries.map { entry ->
        val row: dynamic = js("({})")
        row.id = entry.id; row.name = entry.name; row.url = entry.url; row.group = entry.group; row.category = entry.category
        row.logo = entry.logo; row.epgId = entry.epgId; row.epgName = entry.epgName; row.archiveHours = entry.archiveHours
        row.archiveMode = entry.archiveMode; row.archiveSource = entry.archiveSource; row.shift = entry.shift
        row.raw = entry.raw; row.titleHashInput = entry.titleHashInput; row.generatedName = entry.generatedName
        val channel: dynamic = js("({})")
        channel.ca = entry.archiveMode; channel.caso = entry.archiveSource
        channel.category = js("({})"); channel.category.`class` = entry.category; channel.category.name = entry.group
        channel.channel_name = entry.name; channel.epg = entry.epgId; channel.logo = entry.logo; channel.rec = entry.archiveHours
        channel.time = 0; channel.time_to = 0; channel.tn = entry.epgName; channel.url = entry.url
        if (entry.shift != 0.0) channel.ts = entry.shift
        result.channels[entry.id] = channel
        row
    }.toTypedArray()
    return result
}

@JsExport
fun parsePlaylistMedia(text: String): dynamic = OperatorPlaylist.media(text).map { entry ->
    val row: dynamic = js("({})")
    row.name = entry.name; row.generatedName = entry.generatedName; row.url = entry.url; row.logo = entry.logo
    row
}.toTypedArray()

@JsExport
fun parseOperatorPlaylist(text: String, profile: String, hash: (String) -> Double, existing: Array<String>): dynamic {
    val parsed = OperatorPlaylist.read(text, profile, hash, existing.toSet())
    val result: dynamic = js("({})")
    fun key(value: Any?): dynamic = value ?: js("undefined")
    result.ids = parsed.entries.map { key(it.id) }.toTypedArray()
    result.groups = js("Object.create(null)")
    parsed.groups.forEach { (name, ids) -> result.groups[name] = ids.map { key(it) }.toTypedArray() }
    result.groupOrder = parsed.groupOrder.toTypedArray()
    result.channels = js("Object.create(null)")
    result.malformed = parsed.malformed
    result.entries = parsed.entries.map { entry ->
        val channel: dynamic = js("({})")
        channel.category = js("({})"); channel.category.`class` = entry.category; channel.category.name = entry.group
        if (profile != "shura") {
            channel.channel_name = entry.name; channel.url = entry.url; channel.logo = entry.logo
            channel.rec = entry.hours ?: entry.fallbackHours; channel.time = 0; channel.time_to = 0
            if (profile != "tvteam") channel.epg = entry.epgId
            if (profile == "edem" || profile == "kb-team") {
                channel.ca = entry.mode; channel.caso = entry.archive; channel.tn = entry.epgName; channel.utvg = entry.feed
            }
            if (profile == "kb-team") channel.drm = entry.drm
            if (profile == "shara-tv") { channel.ch_id = entry.id; channel.aurl = entry.archive }
            if (profile == "antifriz") { channel.epg_id = entry.epgId; channel.server = entry.server; channel.token = entry.token }
        }
        result.channels[key(entry.id)] = channel
        val row: dynamic = js("({})")
        row.id = key(entry.id); row.generatedName = entry.generatedName; row.channel = channel
        row
    }.toTypedArray()
    return result
}
