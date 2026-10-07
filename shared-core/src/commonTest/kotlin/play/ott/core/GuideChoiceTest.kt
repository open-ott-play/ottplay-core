package play.ott.core

import kotlin.random.Random
import kotlin.test.*

class GuideChoiceTest {
    // Retain f9bb4d6's eager implementation as the result oracle, not its lookup count.
    private fun eager(id: String, names: List<String>, namesOnly: Boolean, ids: (String) -> List<String>,
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

    @Test fun uniqueIdSkipsAllNameLookupsAndRetainsIdPolicy() {
        val trace = mutableListOf<String>()
        val result = GuideFeeds.choose(" id ", listOf("News HD"), false,
            { trace.add("id:$it"); listOf("id") },
            { _, _ -> error("A unique ID must not query name indexes") },
            { error("ID candidates retain their existing existence policy") })
        assertEquals("id", result)
        assertEquals(listOf("id:id"), trace)
    }

    @Test fun allExactNamesPrecedeAliasesAndNamesOnlySkipsId() {
        val trace = mutableListOf<String>()
        val result = GuideFeeds.choose("id", listOf("Alpha HD", "Beta"), true,
            { error("Names-only matching must not query IDs") },
            { alias, name ->
                assertFalse(alias, "A later exact name wins over any quality alias")
                trace.add(name)
                if (name == "alpha hd") listOf("a", "b") else listOf("b")
            }, { it == "b" })
        assertEquals("b", result)
        assertEquals(listOf("alpha hd", "beta"), trace)
    }

    @Test fun staleAndAmbiguousNamesAllowLaterUniqueAlias() {
        val trace = mutableListOf<String>()
        val result = GuideFeeds.choose("", listOf("Alpha HD", "Beta UHD"), false,
            { error("Empty IDs do not query the index") },
            { alias, name ->
                trace.add("$alias:$name")
                when {
                    !alias && name == "alpha hd" -> listOf("a", "b")
                    alias && name == "beta" -> listOf("b")
                    else -> listOf("stale")
                }
            }, { it == "b" })
        assertEquals("b", result)
        assertEquals(listOf("false:alpha hd", "false:beta uhd", "true:alpha", "true:beta"), trace)
    }

    @Test fun pureIndexesMatchTheEagerOracleAcrossUnicodeAmbiguityAndMissingRows() {
        val random = Random(701)
        val rawNames = listOf("", " \t", " Alpha HD ", "HD Alpha", "Alpha", "Beta UHD", "4K Beta",
            "İSTANBUL HD", "ΣΟΣ", "News\u00a0HD", "Россия-1", "News +7", "\u200b", "Cafe\u0301")
        val keys = rawNames.map(GuideNames::normalized) + rawNames.map(GuideNames::canonical)
        val possibilities = listOf(emptyList(), listOf("a"), listOf("b"), listOf("stale"),
            listOf("a", "b"), listOf("b", "a"), listOf("a", "a"))
        repeat(2500) { case ->
            val exact = keys.associateWith { possibilities[random.nextInt(possibilities.size)] }
            val aliases = keys.associateWith { possibilities[random.nextInt(possibilities.size)] }
            val idRows = possibilities[random.nextInt(possibilities.size)]
            val names = List(random.nextInt(5)) { rawNames[random.nextInt(rawNames.size)] }
            val id = if (random.nextBoolean()) " id " else ""
            val namesOnly = random.nextBoolean()
            val ids: (String) -> List<String> = { idRows }
            val candidates: (Boolean, String) -> List<String> = { alias, name ->
                (if (alias) aliases else exact)[name].orEmpty()
            }
            val exists: (String) -> Boolean = { it == "a" || it == "b" }
            assertEquals(eager(id, names, namesOnly, ids, candidates, exists),
                GuideFeeds.choose(id, names, namesOnly, ids, candidates, exists), "case $case")
        }
    }
}
