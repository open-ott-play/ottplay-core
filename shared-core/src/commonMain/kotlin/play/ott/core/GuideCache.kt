package play.ott.core

/** Bounded match cache: a stable working set plus rotating slots for long catalog scans. */
class GuideLookupCache<K, V>(limit: Double, entryLimit: Double) {
    private data class Slot<V>(val value: V, val weight: Int)
    private val slots = mutableMapOf<K, Slot<V>>()
    private val order = mutableListOf<K>()
    private val capacity = bounded(limit, 1024, 8192)
    private val weightLimit = bounded(entryLimit, 65536, 65536)
    private val protected = capacity * 3 / 4
    private var cursor = 0
    private var weight = 0
    fun clear() { slots.clear(); order.clear(); cursor = 0; weight = 0 }
    fun get(key: K): V? = slots[key]?.value
    fun put(key: K, value: V, cost: Int) {
        val victim = if (order.size == capacity) order[maxOf(cursor, protected)] else null
        val retained = weight + cost - (slots[victim]?.weight ?: 0)
        if (retained > weightLimit) return
        if (order.size < capacity) order.add(key)
        else {
            cursor = maxOf(cursor, protected)
            slots.remove(victim)
            order[cursor] = key
            cursor = if (cursor + 1 < capacity) cursor + 1 else protected
        }
        weight = retained
        slots[key] = Slot(value, cost)
    }
    companion object {
        private fun bounded(value: Double, fallback: Int, maximum: Int): Int =
            kotlin.math.floor(if (value.isNaN() || value == 0.0) fallback.toDouble() else value).coerceIn(1.0, maximum.toDouble()).toInt()
    }
}

object GuideResponseCache {
    fun capacity(value: Double): Double = if (value.isFinite() && value > 0) kotlin.math.floor(value) else 0.0
    /** 0: absent/disabled, -1: evict stale data, 1: hit. The clock is supplied by the host. */
    fun read(capacity: Double, count: Int, fetched: Double?, end: (Int) -> Double, clock: () -> Double): Int {
        if (capacity <= 0 || count == 0 || fetched == null) return 0
        if (clock() - fetched >= 12 * 60 * 60 * 1000) return -1
        return if ((0 until count).any { end(it) >= clock() / 1000 }) 1 else -1
    }
    fun <K> touch(order: List<K>, id: K, limit: Double?, remove: Boolean = false): Pair<List<K>, List<K>> {
        val next = order.toMutableList()
        next.remove(id)
        if (!remove) next.add(0, id)
        val size = limit?.coerceAtMost(next.size.toDouble())?.toInt() ?: next.size
        return next.take(size) to next.drop(size)
    }
}

data class LegacyGuideSelection(val current: Int, val following: List<Int>, val retryAt: Double)

object LegacyGuideSchedule {
    /** The classic player retains inclusive ends and the earliest overlapping start. */
    fun select(count: Int, start: (Int) -> Double, end: (Int) -> Double, now: Double, nextCount: Double): LegacyGuideSelection {
        val ordered = (0 until count).sortedWith { left, right ->
            val delta = start(left) - start(right)
            when { delta < 0 -> -1; delta > 0 -> 1; else -> 0 }
        }
        val position = ordered.indexOfFirst { end(it) >= now && start(it) <= now }
        if (position < 0) return LegacyGuideSelection(-1, emptyList(), now + 3600)
        val requested = position + 2 + nextCount
        val integer = if (requested.isNaN()) 0.0 else if (requested < 0) kotlin.math.ceil(requested) else kotlin.math.floor(requested)
        val until = (if (integer < 0) count + integer else integer).coerceIn(0.0, count.toDouble()).toInt()
        return LegacyGuideSelection(ordered[position], if (until <= position + 1) emptyList() else ordered.subList(position + 1, until), 0.0)
    }
}

object GuideProgrammeRules {
    fun browserShift(hours: Double): Double = if (hours.isFinite() && kotlin.math.abs(hours) <= 24) hours * 3600 else 0.0
    fun legacyShift(shift: Double, start: Double, end: Double): Boolean = shift != 0.0 && !shift.isNaN() && start > 0 && end > 0
    fun validAndroid(channel: String, start: Long?, end: Long?): Boolean = channel.isNotBlank() && start != null && end != null && end > start
    /** Preserve the first title/description at a duplicate Android channel/time interval. */
    fun androidOrder(count: Int, channel: (Int) -> String, start: (Int) -> Long, end: (Int) -> Long): List<Int> {
        val seen = mutableSetOf<Triple<String, Long, Long>>()
        return (0 until count).filter { seen.add(Triple(channel(it), start(it), end(it))) }
            .sortedWith(compareBy<Int> { channel(it) }.thenBy { start(it) })
    }
}
