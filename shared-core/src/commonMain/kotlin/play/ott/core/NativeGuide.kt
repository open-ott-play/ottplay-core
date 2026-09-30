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

    internal fun hasShift(value: String, format: NativeGuideFormat): Boolean =
        stripShift(value, format) != CoreText.trim(value) { space(it, format) }

    internal fun intact(value: String, format: NativeGuideFormat): String {
        val collapsed = CoreText.normalizedSpaces(value.lowercase()) { space(it, format) }
        return if (format == NativeGuideFormat.ARCHIVED_ANDROID)
            CoreText.trim(collapsed, CoreText::androidSpace) else collapsed
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
    private data class Name(val id: String, val original: String, val text: String, val length: Int, val words: Set<String>)
    private val ids = entries.map { it.id }.toSet()
    private val names = entries.map { entry ->
        val name = NativeGuideNames.normalized(entry.name, format)
        Name(entry.id, entry.name, name, measure(name), name.split(' ').toSet())
    }.filter { it.text.isNotEmpty() }
    private val exact = mutableMapOf<String, String>().also { map ->
        for (name in names) if (name.text !in map) map[name.text] = name.id
    }
    private class IntactNames(entries: List<Name>, format: NativeGuideFormat) {
        val exact = unique(entries) { NativeGuideNames.intact(it, format) }
        val quality = unique(entries) { GuideNames.stripQuality(NativeGuideNames.intact(it, format)) }

        private fun unique(entries: List<Name>, key: (String) -> String): Map<String, String?> {
            val result = mutableMapOf<String, String?>()
            for (entry in entries) {
                val name = key(entry.original)
                if (name !in result) result[name] = entry.id
                else if (result[name] != entry.id) result[name] = null
            }
            return result
        }
    }
    // Only collisions can change the legacy first-ID answer. Keep their intact
    // aliases so an unshifted name cannot lose to a stripped regional suffix.
    // Empty normalized names cannot reach this map: they have no exact entry.
    private val intact = names.groupBy { it.text }
        .filterValues { rows -> rows.any { it.id != rows[0].id } }
        .mapValues { (_, rows) -> IntactNames(rows, format) }
    // UTF-16 indexes only exclude impossible substrings; scoring still uses the
    // caller's length/precision primitives. The trie includes one/two-unit names.
    private val grams = mutableMapOf<String, MutableList<Int>>()
    private val containedNames = ContainedNames(names)
    private val wordNames = mutableMapOf<String, MutableList<Int>>()

    /** Compact immutable edges avoid allocating/hashing every query substring. */
    private class ContainedNames(names: List<Name>) {
        private val edgeStarts: IntArray
        private val edgeUnits: IntArray
        private val edgeTargets: IntArray
        private val rowStarts: IntArray
        private val rows: IntArray

        init {
            val parents = mutableListOf(-1)
            val units = mutableListOf(0)
            val path = mutableListOf(0)
            val terminals = IntArray(names.size)
            var previous = ""
            // UTF-16 lexical order creates each parent's edges in code-unit order.
            // Reuse the common prefix rather than allocate a map/list per node.
            for (row in names.indices.sortedBy { names[it].text }) {
                val text = names[row].text
                var common = 0
                while (common < previous.length && common < text.length && previous[common] == text[common]) common++
                while (path.size > common + 1) path.removeAt(path.lastIndex)
                for (index in common until text.length) {
                    val node = parents.size
                    parents.add(path.last())
                    units.add(text[index].code)
                    path.add(node)
                }
                terminals[row] = path.last()
                previous = text
            }
            edgeStarts = IntArray(parents.size + 1)
            rowStarts = IntArray(parents.size + 1)
            for (node in 1 until parents.size) edgeStarts[parents[node] + 1]++
            for (node in terminals) rowStarts[node + 1]++
            for (node in 1..parents.size) {
                edgeStarts[node] += edgeStarts[node - 1]
                rowStarts[node] += rowStarts[node - 1]
            }
            edgeUnits = IntArray(parents.size - 1)
            edgeTargets = IntArray(parents.size - 1)
            rows = IntArray(names.size)
            val edgeCursor = edgeStarts.copyOf()
            for (node in 1 until parents.size) {
                val edge = edgeCursor[parents[node]]++
                edgeUnits[edge] = units[node]
                edgeTargets[edge] = node
            }
            val rowCursor = rowStarts.copyOf()
            // Terminal postings retain original row order, including duplicates.
            for (row in names.indices) rows[rowCursor[terminals[row]]++] = row
        }

        fun addMatches(candidate: String, selected: MutableSet<Int>) {
            val visitedTerminals = mutableSetOf<Int>()
            // Traverse UTF-16 units, including isolated surrogates, just like
            // String.contains. Continue past terminals to find longer aliases.
            for (start in candidate.indices) {
                var node = 0
                var end = start
                while (end < candidate.length) {
                    val unit = candidate[end++].code
                    var low = edgeStarts[node]
                    var high = edgeStarts[node + 1] - 1
                    var target = -1
                    while (low <= high) {
                        val middle = (low + high).ushr(1)
                        val next = edgeUnits[middle]
                        if (next < unit) low = middle + 1
                        else if (next > unit) high = middle - 1
                        else { target = edgeTargets[middle]; break }
                    }
                    if (target < 0) break
                    node = target
                    val first = rowStarts[node]
                    val limit = rowStarts[node + 1]
                    // Repeated occurrences cannot add new aliases. Expand each
                    // terminal once, but keep traversing toward longer names.
                    if (first < limit && visitedTerminals.add(node))
                        for (row in first until limit) selected.add(rows[row])
                }
            }
        }
    }

    init {
        fun add(index: MutableMap<String, MutableList<Int>>, key: String, row: Int) {
            val posting = index.getOrPut(key) { mutableListOf() }
            if (posting.lastOrNull() != row) posting.add(row)
        }
        for ((row, name) in names.withIndex()) {
            for (start in 0..name.text.length - 3)
                add(grams, name.text.substring(start, start + 3), row)
            if (name.words.size >= 2)
                for (word in name.words) add(wordNames, word, row)
        }
    }

    private fun candidates(candidate: String, words: Set<String>): List<Int> {
        // A short query has no trigram. Keep its exact historical scan, including
        // inside-word and supplementary-character matches, without a larger index.
        if (candidate.length < 3) return names.indices.toList()
        val selected = mutableSetOf<Int>()
        var containing: List<Int>? = null
        for (start in 0..candidate.length - 3) {
            val posting = grams[candidate.substring(start, start + 3)]
            if (posting == null) { containing = emptyList(); break }
            if (containing == null || posting.size < containing.size) containing = posting
        }
        if (containing != null) selected.addAll(containing)
        containedNames.addMatches(candidate, selected)
        if (words.size >= 2)
            for (word in words) wordNames[word]?.let { selected.addAll(it) }
        // Index lookup order must not replace first-alias precedence on score ties.
        return selected.sorted()
    }

    private fun fuzzy(candidate: String): NativeGuideMatch? {
        if (candidate.isEmpty()) return null
        val length = measure(candidate)
        val words = candidate.split(' ').toSet()
        var best: NativeGuideMatch? = null
        for (row in candidates(candidate, words)) {
            val name = names[row]
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
        for ((index, name) in normalized.withIndex()) {
            val first = exact[name] ?: continue
            val candidate = candidates[index]
            val identity = intact[name]
            // This refines one existing candidate bucket, not candidate priority
            // or regional timing. Shifted requests and ambiguous aliases retain
            // the legacy answer; callers continue to apply their existing shift.
            if (identity != null && !NativeGuideNames.hasShift(candidate, format)) {
                val key = NativeGuideNames.intact(candidate, format)
                identity.exact[key]?.let { return it }
                identity.quality[GuideNames.stripQuality(key)]?.let { return it }
            }
            return first
        }
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
