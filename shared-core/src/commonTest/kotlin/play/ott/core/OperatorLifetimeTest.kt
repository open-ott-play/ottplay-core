package play.ott.core

import kotlin.test.*

class OperatorLifetimeTest {
    @Test fun synchronousCompletionNeverAbortsTheSettledTransport() {
        val operation = OperatorRequestLifetime()
        val request = operation.begin()
        assertTrue(operation.accept(request))
        assertEquals(emptyList(), operation.end())
        assertEquals("IGNORE", operation.attach(request))
        assertFalse(operation.accept(request))
        assertNull(operation.end())
    }
    @Test fun cancellationAbortsOnlyUnsettledHandlesOnceAndRejectsLateReplies() {
        val operation = OperatorRequestLifetime()
        val first = operation.begin(); val second = operation.begin()
        assertEquals("KEEP", operation.attach(first))
        assertEquals("KEEP", operation.attach(second))
        assertTrue(operation.accept(first))
        assertEquals(listOf(second), operation.end())
        assertEquals("IGNORE", operation.attach(second))
        assertFalse(operation.accept(second))
        assertEquals(-1, operation.begin())
    }
    @Test fun cancellationDuringTransportSetupAbortsTheLateHandleExactlyOnce() {
        val operation = OperatorRequestLifetime()
        val request = operation.begin()
        assertEquals(emptyList(), operation.end())
        assertEquals("ABORT", operation.attach(request))
        assertEquals("IGNORE", operation.attach(request))
    }
    @Test fun cacheKeepsOneSeriesAndCloseDropsOnlySelectedSourceAndAllSeries() {
        val lifetime = OperatorLifetime<String, String, String>()
        assertEquals(1, lifetime.nextGeneration()); assertEquals(2, lifetime.nextGeneration())
        lifetime.setSession("a", "session"); lifetime.setCatalog("a", "catalog"); lifetime.setCatalog("b", "other")
        lifetime.setSeries("api", "1", "first"); lifetime.setSeries("api", "2", "second")
        assertNull(lifetime.series("api", "1")); assertEquals("second", lifetime.series("api", "2"))
        lifetime.close("a")
        assertNull(lifetime.session("a")); assertNull(lifetime.catalog("a")); assertNull(lifetime.series("api", "2"))
        assertEquals("other", lifetime.catalog("b"))
        assertEquals(listOf(1, 2), OperatorLifetime.libraryIndices(listOf("live", "movie", "folder")))
    }
}
