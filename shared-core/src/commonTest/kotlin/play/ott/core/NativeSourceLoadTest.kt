package play.ott.core

import kotlin.test.*
import play.ott.core.NativeSourceLoadAction.*

class NativeSourceLoadTest {
    private fun next(action: NativeSourceLoadAction, success: Boolean, channels: Int = 0, swift: Boolean = false) =
        NativeSourceLoad.next(action, success, channels, if (swift) NativeSourceFormat.SWIFT else NativeSourceFormat.ANDROID)

    @Test fun forcedLoadsSkipOnlyFreshDisk() {
        assertEquals(READ_FRESH_DISK, NativeSourceLoad.start(false))
        assertEquals(FETCH, NativeSourceLoad.start(true))
        assertEquals(READ_MEMORY, next(FETCH, false))
        assertEquals(READ_STALE_DISK, next(READ_MEMORY, false))
        assertEquals(USE_STALE_DISK, next(READ_STALE_DISK, true, 1))
    }
    @Test fun invalidOrEmptyDiskProceedsToNetworkAndDoesNotReplaceOriginalError() {
        for (swift in listOf(false, true)) for ((success, count) in listOf(false to 0, false to 1, true to 0)) {
            assertEquals(FETCH, next(READ_FRESH_DISK, success, count, swift))
            assertEquals(FAIL, next(READ_STALE_DISK, success, count, swift))
        }
        assertEquals(USE_FRESH_DISK, next(READ_FRESH_DISK, true, 1))
    }
    @Test fun anyMemoryEntryPrecedesStaleDisk() {
        for (swift in listOf(false, true)) {
            assertEquals(READ_MEMORY, next(FETCH, true, 0, swift))
            assertEquals(USE_MEMORY, next(READ_MEMORY, true, 0, swift))
            assertEquals(READ_STALE_DISK, next(READ_MEMORY, false, 0, swift))
        }
    }
    @Test fun writeFailureAndRepeatedParsingRetainPlatformContracts() {
        for (swift in listOf(false, true)) assertEquals(WRITE_DISK, next(FETCH, true, 1, swift))
        assertEquals(USE_NETWORK, next(WRITE_DISK, false))
        assertEquals(USE_NETWORK, next(WRITE_DISK, true))
        assertEquals(READ_MEMORY, next(WRITE_DISK, false, swift = true))
        assertEquals(REPARSE_NETWORK, next(WRITE_DISK, true, swift = true))
        assertEquals(FAIL, next(REPARSE_NETWORK, false, swift = true))
        // The historical second parse can successfully produce an empty result.
        assertEquals(USE_NETWORK, next(REPARSE_NETWORK, true, 0, swift = true))
    }
    @Test fun completedLoadsCannotBeAdvancedAgain() {
        for (action in listOf(USE_FRESH_DISK, USE_NETWORK, USE_MEMORY, USE_STALE_DISK, FAIL))
            assertFailsWith<IllegalStateException> { next(action, true, 1) }
    }
    @Test fun batchContinuesAfterFailureAndReturnsItsFirstErrorOnlyForEmptyMerge() {
        val batch = NativeSourceBatch(3)
        assertEquals(0, batch.next()); batch.advance(false, 0)
        assertEquals(1, batch.next()); batch.advance(true, 0)
        assertEquals(2, batch.next()); batch.advance(false, 0)
        assertEquals(-1, batch.next()); assertEquals(0, batch.failure())
        assertFailsWith<IllegalStateException> { batch.advance(true, 1) }
    }
    @Test fun partialSuccessAndEmptyInputRemainSuccessful() {
        val batch = NativeSourceBatch(3)
        batch.advance(false, 0); batch.advance(true, 2); batch.advance(false, 0)
        assertEquals(-1, batch.failure())
        val empty = NativeSourceBatch(0)
        assertEquals(-1, empty.next()); assertEquals(-1, empty.failure())
        val blank = NativeSourceBatch(1)
        blank.advance(true, 0); assertEquals(-1, blank.failure())
    }
    @Test fun incompleteBatchAndInvalidProfilesCannotProduceAResult() {
        assertFailsWith<IllegalStateException> { NativeSourceBatch(1).failure() }
        assertFailsWith<IllegalArgumentException> { NativeSourceBatch(-1) }
        assertFailsWith<IllegalArgumentException> { next(FETCH, true, -1) }
        assertFailsWith<IllegalArgumentException> { NativeSourceLoad.next(FETCH, true, 1, NativeSourceFormat.ANDROID_RAW) }
    }
}
