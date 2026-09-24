package play.ott.core

/** A programme belongs to a source and channel, independent of its title or end-time corrections. */
data class ProgrammeId(val sourceId: String, val channelId: String, val itemId: String) {
    init { require(sourceId.isNotBlank() && channelId.isNotBlank() && itemId.isNotBlank()) }
    fun key(): String = "programme:" + listOf(sourceId, channelId, itemId).joinToString("") { "${it.length}:$it" }
    companion object {
        fun of(sourceId: String, channelId: String, providerId: String?, start: Double): ProgrammeId {
            val item = providerId?.takeIf { it.isNotBlank() }?.let { "provider:$it" } ?: run {
                require(start.isFinite()) { "A programme without a provider ID requires a finite start" }
                // IEEE bits have the same representation on JVM and JS, including fractional epochs.
                "start:" + (if (start == 0.0) 0.0 else start).toBits().toString(16)
            }
            return ProgrammeId(sourceId, channelId, item)
        }
    }
}

data class GuideTimelineSelection(val current: Int, val following: List<Int>, val retryAt: Double)

object GuideTimeline {
    /** Reuse the common half-open/latest-start selection policy; no host clock, cache or UI state. */
    fun select(count: Int, start: (Int) -> Double, end: (Int) -> Double, now: Double, nextCount: Double): GuideTimelineSelection {
        if (!now.isFinite()) return GuideTimelineSelection(-1, emptyList(), 0.0)
        val window = GuideSchedule.select(count, start, end, now)
        val limit = if (nextCount.isNaN() || nextCount <= 0) 0 else kotlin.math.floor(nextCount).coerceAtMost(1000.0).toInt()
        val following = (0 until count).filter {
            start(it).isFinite() && end(it).isFinite() && end(it) > start(it) && start(it) > now
        }.sortedWith(compareBy<Int> { start(it) }.thenBy { it }).take(limit)
        var retry = now + 3600
        if (window.current >= 0) retry = minOf(retry, end(window.current))
        if (window.next >= 0) retry = minOf(retry, start(window.next))
        return GuideTimelineSelection(window.current, following, retry)
    }
}
