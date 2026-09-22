package play.ott.core

import kotlin.test.*
import play.ott.core.NativeGuideRefreshAction.*
import play.ott.core.NativeGuideRefreshFormat.*

class NativeGuideRefreshTest {
    @Test fun zeroSourcesRetainAndroidDataButReplaceServerData() {
        assertEquals(SKIP, NativeGuideRefresh(0, ANDROID).action())
        val server = NativeGuideRefresh(0, RUST_SERVER)
        assertEquals(OPEN_DATABASE, server.action())
        server.advance(true, false)
        assertEquals(REPLACE, server.action())
    }

    @Test fun androidFailureStopsBeforeAnotherDownloadOrAnyWrite() {
        for (failed in 0..2) {
            val refresh = NativeGuideRefresh(3, ANDROID)
            for (index in 0..failed) {
                assertEquals(FETCH, refresh.action())
                assertEquals(index, refresh.index())
                refresh.advance(index != failed)
            }
            assertEquals(FAIL, refresh.action())
            assertEquals(-1, refresh.index())
        }
    }

    @Test fun androidChecksCurrentSourceOnlyAfterAllSuccessfulFeedsIncludingEmptyOnes() {
        for (matches in listOf(true, false)) {
            val refresh = NativeGuideRefresh(2, ANDROID)
            refresh.advance(true)
            assertEquals(FETCH, refresh.action())
            refresh.advance(true)
            assertEquals(VALIDATE_SOURCE, refresh.action())
            refresh.advance(matches)
            assertEquals(if (matches) WRITE_DATABASE else SKIP, refresh.action())
            if (matches) {
                refresh.advance(true)
                assertEquals(REPLACE, refresh.action())
            }
        }
    }

    @Test fun androidDatabaseFailureRemainsAnError() {
        val refresh = NativeGuideRefresh(1, ANDROID)
        refresh.advance(true)
        refresh.advance(true)
        refresh.advance(false)
        assertEquals(FAIL, refresh.action())
    }

    @Test fun serverContinuesAfterEveryFeedFailureAndStillPersistsEmptyResult() {
        for (outcomes in listOf(listOf(false, false), listOf(true, false), listOf(false, true))) {
            val refresh = NativeGuideRefresh(2, RUST_SERVER)
            outcomes.forEachIndexed { index, success ->
                assertEquals(index, refresh.index())
                refresh.advance(success)
            }
            assertEquals(OPEN_DATABASE, refresh.action())
            refresh.advance(true, true)
            assertEquals(WRITE_DATABASE, refresh.action())
            refresh.advance(true)
            assertEquals(REPLACE, refresh.action())
        }
    }

    @Test fun serverPropagatesPoolFailureButAcceptsPersistenceFailure() {
        val connection = NativeGuideRefresh(0, RUST_SERVER)
        connection.advance(false)
        assertEquals(FAIL, connection.action())
        val persistence = NativeGuideRefresh(0, RUST_SERVER)
        persistence.advance(true, true)
        persistence.advance(false)
        assertEquals(REPLACE, persistence.action())
    }

    @Test fun firstFeedMetadataOwnershipUsesExactIdsAndIndependentBatches() {
        val refresh = NativeGuideRefresh(2, RUST_SERVER)
        assertEquals(listOf("a", "__proto__", ""), refresh.unowned(listOf("a", "a", "__proto__", "")))
        refresh.advance(true)
        assertEquals(listOf("A", "b"), refresh.unowned(listOf("a", "A", "__proto__", "", "b")))
        assertEquals(listOf("a"), NativeGuideRefresh(1, RUST_SERVER).unowned(listOf("a")))
    }

    @Test fun terminalStatesAndUnsupportedOperationsAreRejected() {
        assertFailsWith<IllegalArgumentException> { NativeGuideRefresh(-1, ANDROID) }
        val states = listOf(NativeGuideRefresh(0, ANDROID), NativeGuideRefresh(0, RUST_SERVER).apply { advance(false) },
            NativeGuideRefresh(0, RUST_SERVER).apply { advance(true, false) })
        for (refresh in states) {
            assertEquals(-1, refresh.index())
            assertFailsWith<IllegalStateException> { refresh.advance(true) }
            assertFailsWith<IllegalStateException> { refresh.unowned(emptyList()) }
        }
        assertFailsWith<IllegalArgumentException> { NativeGuideRefresh(1, ANDROID).unowned(emptyList()) }
        assertEquals(7200, NativeGuideRefresh.intervalSeconds(RUST_SERVER))
        assertFailsWith<IllegalArgumentException> { NativeGuideRefresh.intervalSeconds(ANDROID) }
    }
}
