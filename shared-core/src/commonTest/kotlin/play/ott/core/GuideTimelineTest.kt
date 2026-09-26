package play.ott.core

import kotlin.test.*

class GuideTimelineTest {
    private val starts = listOf(30.0, 0.0, 5.0, 5.0, 20.0, Double.NaN, 9.0, 10.0)
    private val ends = listOf(40.0, 18.0, 10.0, 15.0, 30.0, 50.0, 8.0, Double.POSITIVE_INFINITY)
    private fun at(now: Double, following: Double = 2.0) = GuideTimeline.select(starts.size, { starts[it] }, { ends[it] }, now, following)

    @Test fun halfOpenLatestStartAndDeterministicTies() {
        assertEquals(GuideTimelineSelection(1, listOf(2, 3), 5.0), at(0.0))
        assertEquals(GuideTimelineSelection(2, listOf(4, 0), 10.0), at(5.0))
        assertEquals(3, at(10.0).current)
        assertEquals(1, at(15.0).current)
        assertEquals(GuideTimelineSelection(-1, listOf(4, 0), 20.0), at(18.0))
        assertEquals(4, at(20.0).current)
        assertEquals(0, at(30.0).current)
        assertEquals(GuideTimelineSelection(-1, emptyList(), 3640.0), at(40.0))
        assertEquals(GuideTimelineSelection(-1, emptyList(), 0.0), at(Double.NaN))
    }

    @Test fun boundsAreExplicitAndRetryDoesNotDependOnVisibleRowCount() {
        for (size in listOf(Double.NaN, -1.0, Double.NEGATIVE_INFINITY, 0.0, 0.9)) {
            assertEquals(emptyList(), at(18.0, size).following)
            assertEquals(20.0, at(18.0, size).retryAt)
        }
        assertEquals(listOf(4), at(18.0, 1.9).following)
        assertEquals(listOf(4, 0), at(18.0, Double.POSITIVE_INFINITY).following)
        assertEquals(1000, GuideTimeline.select(1100, { it.toDouble() }, { it + 1.0 }, -1.0, Double.POSITIVE_INFINITY).following.size)
        assertEquals(3600.0, GuideTimeline.select(1, { 9999.0 }, { 10000.0 }, 0.0, 0.0).retryAt)
    }

    @Test fun programmeIdentityIsScopedAndIndependentOfDisplayEdits() {
        val key = ProgrammeId.of("source", "channel", "42", 10.0).key()
        assertEquals(key, ProgrammeId.of("source", "channel", "42", 20.0).key())
        assertNotEquals(key, ProgrammeId.of("other", "channel", "42", 10.0).key())
        assertNotEquals(key, ProgrammeId.of("source", "other", "42", 10.0).key())
        assertNotEquals(ProgrammeId("a:b", "c", "d").key(), ProgrammeId("a", "b:c", "d").key())
        assertEquals("programme:1:s1:c7:start:0", ProgrammeId.of("s", "c", null, -0.0).key())
        assertEquals(ProgrammeId.of("s", "c", null, 1.5), ProgrammeId.of("s", "c", "", 1.5))
        assertFailsWith<IllegalArgumentException> { ProgrammeId.of("s", "c", null, Double.NaN) }
        assertFailsWith<IllegalArgumentException> { ProgrammeId.of("", "c", "42", 0.0) }
    }

    @Test fun currentOnlyAndSingleFollowingRetainTheFullTimelinePolicy() {
        val starts = listOf(40.0, 20.0, 20.0, Double.NaN, 10.0, 15.0, 30.0)
        val ends = listOf(50.0, 25.0, 35.0, 60.0, 9.0, Double.POSITIVE_INFINITY, 32.0)
        for (now in listOf(-1.0, 20.0, 25.0, 32.0, 50.0)) {
            val full = GuideTimeline.select(starts.size, { starts[it] }, { ends[it] }, now, 1000.0)
            for (limit in listOf(0.0, 0.9, 1.0, 1.9)) {
                val selected = GuideTimeline.select(starts.size, { starts[it] }, { ends[it] }, now, limit)
                assertEquals(full.current, selected.current)
                assertEquals(full.retryAt, selected.retryAt)
                assertEquals(full.following.take(limit.toInt()), selected.following)
            }
        }
    }
}
