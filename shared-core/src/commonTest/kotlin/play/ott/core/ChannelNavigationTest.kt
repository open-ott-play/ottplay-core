package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChannelNavigationTest {
    private val entries = listOf(ChannelCandidate("A", true), ChannelCandidate("film", false),
        ChannelCandidate("B", true), ChannelCandidate("A", true), ChannelCandidate("C", true))
    @Test fun catalogAdmissionIsSourceBoundAndKeepsFirstLiveIdentity() {
        val policy = ChannelNavigation()
        val old = policy.beginCatalog()
        val current = policy.beginCatalog()
        assertNull(policy.acceptCatalog(old, "A", "A", entries))
        assertNull(policy.acceptCatalog(current, "A", "C", entries))
        assertEquals(listOf(0, 2, 4), policy.acceptCatalog(current, "A", "A", entries))
        assertTrue(policy.available("A"))
        assertEquals(-1, policy.nextIndex(0, "A"))
    }
    @Test fun rapidSwitchesAdvanceFromPendingTargetAndOnlyNewestMayCommit() {
        val policy = ChannelNavigation()
        policy.acceptCatalog(policy.beginCatalog(), "A", "A", entries)
        val first = policy.beginSwitch(policy.nextIndex(1, "A"))
        assertEquals(2, policy.nextIndex(1, "A"))
        val last = policy.beginSwitch(2)
        assertFalse(policy.canCommit(first, "A", "A"))
        assertFalse(policy.canCommit(last, "A", "different"))
        assertFalse(policy.fail(first))
        assertTrue(policy.canCommit(last, "A", "A"))
        policy.cancel()
        assertFalse(policy.canCommit(last, "A", "A"))
        assertEquals(1, policy.nextIndex(1, "A"))
    }
    @Test fun failedSwitchRestartsAtCurrentWhileMissingCurrentDisablesQueue() {
        val policy = ChannelNavigation()
        policy.acceptCatalog(policy.beginCatalog(), "A", "A", entries)
        assertEquals(2, policy.nextIndex(-1, "A"))
        val token=policy.beginSwitch(2)
        assertTrue(policy.fail(token))
        assertEquals(1, policy.nextIndex(1, "A"))
        assertEquals(emptyList(), policy.acceptCatalog(policy.beginCatalog(), "missing", "missing", entries))
        assertFalse(policy.available("A"))
    }
    @Test fun legacyAndBrowserBoundaryProfilesRemainExplicit() {
        assertEquals(0.0, ChannelMovement.index(12.0, 3, 1, ChannelMovementFormat.CLASSIC))
        assertEquals(11.0, ChannelMovement.index(12.0, 3, -1, ChannelMovementFormat.CLASSIC))
        assertEquals(-1.0, ChannelMovement.index(0.0, 0, -1, ChannelMovementFormat.CLASSIC))
        assertEquals(0.0, ChannelMovement.index(-1.0, 3, 1, ChannelMovementFormat.BROWSER))
        assertEquals(2.0, ChannelMovement.index(-1.0, 3, -1, ChannelMovementFormat.BROWSER))
        assertEquals(-1.0, ChannelMovement.index(-1.0, 3, 1, ChannelMovementFormat.NATIVE))
    }
}
