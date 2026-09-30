package play.ott.core

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Retained pre-index scorer (51e60c5), with the intentional intact resolve rule
 * checked by scanning source rows rather than the production identity maps. */
private class LinearGuideOracle(
    private val entries: List<NativeGuideEntry>,
    private val format: NativeGuideFormat,
    private val measure: (String) -> Int,
    private val precision: (Double) -> Double
) {
    private data class Name(val id: String, val text: String, val length: Int, val words: Set<String>)
    private val ids = entries.map { it.id }.toSet()
    private val names = entries.map {
        val text = NativeGuideNames.normalized(it.name, format)
        Name(it.id, text, measure(text), text.split(' ').toSet())
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
        val name = NativeGuideNames.normalized(value, format)
        return exact[name]?.let { NativeGuideMatch(it, 1.0) } ?: fuzzy(name)
    }
    fun resolve(id: String, candidates: List<String>): String? {
        if (id.isNotEmpty() && id in ids) return id
        val normalized = candidates.map { NativeGuideNames.normalized(it, format) }
        for ((index, name) in normalized.withIndex()) {
            val first = exact[name] ?: continue
            val candidate = candidates[index]
            if (!NativeGuideNames.hasShift(candidate, format)) {
                val bucket = entries.filter { NativeGuideNames.normalized(it.name, format) == name }
                val identities: List<(String) -> String> = listOf(
                    { NativeGuideNames.intact(it, format) },
                    { GuideNames.stripQuality(NativeGuideNames.intact(it, format)) })
                for (identity in identities) {
                    val query = identity(candidate)
                    bucket.filter { identity(it.name) == query }.map { it.id }.distinct()
                        .singleOrNull()?.let { return it }
                }
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

class NativeGuideIndexTest {
    @Test fun lexicalTriePackingRetainsUnsortedPrefixesAndUtf16Edges() {
        val values = listOf("zeta", "aba", "ab", "a", "a💥", "a\ud83d", "a\udca5", "\uffff", "a\ue000", "a",
            "\u0000", "a\u0000", "a\u0001")
        val rows = values.mapIndexed { index, text -> NativeGuideEntry("id$index", text) }
        for (format in NativeGuideFormat.entries)
            for (ordered in listOf(emptyList(), rows, rows.reversed(), rows.drop(4) + rows.take(4))) {
                val oracle = LinearGuideOracle(ordered, format, { it.length }, { it })
                val indexed = NativeGuideIndex(ordered, format)
                for (query in values + values.map { "x${it}x" } + listOf("abaaba", "x a💥 ab zeta y", "missing")) {
                    assertEquals(oracle.match(query), indexed.match(query), "$format/$query")
                    assertEquals(oracle.resolve("", listOf(query)), indexed.resolve("", listOf(query)), "$format/$query")
                }
            }
    }

    @Test fun reusedNormalizedBucketsRetainEmptyIdsAliasesAndTieOrder() {
        val rows = listOf(
            NativeGuideEntry("empty", ""), NativeGuideEntry("blank", " \t"),
            NativeGuideEntry("paren", "(UTC)"), NativeGuideEntry("shift-only", "+2"),
            NativeGuideEntry("shifted", "News +4"), NativeGuideEntry("base", "News HD"),
            NativeGuideEntry("base", "NEWS"), NativeGuideEntry("other", "News UHD"))
        for (format in NativeGuideFormat.entries) for (ordered in listOf(rows, rows.reversed())) {
            val oracle = LinearGuideOracle(ordered, format, { it.length }, { it })
            val indexed = NativeGuideIndex(ordered, format)
            for (id in listOf("empty", "blank", "paren", "shift-only"))
                assertEquals(id, indexed.resolve(id, listOf("News")))
            for (query in listOf("", " \t", "(UTC)", "+2", "News", "NEWS HD", "News UHD", "News +4", "x News y")) {
                assertEquals(oracle.match(query), indexed.match(query), "$format/$query")
                assertEquals(oracle.resolve("", listOf(query)), indexed.resolve("", listOf(query)), "$format/$query")
                assertEquals(oracle.resolve("", listOf(query, "News UHD")),
                    indexed.resolve("", listOf(query, "News UHD")), "$format/$query/fallback")
            }
            assertNull(indexed.match(""))
            assertNull(indexed.resolve("", listOf("")))
        }
    }

    @Test fun repeatedTerminalAliasesDoNotHideLongerContainedNames() {
        val rows = List(2048) { NativeGuideEntry("short$it", "a") } + listOf(
            NativeGuideEntry("first", "a".repeat(256)), NativeGuideEntry("second", "a".repeat(256)))
        val oracle = LinearGuideOracle(rows, NativeGuideFormat.WEB, { it.length }, { it })
        val indexed = NativeGuideIndex(rows, NativeGuideFormat.WEB)
        for (query in listOf("a".repeat(512), "a".repeat(511) + "b", "ba".repeat(256)))
            assertEquals(oracle.match(query), indexed.match(query))
        assertEquals(NativeGuideMatch("first", 0.5), indexed.match("a".repeat(512)))
        assertEquals("short0", indexed.resolve("", listOf("a".repeat(512), "a")))
    }

    @Test fun reverseSubstringTrieRetainsTerminalsAndUtf16Boundaries() {
        val rows = listOf("abc", "ab", "abcd", "bc", "c", "abc HD", "\ud83d", "\udca5", "💥",
            "💥ab", "x💥", "a b", "b a", "qualification", "qualifier", "__proto__")
            .mapIndexed { i, name -> NativeGuideEntry("id$i", name) }
        val queries = listOf("xabcdy", "xabcx", "xabx", "xcx", "abcabc", "x💥aby", "💥ab💥",
            "x\ud83dy", "x\udca5y", "x a b y", "prefix__proto__suffix",
            "ZZZ_OTTPLAY_QUALIFICATION_UNMATCHED_9E703D_2047_ALIAS")
        val measures: List<(String) -> Int> = listOf({ it.length }, { it.encodeToByteArray().size },
            { text -> text.count { !it.isLowSurrogate() } })
        for (format in NativeGuideFormat.entries) for (measure in measures)
            for (precision in listOf<(Double) -> Double>({ it }, { it.toFloat().toDouble() })) {
                val oracle = LinearGuideOracle(rows, format, measure, precision)
                val indexed = NativeGuideIndex(rows, format, measure, precision)
                for (query in queries) {
                    assertEquals(oracle.match(query), indexed.match(query), "$format/$query")
                    assertEquals(oracle.resolve("", listOf(query, "c")), indexed.resolve("", listOf(query, "c")))
                }
            }
    }

    @Test fun repeatedQueryPrefixesRetainOrderedScoring() {
        val rows = List(1024) { NativeGuideEntry("miss$it", "aaa$it") } + listOf(
            NativeGuideEntry("first", "a".repeat(256)), NativeGuideEntry("second", "a".repeat(256)))
        val oracle = LinearGuideOracle(rows, NativeGuideFormat.WEB, { it.length }, { it })
        val indexed = NativeGuideIndex(rows, NativeGuideFormat.WEB)
        for (query in listOf("a".repeat(512), "a".repeat(511) + "b", "xyz".repeat(170)))
            assertEquals(oracle.match(query), indexed.match(query))
        assertEquals(NativeGuideMatch("first", 0.5), indexed.match("a".repeat(512)))
    }

    @Test fun containmentPrecedesWordScoreAndThresholdIsInclusive() {
        assertNull(NativeGuideIndex(listOf(NativeGuideEntry("one", "a b x x x"))).match("a b"))
        assertEquals(NativeGuideMatch("one", 0.4), NativeGuideIndex(listOf(NativeGuideEntry("one", "abcde"))).match("ab"))
        assertEquals(NativeGuideMatch("one", 0.4), NativeGuideIndex(listOf(NativeGuideEntry("one", "ab"))).match("abcde"))
        assertEquals(NativeGuideMatch("one", 0.4), NativeGuideIndex(listOf(NativeGuideEntry("one", "a b c d e"))).match("a b f g h"))
        assertEquals(NativeGuideMatch("one", 2.0 / 3), NativeGuideIndex(listOf(NativeGuideEntry("one", "east news tv"))).match("west west news tv"))
    }

    @Test fun postingsCannotChangeAliasOrCandidateTieOrder() {
        for (rows in listOf(
            listOf(NativeGuideEntry("first", "abcx"), NativeGuideEntry("second", "xabc")),
            listOf(NativeGuideEntry("second", "xabc"), NativeGuideEntry("first", "abcx"))
        )) assertEquals(rows.first().id, NativeGuideIndex(rows).match("abc")?.id)
        val index = NativeGuideIndex(listOf(
            NativeGuideEntry(" raw ", ""), NativeGuideEntry("a", "abcdef"),
            NativeGuideEntry("b", "uvwxyz"), NativeGuideEntry("duplicate", "abcdef HD")))
        assertEquals(" raw ", index.resolve(" raw ", listOf("uvwxyz")))
        assertEquals("a", index.match("abcdef")?.id)
        assertEquals("a", index.resolve("", listOf("abc", "uvw")))
        assertEquals("b", index.resolve("", listOf("uvw", "abc")))
        assertEquals("b", index.resolve("", listOf("abc", "uvwxyz")))
    }

    @Test fun rustMatchesLinearOracleAcrossAdversarialNames() = checkProfile(NativeGuideFormat.RUST)
    @Test fun swiftMatchesLinearOracleAcrossAdversarialNames() = checkProfile(NativeGuideFormat.SWIFT)
    @Test fun archivedAndroidMatchesLinearOracleAcrossAdversarialNames() = checkProfile(NativeGuideFormat.ARCHIVED_ANDROID)
    @Test fun webMatchesLinearOracleAcrossAdversarialNames() = checkProfile(NativeGuideFormat.WEB)

    // Give each profile its own test budget while retaining the same deterministic
    // datasets, measures, precision modes and match/resolve assertions.
    private fun checkProfile(format: NativeGuideFormat) {
        val random = Random(91827)
        val tokens = listOf("a", "b", "ab", "abc", "xyz", "news", "tv", "east", "west", "sport",
            "РЕН", "ТВ", "яa", "ѐ", "é", "e\u0301", "💥", "𝟜", "١", "123", "__proto__", "constructor")
        val separators = listOf(" ", "  ", "\u00a0", "\u0085", "\ufeff")
        fun phrase(): String = List(random.nextInt(1, 6)) { tokens[random.nextInt(tokens.size)] }
            .joinToString(separators[random.nextInt(separators.size)])
        val measures: List<(String) -> Int> = listOf({ it.length }, { it.encodeToByteArray().size }, { text -> text.count { !it.isLowSurrogate() } })
        val precisions: List<(Double) -> Double> = listOf({ it }, { it.toFloat().toDouble() })
        val fixed = listOf("", "a", "ab", "abc", "abcd", "aaaaaa", "xyzabcxyz", "💥", "x💥y", "\ud800", "\udc00",
            "a b", "a b x x x", "west west news tv", " HD РЕН ТВ +3 (Москва)", "__proto__", "constructor")
        repeat(4) { generation ->
            val rows = (fixed + List(55) { phrase() }).mapIndexed { i, text -> NativeGuideEntry("id${i % 37}", text) }
            val queries = fixed + rows.map { it.name } + List(100) {
                when (random.nextInt(4)) {
                    0 -> "prefix " + rows[random.nextInt(rows.size)].name + " suffix"
                    1 -> rows[random.nextInt(rows.size)].name.take(random.nextInt(1, 7))
                    2 -> phrase() + " HD +7"
                    else -> phrase()
                }
            }
            for (measure in measures) for (precision in precisions) {
                val oracle = LinearGuideOracle(rows, format, measure, precision)
                val indexed = NativeGuideIndex(rows, format, measure, precision)
                for ((i, query) in queries.withIndex()) {
                    val context = "$generation/$format/$i/$query"
                    assertEquals(oracle.match(query), indexed.match(query), context)
                    val candidates = listOf(query, queries[(i + 1) % queries.size], query)
                    for (id in listOf("", "missing", rows[i % rows.size].id))
                        assertEquals(oracle.resolve(id, candidates), indexed.resolve(id, candidates), context + "/" + id)
                }
            }
        }
        // A new index must not retain aliases/postings from the previous feed.
        assertNull(NativeGuideIndex(listOf(NativeGuideEntry("new", "different"))).match("abcdef"))
    }
}
