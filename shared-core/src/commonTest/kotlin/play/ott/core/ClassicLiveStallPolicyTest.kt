package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ClassicLiveStallPolicyTest {
    private fun number(value: String) = ProviderValue(ProviderValueKind.NUMBER, value)
    @Test fun classicConfigurationIsStrictAndDistinct() {
        assertEquals(5, ClassicLiveStallPolicy.limits(number("5"), number("30")).attempts)
        for (bad in listOf(number("6"), number("-1"), number("1.5"), number("NaN"), ProviderValue.text("3")))
            assertEquals(0, ClassicLiveStallPolicy.limits(bad, number("15")).attempts)
        assertEquals(15000.0, ClassicLiveStallPolicy.limits(number("3"), ProviderValue.text("30")).timeout)
    }
    @Test fun progressAndSleepBoundaries() {
        assertFalse(ClassicLiveStallPolicy.progress(Double.NaN, 1.0))
        assertFalse(ClassicLiveStallPolicy.progress(1.04, 1.0))
        assertTrue(ClassicLiveStallPolicy.progress(2.0, 1.0))
        assertFalse(ClassicLiveStallPolicy.resetWindow(5000.0, 0.0, 0.0, false, false))
        assertTrue(ClassicLiveStallPolicy.resetWindow(5001.0, 0.0, 0.0, false, false))
        assertTrue(ClassicLiveStallPolicy.resetWindow(0.0, 0.0, 1.0, false, false))
        assertEquals(3, ClassicLiveStallPolicy.healthyAttempts(3, 0.0, 9999.0))
        assertEquals(0, ClassicLiveStallPolicy.healthyAttempts(3, 0.0, 10000.0))
    }
    @Test fun countdownExhaustionAndRestartAdmission() {
        val limit = ClassicLiveStallPolicy.Limits(3, 15000.0)
        assertEquals("hidden", ClassicLiveStallPolicy.plan(false, 0, 15000.0, limit, false, false).phase)
        assertEquals(12.0, ClassicLiveStallPolicy.plan(true, 0, 3000.0, limit, false, false).remaining)
        assertFalse(ClassicLiveStallPolicy.plan(true, 0, 14999.0, limit, false, false).restart)
        assertTrue(ClassicLiveStallPolicy.plan(true, 0, 15000.0, limit, false, false).restart)
        assertEquals("exhausted", ClassicLiveStallPolicy.plan(true, 3, 15000.0, limit, true, false).phase)
        assertFalse(ClassicLiveStallPolicy.plan(true, 3, 15000.0, limit, false, false).restart)
        assertEquals("restarting", ClassicLiveStallPolicy.blockedPhase(false, false, true, 1, 3, true))
        assertEquals("hidden", ClassicLiveStallPolicy.blockedPhase(true, true, true, 3, 3, true))
        assertEquals("exhausted", ClassicLiveStallPolicy.blockedPhase(true, false, true, 3, 3, true))
    }
}
