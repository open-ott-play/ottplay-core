@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

private fun guideText(value: dynamic): String = if (value == null) "" else js("String(value)").unsafeCast<String>()
private fun guideArray(value: dynamic): Array<dynamic> = if (value == null) emptyArray() else value.unsafeCast<Array<dynamic>>()
private fun guideKeys(value: dynamic): Array<String> = if (value == null) emptyArray() else js("Object.keys(value)").unsafeCast<Array<String>>()
private fun guideOwn(value: dynamic, key: String): Boolean = value != null && js("Object.prototype.hasOwnProperty.call(value,key)").unsafeCast<Boolean>()
private fun dictionary(): dynamic = js("Object.create(null)")

private fun coverage(value: GuideCoverage): dynamic {
    val result: dynamic = js("({})")
    result.limited = value.limited; result.windowStart = value.windowStart; result.windowEnd = value.windowEnd
    result.programmeLimit = value.programmeLimit; result.truncatedChannels = value.truncatedChannels
    return result
}

/** Map public objects while preserving programme references and schedule-array aliases. */
private class GuideModels(private val programme: (GuideRecord) -> dynamic) {
    private val stations: dynamic = js("new Map()")
    private val schedules: dynamic = js("new Map()")
    private fun station(value: GuideStation): dynamic {
        if (stations.has(value).unsafeCast<Boolean>()) return stations.get(value)
        val result: dynamic = js("({})")
        result.id = value.id; result.names = value.names.toTypedArray(); result.logo = value.logo
        if (value.sourceUrl != null) result.sourceUrl = value.sourceUrl
        stations.set(value, result)
        return result
    }
    fun catalog(value: GuideCatalog): dynamic {
        val result: dynamic = js("({})")
        result.channels = value.channels.map { station(it) }.toTypedArray()
        result.programmes = value.programmes.map(programme).toTypedArray()
        result.byId = dictionary(); result.byChannel = dictionary(); result.byName = dictionary(); result.byAlias = dictionary()
        value.byId.forEach { (key, row) -> result.byId[key] = station(row) }
        value.byChannel.forEach { (key, rows) ->
            if (!schedules.has(rows).unsafeCast<Boolean>()) schedules.set(rows, rows.map(programme).toTypedArray())
            result.byChannel[key] = schedules.get(rows)
        }
        value.byName.forEach { (key, ids) -> result.byName[key] = ids.toTypedArray() }
        value.byAlias.forEach { (key, ids) -> result.byAlias[key] = ids.toTypedArray() }
        return result
    }
}

@JsExport
fun parseBrowserGuide(stations: dynamic, programmes: dynamic, fields: dynamic, source: String, identity: String, icon: (String) -> String): dynamic {
    val parsed = GuideFeeds.parse(guideArray(stations).map { row -> GuideRawStation(guideText(row.id),
        guideArray(row.names).map(::guideText), guideArray(row.icons).map(::guideText)) }, guideArray(programmes).map { row ->
        GuideRawProgramme(guideText(row.channel), guideText(row.start), guideText(row.stop), guideText(row.title),
            guideText(row.description), guideText(row.catchupAttribute), guideText(row.catchupElement))
    }, icon)
    val records = mutableMapOf<Int, dynamic>()
    val models = GuideModels { row -> records.getOrPut(row.slot) {
        val value: dynamic = js("({})")
        value.channelId = row.channelId; value.start = row.start; value.end = row.end; value.title = row.title
        value.description = row.description; value.catchupId = row.catchupId; value
    } }
    val result = models.catalog(parsed.catalog)
    result.sourceUrl = source; result.feedIdentity = identity
    result.coverage = coverage(GuideCoverage.parse(guideKeys(fields).associateWith { guideText(fields[it]) }))
    result.warnings = parsed.warnings.toTypedArray()
    return result
}

@JsExport
fun mergeBrowserGuides(guides: dynamic, logo: (String) -> String): dynamic {
    val payloads = mutableListOf<dynamic>()
    val inputs = guideArray(guides).mapIndexedNotNull { index, source ->
        if (source == null) return@mapIndexedNotNull null
        val values = GuideCoverage.fromValue(wire(source.coverage))
        val url = guideText(source.sourceUrl)
        GuideFeedInput(url.ifEmpty { guideText(source.feedIdentity).ifEmpty { "anonymous-merge:$index" } }, url,
            guideArray(source.channels).map { row -> GuideStation(guideText(row.id), guideArray(row.names).map(::guideText).toMutableList(), guideText(row.logo)) },
            guideKeys(source.byChannel).toList(), guideArray(source.programmes).map { row ->
                val slot = payloads.size; payloads.add(row)
                GuideRecord(guideText(row.channelId), row.start.unsafeCast<Double>(), row.end.unsafeCast<Double?>(), guideText(row.title), slot)
            }, values, guideArray(source.warnings).map(::guideText))
    }
    val merged = GuideFeeds.merge(inputs, { feed, id -> js("JSON.stringify([feed,id])").unsafeCast<String>() }, logo)
    val models = GuideModels { payloads[it.slot] }
    val result = models.catalog(merged.catalog)
    result.byRawId = dictionary()
    merged.rawIds.forEach { (key, ids) -> result.byRawId[key] = ids.toTypedArray() }
    result.feeds = merged.feeds.map { group ->
        val feed: dynamic = js("({})")
        feed.identity = group.identity; feed.sourceUrl = group.sourceUrl; feed.keys = dictionary()
        group.keys.forEach { (id, key) -> feed.keys[id] = key }
        feed.guide = models.catalog(group.guide); feed
    }.toTypedArray()
    result.coverage = coverage(merged.coverage); result.warnings = merged.warnings.toTypedArray()
    return result
}

@JsExport
fun matchedGuideChannel(channel: dynamic, guide: dynamic): String {
    fun plain(value: dynamic, namesOnly: Boolean): String? {
        if (value == null || value.byChannel == null) return null
        return GuideFeeds.choose(guideText(channel?.tvgId), listOf(guideText(channel?.tvgName), guideText(channel?.name)), namesOnly,
            { id -> if (value.byRawId != null) { if (guideOwn(value.byRawId, id)) guideArray(value.byRawId[id]).map(::guideText) else emptyList() }
                else if (guideOwn(value.byChannel, id)) listOf(id) else emptyList() },
            { alias, key -> val map = if (alias) value.byAlias else value.byName
                if (guideOwn(map, key)) guideArray(map[key]).map(::guideText) else emptyList() },
            { guideOwn(value.byChannel, it) })
    }
    if (guide == null || guide.feeds == null) return plain(guide, false).orEmpty()
    val feeds = guideArray(guide.feeds)
    return GuideFeeds.chooseFeed(guideArray(channel?.epgUrls).map(::guideText), feeds.size,
        { guideText(feeds[it].sourceUrl) }, { index, namesOnly -> plain(if (index < 0) guide else feeds[index].guide, namesOnly) },
        { index, id -> guideText(feeds[index].keys[id]) }).orEmpty()
}

@JsExport
fun shiftBrowserGuide(entries: dynamic, hours: Double): dynamic {
    val shift = GuideProgrammeRules.browserShift(hours)
    if (shift == 0.0) return entries
    return guideArray(entries).map { entry ->
        val row: dynamic = js("({})")
        guideKeys(entry).forEach { row[it] = entry[it] }
        row.start = row.start + shift; row.end = row.end + shift; row
    }.toTypedArray()
}

private class BrowserLookupItem(val value: dynamic) {
    val schedule = GuideScheduleMemo()
}

@JsExport
class BrowserGuideLookup(limit: Double, entryLimit: Double) {
    private val cache = GuideLookupCache<String, BrowserLookupItem>(limit, entryLimit)
    private var source: dynamic = null
    fun clear() { source = null; cache.clear() }
    fun lookup(key: String, guide: dynamic, now: Double, materialize: () -> dynamic): dynamic {
        if (source !== guide) { clear(); source = guide }
        val item = cache.get(key) ?: BrowserLookupItem(materialize()).also {
            val entries = it.value.entries
            cache.put(key, it, if (entries === it.value.unshifted) 0 else entries.length.unsafeCast<Int>())
        }
        val rows = item.value.entries
        fun field(index: Int, name: String): Double {
            val row = rows[index]
            val value = if (row == null) null else row[name]
            return if (jsTypeOf(value) == "number") value.unsafeCast<Double>() else Double.NaN
        }
        val selected = item.schedule.select(rows.length.unsafeCast<Int>(), { field(it, "start") }, { field(it, "end") }, now)
        val result: dynamic = js("({})")
        result.metadata = item.value.metadata; result.entries = rows
        result.current = if (selected.current < 0) null else rows[selected.current]
        result.next = if (selected.next < 0) null else rows[selected.next]
        return result
    }
}

@JsExport
fun legacyGuideSelection(rows: dynamic, now: Double, nextCount: Double): dynamic {
    val values = guideArray(rows)
    val selected = LegacyGuideSchedule.select(values.size, { wire(values[it].time).number() }, { wire(values[it].time_to).number() }, now, nextCount)
    val result: dynamic = js("({})")
    result.current = if (selected.current < 0) null else values[selected.current]
    result.following = selected.following.map { values[it] }.toTypedArray()
    result.retryAt = selected.retryAt
    return result
}

@JsExport
fun legacyGuideShift(rows: dynamic, shift: dynamic): dynamic {
    if (jsTypeOf(shift) != "number") return rows
    guideArray(rows).forEach { row ->
        if (row != null && GuideProgrammeRules.legacyShift(shift.unsafeCast<Double>(), wire(row.time).number(), wire(row.time_to).number())) {
            row.time = row.time + shift; row.time_to = row.time_to + shift
        }
    }
    return rows
}

@JsExport
fun legacyGuideCacheCapacity(value: Double): Double = GuideResponseCache.capacity(value)

@JsExport
fun legacyGuideCacheRead(rows: dynamic, fetched: dynamic, capacity: Double, clock: () -> Double): Int {
    val values = guideArray(rows)
    return GuideResponseCache.read(capacity, values.size,
        if (jsTypeOf(fetched) == "undefined") null else wire(fetched).number(), { wire(values[it].time_to).number() }, clock)
}

@JsExport
fun legacyGuideCacheOrder(order: Array<Double>, id: Double, limit: Double?, remove: Boolean): dynamic {
    val (retained, evicted) = GuideResponseCache.touch(order.toList(), id, limit, remove)
    // The classic API exposes this array; preserve its identity when publishing core state.
    val target: dynamic = order
    target.length = 0
    retained.forEach { target.push(it) }
    return evicted.toTypedArray()
}
