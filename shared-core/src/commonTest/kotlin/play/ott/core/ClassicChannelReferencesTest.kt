package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class ClassicChannelReferencesTest {
    // Explicit ECMAScript golden vectors, NOT a claim that JVM Double.toString is compatible.
    private val numbers = mapOf(
        "0" to "0", "-0" to "0", "-00" to "0", "00" to "0",
        "1" to "1", "1.0" to "1", "01" to "1", "001" to "1", "-1" to "-1", "1e+21" to "1e+21",
        "2" to "2", "3" to "3", "4" to "4", "5" to "5", "6" to "6",
        "9007199254740993" to "9007199254740992", "9007199254740992" to "9007199254740992",
        "1000000000000000000000" to "1e+21",
        "1000000000000000128" to "1000000000000000100", "1000000000000000100" to "1000000000000000100",
    )
    private val codec: (String) -> String? = { raw ->
        if (raw.length > 309) null else checkNotNull(numbers[raw]) { "Missing JS numeric golden: $raw" }
    }
    private fun text(value: String) = ProviderValue.text(value)
    private fun graph(rows: List<ClassicChannelReferenceRow>, vararg aliases: Pair<String, ProviderValue>) = ClassicChannelReferences(rows, aliases.toList(), codec)
    private fun row(key: String, item: String? = null, legacy: String? = null) = ClassicChannelReferenceRow(key, item, legacy?.let(::text) ?: ProviderValue.missing)

    @Test fun rawAndCanonicalOriginsHaveDifferentAliasSemantics() {
        val graph = graph(listOf(row("1", "first"), row("2", "second", "1")))
        assertEquals("first", graph.resolve(text("1"), "canonical").itemId)
        assertTrue(graph.resolve(text("1"), "raw").ambiguous)
        assertNull(graph.resolve(text("1"), "raw").itemId)
        assertEquals("second", graph.resolve(text("2"), "raw").itemId)
    }

    @Test fun transitiveAliasesCyclesSelfEdgesAndInvalidTargets() {
        val rows = listOf(row("3", "third"))
        val chain = graph(rows, "1" to text("2"), "2" to text("3"))
        assertEquals("third", chain.resolve(text("1")).itemId)
        assertTrue(graph(rows, "1" to text("2"), "2" to text("1")).resolve(text("1")).ambiguous)
        assertTrue(graph(rows, "1" to text("1")).resolve(text("1")).ambiguous)
        assertEquals("third", graph(rows, "3" to text("3")).resolve(text("3")).itemId)
        assertTrue(graph(rows, "3" to ProviderValue.nil).resolve(text("3")).ambiguous)
        assertFalse(graph(rows).resolve(text("1")).ambiguous)
    }

    @Test fun duplicateItemsResolveButCannotProjectAndBranchesDeduplicateByItem() {
        val graph = graph(listOf(row("2", "shared", "1"), row("3", "shared", "1")))
        val reference = graph.resolve(text("1"))
        assertEquals("shared", reference.itemId)
        assertNull(graph.project(reference))
        assertNull(graph.project(null))
        assertNull(graph.project(ClassicChannelReference(itemId = "missing")))
        val collision = graph(listOf(row("01", "same"), row("1", "same")))
        assertEquals(1.0, collision.project(collision.resolve(text("001"))))
    }

    @Test fun invalidAndPendingValuesRetainOriginalTypeAndBytes() {
        val graph = graph(listOf(row("1")))
        for (raw in listOf(text("1e3"), text("+1"), text(" 1"), text("1.0"), text(""),
            text("9".repeat(310)), ProviderValue.nil, ProviderValue(ProviderValueKind.BOOLEAN, "true"),
            ProviderValue(ProviderValueKind.NUMBER, "1e+21"))) {
            val reference = graph.resolve(raw, "canonical")
            assertSame(raw, reference.legacyId)
            assertEquals("canonical", reference.origin)
            assertFalse(reference.ambiguous)
            assertNull(reference.itemId)
        }
    }

    @Test fun javascriptRoundingExponentAndNegativeZeroAreHostPrimitives() {
        val graph = graph(listOf(row("-00"), row("9007199254740993"), row("1000000000000000000000"), row("1000000000000000128")))
        assertEquals("channel:0", graph.resolve(text("00")).itemId)
        assertEquals("channel:9007199254740992", graph.resolve(text("9007199254740992")).itemId)
        assertEquals("channel:1e+21", graph.resolve(text("1000000000000000000000")).itemId)
        assertEquals("channel:1000000000000000100", graph.resolve(text("1000000000000000100")).itemId)
        val number = graph(listOf(row("1", "one")))
        assertEquals("one", number.resolve(ProviderValue(ProviderValueKind.NUMBER, "1.0")).itemId)
        assertNull(number.resolve(text("1.0")).itemId)
        // Legacy edges revalidate normalized targets; exponential text is intentionally uncertain.
        val edge = graph(listOf(row("1000000000000000000000", "large", "1")))
        assertTrue(edge.resolve(text("1")).ambiguous)
    }

    @Test fun normalizedDuplicateNumberKeepsLatestItemButOldProjectionLikeClassic() {
        val graph = graph(listOf(row("1", "older"), row("01", "newer")))
        assertEquals("newer", graph.resolve(text("1"), "canonical").itemId)
        assertEquals(1.0, graph.project(ClassicChannelReference(itemId = "older")))
        assertEquals(1.0, graph.project(ClassicChannelReference(itemId = "newer")))
    }
}
