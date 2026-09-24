package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

class PlaybackSessionTest {
    private fun visit(id: String, kind: PlaybackKind = PlaybackKind.LIVE, source: String = "provider", start: Double? = null,
        payload: Any = Any()) = PlaybackVisit(PlaybackTarget(source, id, kind, start), payload)

    @Test fun departuresAreDeduplicatedByIdentityAndExcludeDestinationAcrossCategories() {
        val first = visit("one"); val otherCategory = visit("one"); val second = visit("two")
        val history = listOf(visit("two"), visit("one"), visit("three"), visit("three"))
        val change = PlaybackSessions.transition(first, second, history, null, 2)
        assertEquals(listOf("one", "three"), change.history.map { it.target.channelId })
        assertSame(first.payload, change.history.first().payload)
        assertEquals(listOf("two", "three"), PlaybackSessions.transition(first, otherCategory, history, null, 2).history.map { it.target.channelId })
    }

    @Test fun archiveAndLiveVisitsStayDistinctAndObservedMediaOffsetBecomesArchiveEpoch() {
        val archive = visit("one", PlaybackKind.ARCHIVE, start = 1000.0)
        val live = visit("one")
        val anotherSource = visit("one", source = "other")
        val change = PlaybackSessions.transition(archive, live, listOf(archive, live, anotherSource), 45.5, 10)
        assertEquals(2, change.history.size)
        assertEquals(1045.5, change.history[0].target.archiveStart)
        assertSame(archive.payload, change.history[0].payload)
        assertEquals("other", change.history[1].target.sourceId)
        assertEquals(1000.0, archive.target.archiveStart)
    }

    @Test fun vodDepartureAndArrivalDescribeHostResumeEffectsWithoutPerformingThem() {
        val old = visit("movie-1", PlaybackKind.VOD); val next = visit("movie-2", PlaybackKind.VOD)
        val change = PlaybackSessions.transition(old, next, emptyList(), 123.75, 10)
        assertEquals(listOf(PlaybackPositionEffect.SAVE_POSITION, PlaybackPositionEffect.RESTORE_POSITION), change.effects.map { it.type })
        assertEquals(123.75, change.effects[0].position)
        assertEquals(next.target, change.effects[1].target.target)
        val departure = PlaybackSessions.transition(old, null, emptyList(), 0.0, 10)
        assertEquals(null, departure.current)
        assertEquals(listOf(PlaybackPositionEffect.SAVE_POSITION), departure.effects.map { it.type })
        assertTrue(PlaybackSessions.transition(old, old.copy(payload = Any()), emptyList(), 10.0, 10).effects.isEmpty())
        assertTrue(PlaybackSessions.transition(old, null, emptyList(), Double.NaN, 10).effects.isEmpty())
    }

    @Test fun historyLimitsAndInvalidClockValuesCannotGrowOrCorruptHistory() {
        val entries = (0..1100).map { visit(it.toString()) }
        assertEquals(1000, PlaybackSessions.transition(null, null, entries, null, Int.MAX_VALUE).history.size)
        assertTrue(PlaybackSessions.transition(entries[0], null, entries, null, -1).history.isEmpty())
        val archive = visit("a", PlaybackKind.ARCHIVE, start = 100.0)
        assertEquals(100.0, PlaybackSessions.transition(archive, null, emptyList(), Double.POSITIVE_INFINITY, 5).history[0].target.archiveStart)
        assertFailsWith<IllegalArgumentException> { PlaybackTarget("s", "c", PlaybackKind.ARCHIVE) }
        assertFailsWith<IllegalArgumentException> { PlaybackTarget("s", "c", PlaybackKind.LIVE, 1.0) }
        assertFailsWith<IllegalArgumentException> { PlaybackTarget("", "c", PlaybackKind.VOD) }
    }

    @Test fun excludedHistoryKindsStillSavePositionAndNeverConsumeChannelCapacity() {
        val movie = visit("movie", PlaybackKind.VOD)
        val previous = visit("previous")
        val current = visit("current")
        val kinds = setOf(PlaybackKind.LIVE, PlaybackKind.ARCHIVE)
        val change = PlaybackSessions.transition(movie, current, listOf(movie, previous), 45.0, 1, kinds)
        assertEquals(listOf(previous), change.history)
        assertEquals(listOf(PlaybackPositionEffect.SAVE_POSITION), change.effects.map { it.type })
        assertEquals(45.0, change.effects.single().position)
        assertEquals(listOf(previous), PlaybackSessions.transition(movie, null, listOf(previous), 45.0, 1, kinds).history)
        val noHistory = PlaybackSessions.transition(movie, null, listOf(previous), 45.0, 1, emptySet())
        assertTrue(noHistory.history.isEmpty())
        assertEquals(PlaybackPositionEffect.SAVE_POSITION, noHistory.effects.single().type)
        assertEquals(listOf(movie), PlaybackSessions.transition(movie, null, listOf(previous), 45.0, 1).history)
    }

    @Test fun ownershipRejectsCancelledSupersededAndDifferentControllerTickets() {
        val first = PlaybackSessionOwnership(); val second = PlaybackSessionOwnership()
        val initial = first.begin(); assertTrue(first.accepts(initial)); assertFalse(second.accepts(initial))
        val replacement = first.begin(); assertFalse(first.accepts(initial)); assertTrue(first.accepts(replacement))
        second.begin(); assertFalse(second.accepts(replacement))
        first.cancel(); assertFalse(first.accepts(replacement)); assertFalse(first.accepts(null))
        first.begin(); assertFalse(first.accepts(initial)); assertFalse(first.accepts(replacement))
    }

    @Test fun vodSeekUsesMediaPositionAndExplicitOvershootPolicy() {
        val vod = visit("movie", PlaybackKind.VOD).target
        assertEquals(PlaybackSeekPlan(PlaybackSeekAction.SEEK, position = 0.0), PlaybackSeeking.plan(vod,
            PlaybackSeekRequest(PlaybackSeekIntent.OFFSET, -30.0, position = 10.0)))
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(vod,
            PlaybackSeekRequest(PlaybackSeekIntent.OFFSET, 30.0, position = 90.0, duration = 100.0)).action)
        assertEquals(100.0, PlaybackSeeking.plan(vod, PlaybackSeekRequest(PlaybackSeekIntent.ABSOLUTE, 120.0,
            duration = 100.0, overshoot = PlaybackOvershoot.CLAMP)).position)
        assertEquals(0.0, PlaybackSeeking.plan(vod, PlaybackSeekRequest(PlaybackSeekIntent.BEGIN)).position)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(vod, PlaybackSeekRequest(PlaybackSeekIntent.GO_LIVE)).action)
    }

    @Test fun archiveSeekKeepsEpochAndMediaPositionSeparateAndCanReturnToLive() {
        val archive = visit("one", PlaybackKind.ARCHIVE, start = 1000.0).target
        fun offset(value: Double) = PlaybackSeekRequest(PlaybackSeekIntent.OFFSET, value, position = 100.0,
            now = 2000.0, archiveAvailable = true, archiveEarliest = 500.0)
        assertEquals(1130.0, PlaybackSeeking.plan(archive, offset(30.0)).archiveStart)
        assertEquals(500.0, PlaybackSeeking.plan(archive, offset(-1000.0)).archiveStart)
        assertEquals(PlaybackSeekAction.GO_LIVE, PlaybackSeeking.plan(archive, offset(900.0)).action)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(archive, offset(0.0)).action)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(archive, offset(20.0).copy(now = Double.NaN)).action)
    }

    @Test fun liveRewindRequiresArchiveCapabilityAndBeginRequiresExplicitRetentionBoundary() {
        val live = visit("one").target
        val request = PlaybackSeekRequest(PlaybackSeekIntent.OFFSET, -30.0, now = 2000.0, archiveAvailable = true)
        assertEquals(1970.0, PlaybackSeeking.plan(live, request).archiveStart)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(live, request.copy(archiveAvailable = false)).action)
        assertEquals(PlaybackSeekAction.RESTART, PlaybackSeeking.plan(live, request.copy(value = 30.0)).action)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(live, request.copy(value = 30.0, restartAllowed = false)).action)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(live, request.copy(intent = PlaybackSeekIntent.BEGIN)).action)
        assertEquals(500.0, PlaybackSeeking.plan(live, request.copy(intent = PlaybackSeekIntent.BEGIN, archiveEarliest = 500.0)).archiveStart)
        assertEquals(PlaybackSeekAction.NOOP, PlaybackSeeking.plan(null, request).action)
    }
}
