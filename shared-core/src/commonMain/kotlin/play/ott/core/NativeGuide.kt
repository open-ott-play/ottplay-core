package play.ott.core

/** Compatibility at the input boundary, separate from browser guide identity rules. */
enum class NativeGuideFormat { RUST, SWIFT, ARCHIVED_ANDROID, WEB }

object NativeGuideNames {
    private fun space(c: Char, format: NativeGuideFormat): Boolean =
        when (format) {
            NativeGuideFormat.ARCHIVED_ANDROID -> CoreText.asciiSpace(c)
            NativeGuideFormat.WEB -> CoreText.space(c)
            else -> CoreText.unicodeSpace(c)
        }

    private data class Shift(val end: Int, val digits: String, val sign: Int)

    private fun shiftAt(value: String, start: Int, format: NativeGuideFormat): Shift? {
        if (value[start] != '+' && value[start] != '-') return null
        var end = start + 1
        while (end < value.length && space(value[end], format)) end++
        val digits = end
        while (end < value.length) {
            if (format == NativeGuideFormat.ARCHIVED_ANDROID || format == NativeGuideFormat.WEB) {
                if (value[end] !in '0'..'9') break
                end++
            } else {
                val digit = CoreText.digitAt(value, end) ?: break
                end += digit.second
            }
        }
        if (digits == end) return null
        val number = value.substring(digits, end)
        while (end < value.length && space(value[end], format)) end++
        // Historical expressions consume the first 'h', also in "hours".
        if (end < value.length && (value[end] == 'h' || value[end] == 'ч')) end++
        return Shift(end, number, if (value[start] == '-') -1 else 1)
    }

    fun stripShift(value: String, format: NativeGuideFormat = NativeGuideFormat.RUST): String {
        val result = StringBuilder()
        var index = 0
        while (index < value.length) {
            val shift = shiftAt(value, index, format)
            if (shift == null) result.append(value[index++]) else index = shift.end
        }
        return CoreText.trim(result.toString()) { space(it, format) }
    }

    fun regionalShift(value: String, format: NativeGuideFormat = NativeGuideFormat.RUST): Int {
        for (index in value.indices) {
            val shift = shiftAt(value, index, format) ?: continue
            // The previous hosts only parsed ASCII decimal hours, despite Unicode matching.
            if (shift.digits.any { it !in '0'..'9' }) return 0
            val hours = shift.digits.toLongOrNull() ?: return 0
            if (format == NativeGuideFormat.ARCHIVED_ANDROID && hours > Int.MAX_VALUE) return 0
            return shift.sign * (if (hours > 24) hours % 24 else hours).toInt()
        }
        return 0
    }

    fun normalized(value: String, format: NativeGuideFormat = NativeGuideFormat.RUST): String {
        val shifted = stripShift(value.lowercase(), format)
        val result = StringBuilder()
        var index = 0
        while (index < shifted.length) {
            val end = if (shifted[index] == '(') shifted.indexOf(')', index + 1) else -1
            if (end < 0) result.append(shifted[index++]) else index = end + 1
        }
        val collapsed = CoreText.normalizedSpaces(result.toString()) { space(it, format) }
        return GuideNames.stripQuality(if (format == NativeGuideFormat.ARCHIVED_ANDROID)
            CoreText.trim(collapsed, CoreText::androidSpace) else collapsed)
    }
}

data class NativeGuideEntry(val id: String, val name: String)
data class NativeGuideMatch(val id: String, val score: Double)

/** Caller supplies row order, Unicode length and numeric precision of its public contract.
 * Those primitives do not choose channels. Indexing and every matching decision live here.
 */
class NativeGuideIndex(
    entries: List<NativeGuideEntry>,
    private val format: NativeGuideFormat = NativeGuideFormat.RUST,
    private val measure: (String) -> Int = { it.length },
    private val precision: (Double) -> Double = { it }
) {
    private data class Name(val id: String, val text: String, val length: Int, val words: Set<String>)
    private val ids = entries.map { it.id }.toSet()
    private val names = entries.map { entry ->
        val name = NativeGuideNames.normalized(entry.name, format)
        Name(entry.id, name, measure(name), name.split(' ').toSet())
    }.filter { it.text.isNotEmpty() }
    private val exact = mutableMapOf<String, String>().also { map ->
        for (name in names) if (name.text !in map) map[name.text] = name.id
    }

    private fun fuzzy(candidate: String): NativeGuideMatch? {
        if (candidate.isEmpty()) return null
        val length = measure(candidate)
        val words = candidate.split(' ').toSet()
        var best: NativeGuideMatch? = null
        for (name in names) {
            val score = if (candidate.contains(name.text) || name.text.contains(candidate)) {
                precision(precision(minOf(length, name.length).toDouble()) / precision(maxOf(length, name.length).toDouble()))
            } else {
                val common = words.count { it in name.words }
                if (common < maxOf(2, minOf(words.size, name.words.size) / 2)) continue
                precision(precision(common.toDouble()) / precision(maxOf(words.size, name.words.size).toDouble()))
            }
            if (score >= precision(0.4) && score > (best?.score ?: 0.0)) best = NativeGuideMatch(name.id, score)
        }
        return best
    }

    fun match(value: String): NativeGuideMatch? {
        val candidate = NativeGuideNames.normalized(value, format)
        exact[candidate]?.let { return NativeGuideMatch(it, 1.0) }
        return fuzzy(candidate)
    }

    fun resolve(id: String, candidates: List<String>): String? {
        if (id.isNotEmpty() && id in ids) return id
        val normalized = candidates.map { NativeGuideNames.normalized(it, format) }
        for (name in normalized) exact[name]?.let { return it }
        var best: NativeGuideMatch? = null
        for (name in normalized) {
            val next = fuzzy(name) ?: continue
            if (next.score > (best?.score ?: 0.0)) best = next
        }
        return best?.id
    }
}

/** Seconds throughout; the adapter owns the clock and output objects. */
class NativeGuideWindow(now: Double, archiveHours: Double, timeShiftHours: Double) {
    val shift: Double = timeShiftHours * 3600
    private val from = now - (if (archiveHours > 0) archiveHours else 48.0) * 3600
    private val until = now + 48 * 3600
    fun includes(start: Double, stop: Double): Boolean = stop + shift > from && start + shift < until
}
