package play.ott.core

/** Indices preserve host programme identity without copying titles, URLs or credentials. */
data class GuideWindow(val current: Int, val next: Int, val from: Double, val until: Double)

class GuideScheduleMemo {
    private var window = GuideWindow(-1, -1, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)
    fun select(count: Int, start: (Int) -> Double, end: (Int) -> Double, now: Double): GuideWindow {
        if (!now.isFinite()) return GuideWindow(-1, -1, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)
        if (now < window.from || now >= window.until) window = GuideSchedule.select(count, start, end, now)
        return window
    }
}

object GuideSchedule {
    /** Half-open intervals; latest-starting overlap wins, ties retain input order.
     * [from, until) is the maximal safe cache interval for this selection.
     * A streaming feed may use positive infinity for a missing stop time.
     */
    fun select(count: Int, start: (Int) -> Double, end: (Int) -> Double, now: Double, openEnds: Boolean = false): GuideWindow {
        if (!now.isFinite()) return GuideWindow(-1, -1, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)
        var current = -1
        var next = -1
        var currentStart = Double.NEGATIVE_INFINITY
        var nextStart = Double.POSITIVE_INFINITY
        var from = Double.NEGATIVE_INFINITY
        var until = Double.POSITIVE_INFINITY
        for (index in 0 until count) {
            val begins = start(index)
            val ends = end(index)
            if (!begins.isFinite() || (!ends.isFinite() && !(openEnds && ends == Double.POSITIVE_INFINITY)) || ends <= begins) continue
            if (begins <= now && now < ends && begins > currentStart) { current = index; currentStart = begins }
            if (begins > now && begins < nextStart) { next = index; nextStart = begins }
            if (begins <= now) from = maxOf(from, begins) else until = minOf(until, begins)
            if (ends <= now) from = maxOf(from, ends) else until = minOf(until, ends)
        }
        return GuideWindow(current, next, from, until)
    }
}
