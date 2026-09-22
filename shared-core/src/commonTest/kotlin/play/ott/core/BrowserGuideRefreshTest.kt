package play.ott.core

import kotlin.test.*

class BrowserGuideRefreshTest {
    private fun BrowserGuideRefresh.start(vararg urls: String, automatic: Boolean = false) = begin(urls.toList(), automatic)!!.state.generation
    private fun BrowserGuideRefresh.ok(epoch: Double, index: Int, now: Double = 100.0) = complete(epoch, index, true, null, now)!!
    private fun BrowserGuideRefresh.fail(epoch: Double, index: Int, now: Double = 100.0) = complete(epoch, index, false, "TIMEOUT", now)!!

    @Test fun completionOrderDoesNotChangeMergeOrderOrProgress() {
        val r = BrowserGuideRefresh(); val epoch = r.start("a", "b")
        val first = r.ok(epoch, 1)
        assertEquals(listOf("b"), first.state.feeds); assertTrue(first.merge)
        assertEquals(BrowserGuideRefreshInfo("loading", 2, 1, emptyList()), first.state.info)
        val last = r.ok(epoch, 0)
        assertEquals(listOf("a", "b"), last.state.feeds); assertEquals("ready", last.state.info.phase)
        assertEquals(1800100.0, last.state.due)
    }

    @Test fun failuresRetainOnlyConfiguredFeedsAndReorderingResetsBackoff() {
        val r = BrowserGuideRefresh(); var epoch = r.start("a", "b")
        r.ok(epoch, 0); r.ok(epoch, 1)
        epoch = r.start("a", "b"); r.fail(epoch, 0); r.fail(epoch, 1)
        assertEquals(1, r.snapshot().failures)
        val changed = r.begin(listOf("b", "c"), false)!!
        assertTrue(changed.merge); assertEquals(listOf("b"), changed.state.feeds); assertEquals(0, changed.state.failures)
        r.ok(changed.state.generation, 1)
        val reordered = r.begin(listOf("c", "b"), false)!!
        assertTrue(reordered.merge); assertEquals(listOf("c", "b"), reordered.state.feeds)
    }

    @Test fun successfulEmptyFeedStillReplacesItsStalePayloadAndCountsAsReady() {
        val r = BrowserGuideRefresh(); var epoch = r.start("a", "b")
        r.ok(epoch, 0); r.ok(epoch, 1)
        epoch = r.start("a", "b")
        // Empty XMLTV is a parsed object: the host passes true and stores that empty payload.
        assertTrue(r.ok(epoch, 0).merge)
        val complete = r.fail(epoch, 1)
        assertEquals(listOf("a", "b"), complete.state.feeds)
        assertEquals("ready", complete.state.info.phase); assertEquals(1, complete.state.failures)
        assertTrue(complete.notify)
    }

    @Test fun allFailurePhaseAndAutomaticNotificationsRespectCachedGuide() {
        val r = BrowserGuideRefresh(); var epoch = r.start("a", automatic = true)
        assertTrue(r.fail(epoch, 0).notify)
        epoch = r.start("a"); r.ok(epoch, 0)
        epoch = r.start("a", automatic = true)
        val failed = r.fail(epoch, 0)
        assertEquals("error", failed.state.info.phase); assertFalse(failed.notify)
        assertEquals(listOf("a"), failed.state.feeds)
    }

    @Test fun retryBackoffCapsAndAllSuccessResetsIt() {
        val r = BrowserGuideRefresh()
        for (delay in listOf(60000, 120000, 240000, 480000, 960000, 1800000, 1800000)) {
            val epoch = r.start("a"); val failed = r.fail(epoch, 0, 1234.0)
            assertEquals(1234.0 + delay, failed.state.due)
            assertFalse(r.isDue(failed.state.due - 1)); assertTrue(r.isDue(failed.state.due))
        }
        val epoch = r.start("a"); assertFalse(r.isDue(1e15))
        val restored = r.ok(epoch, 0)
        assertEquals(0, restored.state.failures); assertEquals(1800100.0, restored.state.due)
    }

    @Test fun supersedingResetAndDestroyRejectStaleGenerations() {
        val r = BrowserGuideRefresh(); val first = r.start("a"); val second = r.start("b")
        assertNull(r.complete(first, 0, true, null, 100.0)); assertTrue(r.accepts(second))
        r.reset(true); assertFalse(r.accepts(second)); assertEquals("idle", r.snapshot().info.phase)
        assertEquals(0.0, r.snapshot().due); assertEquals(emptyList(), r.snapshot().feeds)
        val third = r.start("c"); r.destroy(); val closed = r.snapshot()
        assertNull(r.complete(third, 0, true, null, 100.0)); assertNull(r.begin(listOf("d"), false))
        r.destroy(); assertEquals(closed, r.snapshot()); assertFalse(r.isDue(1e15))
    }

    @Test fun playlistRemovalCanRetainStatusWhileClearingRefreshOwnership() {
        val r = BrowserGuideRefresh(); val epoch = r.start("a"); r.fail(epoch, 0)
        val before = r.snapshot(); r.reset(false)
        assertEquals(before.info, r.snapshot().info); assertEquals(emptyList(), r.snapshot().urls)
        assertEquals(0.0, r.snapshot().due); assertEquals(0, r.snapshot().failures)
    }

    @Test fun urlAliasesDuplicatesAndLimitAreResolvedBeforeRequestSlots() {
        val r = BrowserGuideRefresh()
        val urls = listOf("http://epg.it999.ru/epg2.xml.gz", "https://cdn.epg.one/epg2.xml.gz", "b", "b") + (1..15).map { "x$it" }
        val state = r.begin(urls, false)!!.state
        assertEquals(10, state.info.total); assertEquals(listOf("https://cdn.epg.one/epg2.xml.gz", "b", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"), state.urls)
        assertNull(r.begin(emptyList(), false)); assertEquals(state, r.snapshot())
    }

    @Test fun repeatedCallbacksPreserveRequestSlotSuccessAndPendingSemantics() {
        val r = BrowserGuideRefresh(); val epoch = r.start("a", "a", "b")
        assertEquals(2, r.snapshot().info.total)
        r.ok(epoch, 0)
        val duplicate = r.fail(epoch, 0)
        assertTrue(duplicate.merge); assertEquals("ready", duplicate.state.info.phase)
        assertEquals(1, duplicate.state.failures); assertTrue(duplicate.notify)
        val late = r.ok(epoch, 1, 900.0)
        assertEquals(3, late.state.info.done); assertEquals(duplicate.state.due, late.state.due)
        assertEquals(listOf("a", "b"), late.state.feeds); assertFalse(late.notify)
    }
}
