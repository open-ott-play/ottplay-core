package play.ott.core

import kotlin.math.abs
import kotlin.math.floor

data class StreamingGuideIdentity(val id: String, val tvgName: String, val name: String, val days: Double) {
    val names: List<String> get() = listOf(tvgName, name)
}

data class StreamingGuideCoverage(val start: Double, val end: Double, val programmeLimit: Double, val truncatedChannels: Int)

/** Bounded streaming selection. XML, HTTP, UTF-8 byte counts and programme payloads belong to the host. */
class StreamingGuide<T>(private val requested: List<StreamingGuideIdentity>, private val clock: Double,
    private val programmeLimit: Double, private val perChannel: Double) {
    private class Entry<T>(val id: String, val start: Double, val end: Double?, val payload: T)
    private val idDepths = linkedMapOf<String, Double>()
    private val nameDepths = linkedMapOf<String, Double>()
    private val aliasDepths = linkedMapOf<String, Double>()
    private val candidateDepths = mutableMapOf<String, Double>()
    private val metadata = linkedMapOf<String, GuideStation>()
    private val aliases = mutableMapOf<String, MutableSet<String>>()
    private val canonicalAliases = mutableMapOf<String, MutableSet<String>>()
    private val programmes = mutableMapOf<String, MutableList<Entry<T>>>()
    // Only timing/identity is needed here. Do not retain a discarded payload through this index.
    private val nextCandidates = mutableMapOf<String, Entry<Unit>>()
    private val nextEntries = mutableMapOf<String, Entry<T>>()
    private val truncated = mutableSetOf<String>()
    private var programmeCount = 0
    private var programmeCap = perChannel
    private var candidateCount: Int
    private val startWindow = clock - (requested.maxOfOrNull { it.days } ?: 1.0) * 86400
    private val endWindow = clock + 86400

    init {
        for (row in requested) {
            retainDepth(idDepths, row.id, row.days)
            for (name in row.names) {
                retainDepth(nameDepths, name, row.days)
                retainDepth(aliasDepths, GuideNames.canonical(name), row.days)
            }
        }
        candidateCount = idDepths.size
    }

    private fun retainDepth(index: MutableMap<String, Double>, key: String, days: Double) {
        if (key.isNotEmpty()) index[key] = maxOf(index[key] ?: 1.0, days)
    }

    /** False means the matching metadata bound was exceeded; unrelated channels consume no slots. */
    fun channel(id: String, names: List<String>, icon: String): Boolean {
        val matches = names.map(GuideNames::normalized).filter { it in nameDepths }
        val canonicalMatches = names.map(GuideNames::canonical).filter { it in aliasDepths }
        if (id !in idDepths && matches.isEmpty() && canonicalMatches.isEmpty()) return true
        if (metadata.size >= 16384 && id !in metadata) return false
        var days = idDepths[id] ?: 1.0
        for (name in matches) days = maxOf(days, nameDepths[name] ?: 1.0)
        for (name in canonicalMatches) days = maxOf(days, aliasDepths[name] ?: 1.0)
        retainDepth(candidateDepths, id, days)
        val previous = metadata[id]
        if (previous == null) {
            metadata[id] = GuideStation(id, names.toMutableList(), icon)
            if (id !in idDepths) candidateCount++
        } else {
            // The first fragment preserves duplicate display names; a later fragment deduplicates all names.
            val combined = (previous.names + names).distinct()
            previous.names.clear(); previous.names.addAll(combined)
            if (previous.logo.isEmpty()) previous.logo = icon
        }
        for (name in matches) aliases.getOrPut(name) { linkedSetOf() }.add(id)
        for (name in canonicalMatches) canonicalAliases.getOrPut(name) { linkedSetOf() }.add(id)
        return true
    }

    fun accepts(id: String, start: Double?, end: Double?): Boolean {
        val lower = clock - maxOf(idDepths[id] ?: 1.0, candidateDepths[id] ?: 1.0) * 86400
        return start != null && start < endWindow &&
            (if (end == null) start >= lower else end > lower && end > start) && (id in idDepths || id in metadata)
    }

    private fun priority(entry: Entry<T>): Double =
        if (entry.start <= clock && (entry.end == null || entry.end > clock)) -1e12 + clock - entry.start
        else if (nextEntries[entry.id] === entry) -5e11 + entry.start - clock
        else abs(entry.start - clock)

    /** Called after accepts and decoding. A rejected row is never retained by the core. */
    fun programme(id: String, start: Double, end: Double?, payload: T) {
        programmeCap = maxOf(1.0, minOf(programmeCap, floor(programmeLimit / maxOf(1, candidateCount, requested.size))))
        val entries = programmes.getOrPut(id) { mutableListOf() }
        val item = Entry(id, start, end, payload)
        if (start > clock && (nextCandidates[id] == null || start < nextCandidates.getValue(id).start)) {
            nextCandidates[id] = Entry(id, start, end, Unit)
            nextEntries[id] = item
            entries.sortWith(compareBy(::priority))
        }
        val score = priority(item)
        if (entries.size >= programmeCap) {
            truncated.add(id)
            if (score >= priority(entries.last())) {
                if (nextEntries[id] === item) nextEntries.remove(id)
                return
            }
            val removed = entries.removeAt(entries.lastIndex)
            if (nextEntries[id] === removed) nextEntries.remove(id)
            programmeCount--
        }
        if (programmeCount >= programmeLimit) {
            truncated.add(id)
            if (nextEntries[id] === item) nextEntries.remove(id)
            return
        }
        var low = 0
        var high = entries.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (priority(entries[middle]) <= score) low = middle + 1 else high = middle
        }
        entries.add(low, item); programmeCount++
    }

    /** Encoders are host codecs. Count bytes before emitting; an oversized programme does not starve later channels. */
    fun output(limit: Double, channel: (GuideStation) -> String, programme: (String, T) -> String,
        bytes: (String) -> Int, emit: (String) -> Unit): StreamingGuideCoverage? {
        val selected = linkedMapOf<String, Double>()
        for (row in requested) {
            val id = GuideNames.chooseOrdered(
                if (row.id.isNotEmpty() && (row.id in metadata || row.id in programmes)) listOf(row.id) else emptyList(),
                row.names.map { aliases[it]?.toList().orEmpty() },
                row.names.map { canonicalAliases[GuideNames.canonical(it)]?.toList().orEmpty() })
            if (id != null) selected[id] = maxOf(selected[id] ?: 1.0, row.days)
        }
        var size = 512.0 // Reserve the existing XML header/trailer budget.
        // Ambiguous, unselected metadata must survive or the browser would see a false unique alias.
        for (id in (metadata.keys + selected.keys).distinct()) {
            val fragment = channel(metadata[id] ?: GuideStation(id))
            size += bytes(fragment)
            if (size > limit) return null
            emit(fragment)
        }
        val schedules = selected.map { (id, days) ->
            val lower = clock - days * 86400
            val entries = programmes[id].orEmpty().filter { if (it.end == null) it.start >= lower else it.end > lower }
            val selection = GuideSchedule.select(entries.size, { entries[it].start }, { entries[it].end ?: Double.POSITIVE_INFINITY }, clock, true)
            val current = entries.getOrNull(selection.current)
            val next = entries.getOrNull(selection.next)
            id to (listOfNotNull(current, next) + entries.filter { it !== current && it !== next })
        }
        var count = 0
        var round = 0
        while (round < perChannel) {
            for ((id, entries) in schedules) {
                val entry = entries.getOrNull(round) ?: continue
                val fragment = programme(id, entry.payload)
                val length = bytes(fragment)
                if (size + length > limit || count >= programmeLimit) { truncated.add(id); continue }
                size += length; count++; emit(fragment)
            }
            round++
        }
        return StreamingGuideCoverage(floor(startWindow), floor(endWindow), programmeCap, truncated.count { it in selected })
    }

    companion object {
        /** Validation of wire types/lengths is a host concern; identity and archive-depth merging are shared rules. */
        fun identities(rows: List<StreamingGuideIdentity>): List<StreamingGuideIdentity> {
            val result = linkedMapOf<Triple<String, String, String>, StreamingGuideIdentity>()
            for (raw in rows) {
                val key = Triple(CoreText.trim(raw.id), GuideNames.normalized(raw.tvgName), GuideNames.normalized(raw.name))
                require(key.first.isNotEmpty() || key.second.isNotEmpty() || key.third.isNotEmpty())
                result[key] = StreamingGuideIdentity(key.first, key.second, key.third, maxOf(1.0, raw.days, result[key]?.days ?: 0.0))
            }
            return result.values.toList()
        }
    }
}
