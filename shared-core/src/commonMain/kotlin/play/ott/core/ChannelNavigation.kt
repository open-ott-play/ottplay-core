package play.ott.core

enum class ChannelMovementFormat { BROWSER, CLASSIC, NATIVE }
object ChannelMovement {
    fun index(current: Double, count: Int, direction: Int, format: ChannelMovementFormat): Double {
        val step = if (direction > 0) 1 else -1
        if (format == ChannelMovementFormat.CLASSIC) {
            val next = current + step
            return if (step > 0 && next >= count) 0.0 else if (step < 0 && next < 0) count - 1.0 else next
        }
        if (count <= 0 || format == ChannelMovementFormat.NATIVE && (direction == 0 || current < 0)) return -1.0
        if (current < 0) return if (step > 0) 0.0 else count - 1.0
        return (current + step + count) % count
    }
}

data class ChannelCandidate(val id: String, val live: Boolean)

/** Selects source-local live entries and admits only the newest asynchronous switch. */
class ChannelNavigation {
    private var ids = emptyList<String>()
    private var target: String? = null
    private var generation = 0L
    private var catalogGeneration = 0L

    fun available(current: String?): Boolean = ids.size > 1 && (target ?: current) in ids
    fun cancel() { generation++; target = null }
    fun beginCatalog(): Long { catalogGeneration++; ids = emptyList(); return catalogGeneration }
    fun acceptCatalog(token: Long, expected: String, current: String?, candidates: List<ChannelCandidate>): List<Int>? {
        if (token != catalogGeneration || current != expected) return null
        val seen = mutableSetOf<String>()
        val selected = candidates.indices.filter { candidates[it].live && seen.add(candidates[it].id) }
        if (selected.none { candidates[it].id == expected }) { ids = emptyList(); return emptyList() }
        ids = selected.map { candidates[it].id }
        return selected
    }
    fun nextIndex(direction: Int, current: String?): Int {
        if (!available(current)) return -1
        return ChannelMovement.index(ids.indexOf(target ?: current).toDouble(), ids.size, direction, ChannelMovementFormat.NATIVE).toInt()
    }
    fun beginSwitch(index: Int): Long { generation++; target = ids[index]; return generation }
    fun canCommit(token: Long, origin: String?, current: String?) = token == generation && origin == current
    fun fail(token: Long): Boolean {
        if (token != generation) return false
        target = null
        return true
    }
    fun close() { cancel(); beginCatalog() }
}
