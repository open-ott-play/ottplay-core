package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NativeGuideTest {
    @Test fun timestampMemoizationIsBoundedAndDoesNotChangeResults() {
        val clock = NativeGuideClock(NativeGuideFormat.RUST, capacity = 2)
        val values = listOf("20260101000000", "20260101010000", "20260101020000", "invalid", "x".repeat(100))
        repeat(3) { for (value in values) {
            assertEquals(GuideTime.nativeSeconds(value, NativeGuideFormat.RUST), clock.seconds(value))
            assertTrue(clock.cachedEntries <= 2)
        } }
        val disabled = NativeGuideClock(NativeGuideFormat.RUST, capacity = 0)
        assertEquals(1767225600.0, disabled.seconds(values[0]))
        assertEquals(0, disabled.cachedEntries)
    }
    @Test fun unicodeNamesAndRegionalShifts() {
        assertEquals("первый канал", NativeGuideNames.normalized(" HD Первый\u0085канал +4ч (Москва) UHD "))
        assertEquals("first", NativeGuideNames.normalized("First +٤h HD"))
        assertEquals("first", NativeGuideNames.normalized("First +𝟜h HD"))
        assertEquals("First", NativeGuideNames.stripShift(" First +2h "))
        assertEquals("First H", NativeGuideNames.stripShift("First +2H"))
        assertEquals("first ours", NativeGuideNames.normalized("First +2hours"))
        assertEquals("name (open", NativeGuideNames.normalized("Name (Open"))
        assertEquals(24, NativeGuideNames.regionalShift("First +24"))
        assertEquals(-3, NativeGuideNames.regionalShift("First -27"))
        assertEquals(0, NativeGuideNames.regionalShift("First +9223372036854775808"))
        assertEquals(0, NativeGuideNames.regionalShift("First +٤"))
        assertEquals(0, NativeGuideNames.regionalShift("First +𝟜"))
        assertEquals("first +٤", NativeGuideNames.normalized("First +٤ HD", NativeGuideFormat.ARCHIVED_ANDROID))
    }

    @Test fun identityThenAllExactAliasesBeforeFuzzyWithStableTies() {
        val index = NativeGuideIndex(listOf(
            NativeGuideEntry("news", "News"), NativeGuideEntry("cinema", "Cinema"),
            NativeGuideEntry("cinema", "Films"), NativeGuideEntry("other", "News"),
            NativeGuideEntry("blank", "")))
        assertEquals("blank", index.resolve("blank", listOf("News")))
        assertEquals("cinema", index.resolve("missing", listOf("News Extra", "Films")))
        assertEquals("news", index.resolve("", listOf("News")))
        assertEquals("news", index.resolve("", listOf("News Extra")))
        assertEquals("cinema", index.resolve("", listOf("Films HD")))
        assertNull(index.resolve("missing", listOf("Unrelated")))
        assertNull(index.match(""))
    }

    @Test fun byteAndCharacterMetricsRemainExplicit() {
        val rows = listOf(NativeGuideEntry("cyrillic", "яa"), NativeGuideEntry("latin", "abc"))
        val characters = NativeGuideIndex(rows)
        val bytes = NativeGuideIndex(rows, measure = { it.encodeToByteArray().size })
        assertEquals("latin", characters.match("яabc")?.id)
        assertEquals("cyrillic", bytes.match("яabc")?.id)
        val words = NativeGuideIndex(listOf(NativeGuideEntry("one", "east news tv")))
        assertEquals("one", words.match("west news tv")?.id)
        assertNull(words.match("west tv"))
    }

    @Test fun nativeTimeSuffixAndMalformedUnicode() {
        val rust = NativeGuideFormat.RUST
        val swift = NativeGuideFormat.SWIFT
        assertEquals(1767225600, GuideTime.parseNative("20260101000000", rust))
        assertEquals(1767214800, GuideTime.parseNative("20260101000000 +0300ignored", rust))
        assertEquals(1767225600, GuideTime.parseNative("20260101000000 CET", rust))
        assertEquals(1767225659, GuideTime.parseNative("20260101000060Z", rust))
        assertEquals(0, GuideTime.parseNative("20260101000060Z", swift))
        assertEquals(0, GuideTime.parseNative("2026010100000💥", rust))
        assertEquals(0, GuideTime.parseNative("20260101000000 +0💥", rust))
        assertEquals(1767225600, GuideTime.parseNative("２０２６０１０１００００００", swift))
        assertEquals(0, GuideTime.parseNative("２０２６０１０１００００００", rust))
        assertEquals(0, GuideTime.parseNative("20260230000000", swift))
        assertEquals(0, GuideTime.parseNative("20260101", rust))
    }

    @Test fun sliceBoundsArchiveDepthAndShift() {
        val window = NativeGuideWindow(0.0, 0.0, 2.0)
        assertEquals(7200.0, window.shift)
        assertFalse(window.includes(-200000.0, -180000.0))
        assertTrue(window.includes(-200000.0, -179999.0))
        assertTrue(window.includes(165599.0, 180000.0))
        assertFalse(window.includes(165600.0, 180000.0))
        assertTrue(NativeGuideWindow(0.0, 168.0, 0.0).includes(-600000.0, -590000.0))
    }
}
