package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ClassicRemindersTest {
    private fun record(id: String = "r", source: String = "s", start: String = "100", end: String = "200"): ProviderValue = ProviderValue.obj(linkedMapOf(
        "sourceId" to ProviderValue.text(source), "id" to ProviderValue.text(id), "channelId" to ProviderValue.text("c"),
        "programmeId" to ProviderValue.text("p"), "title" to ProviderValue.text(""),
        "start" to ProviderValue(ProviderValueKind.NUMBER, start), "end" to ProviderValue(ProviderValueKind.NUMBER, end),
    ))

    @Test fun validatesAndKeepsFirstIdentity() {
        assertTrue(ClassicReminders.valid(record(), "s"))
        assertFalse(ClassicReminders.valid(record(source = "other"), "s"))
        assertFalse(ClassicReminders.valid(record(start = "NaN"), "s"))
        assertFalse(ClassicReminders.valid(record(end = "100"), "s"))
        assertEquals(listOf(0, 3), ClassicReminders.normalizedIndices(listOf(record(), record(), record(source = "other"), record("__proto__")), "s"))
    }

    @Test fun deadlinesAndOneTimeEffects() {
        assertEquals(70.0, ClassicReminders.next(100.0, 200.0, 50.0, 30.0, false, false))
        assertEquals(100.0, ClassicReminders.next(100.0, 200.0, 80.0, 30.0, false, true))
        assertEquals(Double.POSITIVE_INFINITY, ClassicReminders.next(100.0, 200.0, 200.0, 30.0, false, false))
        assertEquals(Double.POSITIVE_INFINITY, ClassicReminders.next(100.0, 200.0, Double.NaN, 30.0, false, false))
        assertEquals("notify", ClassicReminders.action(100.0, 200.0, 80.0, 30.0, false, false))
        assertEquals("none", ClassicReminders.action(100.0, 200.0, 80.0, 30.0, false, true))
        assertEquals("prompt", ClassicReminders.action(100.0, 200.0, 100.0, 30.0, false, true))
        assertEquals("none", ClassicReminders.action(100.0, 200.0, 100.0, 30.0, true, true))
        assertEquals(1.0, ClassicReminders.minutes(100.0, 80.0))
    }
}
