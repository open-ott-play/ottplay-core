package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals

class NativeGuideIdentityTest {
    private val regional = listOf(
        NativeGuideEntry("1109", "СТС LOVE (+7)"),
        NativeGuideEntry("1109", "СТС Love +7"))
    private val base = listOf(
        NativeGuideEntry("1322", "СТС Love"),
        NativeGuideEntry("1322", "СТС Love orig"))

    @Test fun intactBaseIdentitySurvivesRegionalAliasAndIdOrder() {
        for (format in NativeGuideFormat.entries) {
            for (rows in listOf(regional + base, base + regional, (regional + base).reversed())) {
                val index = NativeGuideIndex(rows, format)
                for (name in listOf("СТС Love", "  стс  LOVE  ", "СТС Love HD", "СТС Love orig"))
                    assertEquals("1322", index.resolve("hlsproxy-409", listOf("", name)), "$format/$name")
                assertEquals("1109", index.resolve("1109", listOf("СТС Love")))
                assertEquals("1322", index.resolve("1322", listOf("СТС Love +7")))
                // Legacy match and shifted resolve still own their original regional policy.
                assertEquals(rows.first().id, index.resolve("missing", listOf("СТС Love +7")))
                assertEquals(rows.first().id, index.match("СТС Love")?.id)
            }
        }
    }

    @Test fun candidateOrderRemainsAheadOfLaterIntactIdentity() {
        for (format in NativeGuideFormat.entries) {
            val index = NativeGuideIndex(regional + base + NativeGuideEntry("cinema", "Cinema"), format)
            assertEquals("1109", index.resolve("", listOf("СТС Love +7", "Cinema")))
            assertEquals("1322", index.resolve("", listOf("СТС Love HD", "Cinema")))
            assertEquals("cinema", index.resolve("", listOf("Cinema", "СТС Love")))
            assertEquals("1322", index.resolve("", listOf("СТС Love Extra", "СТС Love")))
            assertEquals("cinema", index.resolve("", listOf("СТС Love Extra", "Cinema")))
        }
    }

    @Test fun shiftedRequestsRetainBaseFallbackAndCallerShift() {
        for (format in NativeGuideFormat.entries) {
            val index = NativeGuideIndex(base + regional, format)
            // Zero or unparseable numeric shifts still contain a syntactic marker.
            for (name in listOf("СТС Love +7", "СТС Love -7", "СТС Love +0", "СТС Love +48")) {
                assertEquals("1322", index.resolve("", listOf(name)), "$format/$name")
            }
            if (format == NativeGuideFormat.RUST || format == NativeGuideFormat.SWIFT)
                assertEquals("1322", index.resolve("", listOf("СТС Love +٤")))
            val markers = listOf("+7", "-7", "+0", "+48", "+9223372036854775808") +
                if (format == NativeGuideFormat.RUST || format == NativeGuideFormat.SWIFT) listOf("+٤", "+𝟜") else emptyList()
            for (marker in markers) {
                val query = "СТС Love $marker"
                val marked = NativeGuideIndex(listOf(
                    NativeGuideEntry("legacy", "СТС Love +3"),
                    NativeGuideEntry("literal", query), NativeGuideEntry("base", "СТС Love")), format)
                assertEquals("legacy", marked.resolve("", listOf(query)), "$format/$marker")
            }
            assertEquals("1322", NativeGuideIndex(base, format).resolve("", listOf("СТС Love +7")))
            val shift = NativeGuideNames.regionalShift("СТС Love +7", format)
            assertEquals(7, shift)
            assertEquals(25200.0, NativeGuideWindow(1790744580.0, 24.0, shift.toDouble()).shift)
        }
    }

    @Test fun ambiguousAndShiftedOnlyBucketsRetainFirstAliasFallback() {
        for (format in NativeGuideFormat.entries) {
            val ambiguous = NativeGuideIndex(regional + base + NativeGuideEntry("duplicate", "СТС Love"), format)
            assertEquals("1109", ambiguous.resolve("", listOf("СТС Love")))
            assertEquals("1109", NativeGuideIndex(regional, format).resolve("", listOf("СТС Love")))
            val quality = NativeGuideIndex(regional + NativeGuideEntry("1322", "СТС Love HD"), format)
            assertEquals("1322", quality.resolve("", listOf("СТС Love")))
            val qualityTie = NativeGuideIndex(regional + listOf(
                NativeGuideEntry("1322", "СТС Love HD"), NativeGuideEntry("duplicate", "СТС Love UHD")), format)
            assertEquals("1109", qualityTie.resolve("", listOf("СТС Love")))
            val exactBeforeQuality = NativeGuideIndex(regional + base + NativeGuideEntry("quality", "СТС Love HD"), format)
            assertEquals("1322", exactBeforeQuality.resolve("", listOf("СТС Love")))
            assertEquals("quality", exactBeforeQuality.resolve("", listOf("СТС Love HD")))
        }
    }

    @Test fun intactQueriesAndAliasesUseTheirNativeWhitespaceProfile() {
        for (format in NativeGuideFormat.entries) {
            val expected = if (format == NativeGuideFormat.RUST || format == NativeGuideFormat.SWIFT) "base" else "regional"
            val index = NativeGuideIndex(listOf(
                NativeGuideEntry("regional", "News +7"), NativeGuideEntry("base", "News")), format)
            for (query in listOf("\u0085News", "News\u0085HD"))
                assertEquals(expected, index.resolve("", listOf(query)), "$format/query")
            val aliases = NativeGuideIndex(listOf(
                NativeGuideEntry("regional", "News +7"), NativeGuideEntry("base", "\u0085News"),
                NativeGuideEntry("base", "News\u0085HD")), format)
            assertEquals(expected, aliases.resolve("", listOf("News")), "$format/aliases")
        }
    }
}
