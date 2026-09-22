package play.ott.core

data class GuideCoverage(val limited: Boolean = false, val windowStart: Double? = null, val windowEnd: Double? = null,
    val programmeLimit: Int? = null, val truncatedChannels: Int = 0) {
    fun merge(other: GuideCoverage): GuideCoverage = GuideCoverage(
        limited || other.limited || truncatedChannels + other.truncatedChannels > 0,
        listOfNotNull(windowStart, other.windowStart).minOrNull(),
        listOfNotNull(windowEnd, other.windowEnd).maxOrNull(),
        listOfNotNull(programmeLimit, other.programmeLimit).minOrNull(),
        minOf(50000, truncatedChannels + other.truncatedChannels),
    )
    companion object {
        fun fromValue(value: ProviderValue): GuideCoverage {
            fun number(key: String): Double? = value[key].takeIf { it.kind == ProviderValueKind.NUMBER }?.number()?.takeIf { it.isFinite() }
            fun positive(key: String): Int? = number(key)?.takeIf { it in 1.0..50000.0 && kotlin.math.floor(it) == it }?.toInt()
            val start = number("windowStart")
            val end = number("windowEnd")
            val valid = start != null && end != null && end > start
            val truncated = positive("truncatedChannels") ?: 0
            return GuideCoverage(value["limited"].kind == ProviderValueKind.BOOLEAN && value["limited"].scalar == "true" || truncated > 0,
                if (valid) start else null, if (valid) end else null, positive("programmeLimit"), truncated)
        }
        fun parse(fields: Map<String, String?>): GuideCoverage {
            fun number(key: String, positive: Boolean = false): Double? {
                val text = CoreText.trim(fields[key].orEmpty())
                val digits = if (text.startsWith('-')) text.drop(1) else text
                if (digits.isEmpty() || digits.any { it !in '0'..'9' }) return null
                val value = text.toDoubleOrNull() ?: return null
                return value.takeIf { it.isFinite() && kotlin.math.abs(it) <= 8640000000000 && (!positive || it in 1.0..50000.0) }
            }
            val start = number("data-window-start")
            val end = number("data-window-end")
            val window = start != null && end != null && end > start
            val truncated = number("data-truncated-channels", true)?.toInt() ?: 0
            return GuideCoverage(fields["data-truncated"] == "true" || truncated > 0, if (window) start else null,
                if (window) end else null, number("data-programme-limit", true)?.toInt(), truncated)
        }
    }
}

data class GuideStation(val id: String, val names: MutableList<String> = mutableListOf(), var logo: String = "", val sourceUrl: String? = null)
data class GuideRecord(val channelId: String, val start: Double, val end: Double?, val title: String, val slot: Int,
    val description: String = "", val catchupId: String = "")
data class GuideRawStation(val id: String, val names: List<String>, val icons: List<String>)
data class GuideRawProgramme(val channel: String, val start: String, val stop: String, val title: String,
    val description: String, val catchupAttribute: String, val catchupElement: String)

/** Index construction, metadata ownership and normalization have one implementation. */
class GuideCatalog {
    val channels = mutableListOf<GuideStation>()
    val programmes = mutableListOf<GuideRecord>()
    val byChannel = linkedMapOf<String, MutableList<GuideRecord>>()
    val byId = linkedMapOf<String, GuideStation>()
    val byName = linkedMapOf<String, MutableList<String>>()
    val byAlias = linkedMapOf<String, MutableList<String>>()
    fun addName(name: String, id: String) {
        val exact = GuideNames.normalized(name)
        if (exact.isEmpty()) return
        fun add(index: MutableMap<String, MutableList<String>>, key: String) {
            if (key.isEmpty()) return
            val ids = index.getOrPut(key) { mutableListOf() }
            if (id !in ids) ids.add(id)
        }
        add(byName, exact)
        add(byAlias, GuideNames.canonical(name))
    }
}

data class GuideFeedInput(val identity: String, val sourceUrl: String, val channels: List<GuideStation>,
    val scheduleIds: List<String>, val programmes: List<GuideRecord>, val coverage: GuideCoverage,
    val warnings: List<String>)
class GuideFeedGroup(val identity: String, val sourceUrl: String) {
    val keys = linkedMapOf<String, String>()
    val guide = GuideCatalog()
    internal val seen = mutableSetOf<List<Any?>>()
}
data class GuideMerge(val catalog: GuideCatalog, val feeds: List<GuideFeedGroup>, val rawIds: Map<String, List<String>>,
    val coverage: GuideCoverage, val warnings: List<String>)
data class GuideParsed(val catalog: GuideCatalog, val warnings: List<String>)

object GuideFeeds {
    /** Preserve the public JS map order for numeric channel IDs on every target. */
    fun keyOrder(keys: Collection<String>): List<String> {
        fun index(value: String): Long? = value.toLongOrNull()?.takeIf { it in 0..4294967294L && it.toString() == value }
        return keys.filter { index(it) != null }.sortedBy { index(it) } + keys.filter { index(it) == null }
    }
    private val chronological = compareBy<GuideRecord> { it.start }.thenBy { it.end ?: 0.0 }

    fun parse(stations: List<GuideRawStation>, rows: List<GuideRawProgramme>, icon: (String) -> String): GuideParsed {
        val result = GuideCatalog()
        val warnings = mutableListOf<String>()
        for (raw in stations) {
            val id = CoreText.trim(raw.id)
            if (id.isEmpty()) continue
            val channel = result.byId.getOrPut(id) {
                GuideStation(id).also { result.channels.add(it); result.byChannel[id] = mutableListOf() }
            }
            for (name in raw.names) if (GuideNames.normalized(name).isNotEmpty()) {
                val trimmed = CoreText.trim(name)
                if (trimmed !in channel.names) channel.names.add(trimmed)
                result.addName(name, id)
            }
            for (url in raw.icons) if (channel.logo.isEmpty()) channel.logo = icon(url)
        }
        for ((slot, raw) in rows.withIndex()) {
            val id = CoreText.trim(raw.channel)
            val start = GuideTime.milliseconds(raw.start, GuideTimeFormat.BROWSER)?.div(1000)
            val end = GuideTime.milliseconds(raw.stop, GuideTimeFormat.BROWSER)?.div(1000)
            if (id.isEmpty() || start == null || raw.stop.isNotEmpty() && (end == null || end <= start)) {
                warnings.add("Ignored a programme with invalid channel or time")
                continue
            }
            result.byChannel.getOrPut(id) { mutableListOf() }.add(GuideRecord(id, start, end, CoreText.trim(raw.title), slot,
                CoreText.trim(raw.description), CoreText.trim(raw.catchupAttribute).ifEmpty { CoreText.trim(raw.catchupElement) }))
        }
        for (id in keyOrder(result.byChannel.keys)) {
            val ordered = result.byChannel.getValue(id).sortedWith(chronological.thenBy { it.title }).toMutableList()
            var nextStart: Double? = null
            var groupStart: Double? = null
            for (index in ordered.indices.reversed()) {
                val entry = ordered[index]
                if (groupStart == null) groupStart = entry.start
                else if (entry.start < groupStart) { nextStart = groupStart; groupStart = entry.start }
                if (entry.end == null) ordered[index] = entry.copy(end = nextStart)
            }
            val seen = mutableSetOf<Triple<Double, Double, String>>()
            val retained = mutableListOf<GuideRecord>()
            for (entry in ordered) {
                if (entry.end == null || entry.end <= entry.start) {
                    warnings.add("Ignored a programme without a known end time")
                    continue
                }
                if (seen.add(Triple(entry.start, entry.end, entry.title))) retained.add(entry)
            }
            result.byChannel[id] = retained
            result.programmes.addAll(retained)
        }
        result.programmes.sortWith(compareBy<GuideRecord> { it.start }.thenBy { it.channelId })
        return GuideParsed(result, warnings)
    }

    fun merge(inputs: List<GuideFeedInput>, qualify: (String, String) -> String, logo: (String) -> String): GuideMerge {
        val groups = linkedMapOf<String, GuideFeedGroup>()
        val result = GuideCatalog()
        val rawIds = linkedMapOf<String, MutableList<String>>()
        var coverage = GuideCoverage()
        val warnings = mutableListOf<String>()
        for (input in inputs) {
            val group = groups.getOrPut(input.identity) { GuideFeedGroup(input.identity, input.sourceUrl) }
            coverage = coverage.merge(input.coverage)
            input.scheduleIds.forEach { group.guide.byChannel.getOrPut(it) { mutableListOf() } }
            for (channel in input.channels) {
                val metadata = group.guide.byId.getOrPut(channel.id) {
                    GuideStation(channel.id, sourceUrl = group.sourceUrl).also { group.guide.channels.add(it) }
                }
                if (metadata.logo.isEmpty()) metadata.logo = logo(channel.logo)
                for (name in channel.names) {
                    if (name !in metadata.names) metadata.names.add(name)
                    group.guide.addName(name, channel.id)
                }
            }
            for (entry in input.programmes) if (group.seen.add(listOf(entry.channelId, entry.start, entry.end, entry.title))) {
                group.guide.byChannel.getOrPut(entry.channelId) { mutableListOf() }.add(entry)
                group.guide.programmes.add(entry)
            }
            warnings.addAll(input.warnings)
        }
        for (group in groups.values) {
            for (id in keyOrder(group.guide.byChannel.keys)) {
                val key = qualify(group.identity, id)
                group.keys[id] = key
                val rows = group.guide.byChannel.getValue(id)
                rows.sortWith(chronological)
                result.byChannel[key] = rows
                rawIds.getOrPut(id) { mutableListOf() }.add(key)
                val channel = group.guide.byId[id] ?: GuideStation(id, sourceUrl = group.sourceUrl)
                result.byId[key] = channel
                result.channels.add(channel)
                channel.names.forEach { result.addName(it, key) }
            }
            result.programmes.addAll(group.guide.programmes)
        }
        for ((id, keys) in rawIds) if (keys.size == 1 && id !in result.byChannel) {
            result.byChannel[id] = result.byChannel.getValue(keys[0])
            result.byId[id] = result.byId.getValue(keys[0])
        }
        result.programmes.sortWith(chronological)
        return GuideMerge(result, groups.values.toList(), rawIds, coverage, warnings)
    }

    /** A station in a preferred feed owns its metadata even when its schedule is empty. */
    fun chooseFeed(affinity: List<String>, count: Int, source: (Int) -> String,
        match: (Int, Boolean) -> String?, qualify: (Int, String) -> String): String? {
        for (url in affinity) for (index in 0 until count) if (source(index) == url) {
            val id = match(index, false)
            if (!id.isNullOrEmpty()) return qualify(index, id)
        }
        return match(-1, affinity.isNotEmpty())
    }

    fun choose(id: String, names: List<String>, namesOnly: Boolean, ids: (String) -> List<String>,
        candidates: (Boolean, String) -> List<String>, exists: (String) -> Boolean): String? {
        val normalized = names.map(GuideNames::normalized)
        fun matches(alias: Boolean, name: String): List<String> {
            if (name.isEmpty()) return emptyList()
            val values = candidates(alias, name)
            return if (values.size == 1 && !exists(values[0])) emptyList() else values
        }
        val key = CoreText.trim(id)
        return GuideNames.chooseOrdered(if (namesOnly || key.isEmpty()) emptyList() else ids(key),
            normalized.map { matches(false, it) }, normalized.map { matches(true, GuideNames.canonical(it)) })
    }
}
