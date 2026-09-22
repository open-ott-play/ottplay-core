package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class GuideTest {
    @Test fun epochAndTimeZones() {
        assertEquals(0L, GuideTime.parse("19700101000000 +0000"))
        assertEquals(0L, GuideTime.parse("197001010530 +0530"))
        assertEquals(0L, GuideTime.parse("19691231203000 -03:30"))
        assertEquals(-1_000L, GuideTime.parse("19691231235959Z"))
        assertEquals(0L, GuideTime.parse(" 19700101 GMT "))
        assertEquals(3_600_000L, GuideTime.parse("1970010101"))
        assertEquals(0L, GuideTime.parse("\ufeff19700101\u00a0UTC\ufeff"))
    }

    @Test fun gregorianValidation() {
        assertEquals(951_782_400_000L, GuideTime.parse("20000229000000 UTC"))
        assertEquals(-62_135_596_800_000L, GuideTime.parse("00010101"))
        assertEquals(253_402_300_799_000L, GuideTime.parse("99991231235959"))
        assertEquals(-62_167_219_200_000L, GuideTime.parse("00000101"))
        for (invalid in listOf("19000229", "20230229", "20260431", "20260100",
            "20261301", "202601012400", "202601010060", "20260101000060", "202601010000 +2400",
            "202601010000 +1260", "202601010000 +2:00", "202601010", "20260101000000junk", "")) {
            assertNull(GuideTime.parse(invalid), invalid)
        }
    }

    @Test fun retainedInputFormats() {
        val android = GuideTimeFormat.ANDROID
        val browser = GuideTimeFormat.BROWSER
        assertEquals(0L, GuideTime.parse("19700101", android))
        assertNull(GuideTime.parse("19700101", browser))
        assertEquals(0L, GuideTime.parse("197001010530 +05:30", android))
        assertNull(GuideTime.parse("197001010530 +05:30", browser))
        assertEquals(0L, GuideTime.parse("197001010000 UTC", browser))
        assertNull(GuideTime.parse("197001010000 UTC", android))
        assertEquals(0L, GuideTime.parse("197001011800 +1800", android))
        assertNull(GuideTime.parse("197001011801 +1801", android))
        assertEquals(0L, GuideTime.parse("197001011801 +1801", browser))
        assertEquals(0L, GuideTime.parse("\ufeff197001010000\u00a0Z\ufeff", browser))
        assertNull(GuideTime.parse("\ufeff197001010000Z", android))
        assertNull(GuideTime.parse("197001010000\u00a0Z", android))
        assertEquals(0L, GuideTime.parse("\u001c19700101\u001f", android))
        for (format in GuideTimeFormat.entries) assertNull(GuideTime.parse("197001010000\u0085Z", format))
    }

    @Test fun orderedNamesRetainBrowserAndFilterPriority() {
        assertEquals("id", GuideNames.chooseOrdered(listOf("id"), listOf(listOf("other")), emptyList()))
        assertEquals("display", GuideNames.chooseOrdered(emptyList(), listOf(listOf("a", "b"), listOf("display")), listOf(listOf("alias"))))
        assertEquals("tvg", GuideNames.chooseOrdered(emptyList(), listOf(listOf("tvg"), listOf("display")), emptyList()))
        assertEquals("alias", GuideNames.chooseOrdered(emptyList(), listOf(listOf("a", "b")), listOf(listOf("alias"))))
        assertNull(GuideNames.chooseOrdered(listOf("a", "b"), listOf(listOf("a", "b")), listOf(listOf("a", "b"))))
    }

    @Test fun scheduleBoundariesOverlapsAndClockRollback() {
        val starts = listOf(20.0, 0.0, 5.0, 5.0, Double.NaN, 25.0, 50.0)
        val ends = listOf(30.0, 10.0, 15.0, 18.0, 50.0, 24.0, Double.POSITIVE_INFINITY)
        fun at(now: Double, open: Boolean = false) = GuideSchedule.select(starts.size, { starts[it] }, { ends[it] }, now, open)
        assertEquals(GuideWindow(2, 0, 5.0, 10.0), at(7.0))
        assertEquals(GuideWindow(2, 0, 10.0, 15.0), at(10.0))
        assertEquals(GuideWindow(3, 0, 15.0, 18.0), at(15.0))
        assertEquals(GuideWindow(-1, 0, 18.0, 20.0), at(19.0))
        assertEquals(GuideWindow(1, 2, 0.0, 5.0), at(2.0))
        assertEquals(-1, at(55.0).current)
        assertEquals(6, at(55.0, true).current)
        assertEquals(-1, at(Double.NaN).next)
        assertEquals(-1, at(Double.POSITIVE_INFINITY).current)
    }

    @Test fun namesRetainRegionAndTimeShift() {
        assertEquals("news +2", GuideNames.canonical("  HD News   +2 UHD  "))
        assertEquals("новости москва", GuideNames.canonical("НОВОСТИ МОСКВА HD"))
        assertEquals("hdnews", GuideNames.canonical("HDNews"))
        assertEquals("news west", GuideNames.canonical("\ufeffHD\u00a0News\u202fWest\ufeff"))
    }

}
