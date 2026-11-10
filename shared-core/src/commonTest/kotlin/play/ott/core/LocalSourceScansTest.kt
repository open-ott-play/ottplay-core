package play.ott.core

import kotlin.test.*

class LocalSourceScansTest {
    @Test fun omittedProtocolAloneRetainsLegacyCompletion() {
        assertEquals(LocalSourceScanStatus.LEGACY, LocalSourceScans.classify(false, false, 0, null, null))
        assertEquals(LocalSourceScanStatus.INVALID, LocalSourceScans.classify(true, false, 0, null, null))
        assertEquals(LocalSourceScanStatus.PENDING, LocalSourceScans.classify(true, true, 0, null, null))
    }

    @Test fun selectedRecordMustBeUniqueAndHaveAnExactSafePositiveGeneration() {
        for (matches in listOf(-1, 2, 100))
            assertEquals(LocalSourceScanStatus.INVALID, LocalSourceScans.classify(true, true, matches, 1.0, "complete"))
        for (generation in listOf(null, 0.0, -1.0, 1.5, Double.NaN, Double.POSITIVE_INFINITY,
                                 Double.NEGATIVE_INFINITY, 9_007_199_254_740_992.0))
            assertEquals(LocalSourceScanStatus.INVALID, LocalSourceScans.classify(true, true, 1, generation, "complete"))
        for (generation in listOf(1.0, LocalSourceScans.MAX_GENERATION))
            assertEquals(LocalSourceScanStatus.COMPLETE, LocalSourceScans.classify(true, true, 1, generation, "complete"))
    }

    @Test fun pendingScanningCompleteAndErrorRemainDistinctWithoutAuthorizingPlayback() {
        for ((state, expected) in listOf("pending" to LocalSourceScanStatus.PENDING,
                "scanning" to LocalSourceScanStatus.SCANNING, "complete" to LocalSourceScanStatus.COMPLETE,
                "error" to LocalSourceScanStatus.ERROR))
            assertEquals(expected, LocalSourceScans.classify(true, true, 1, 1.0, state))
        for (state in listOf(null, "", "finished", "Complete"))
            assertEquals(LocalSourceScanStatus.INVALID, LocalSourceScans.classify(true, true, 1, 1.0, state))
    }
}
