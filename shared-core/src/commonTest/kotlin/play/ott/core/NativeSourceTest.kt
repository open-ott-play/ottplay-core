package play.ott.core

import kotlin.test.*

class NativeSourceTest {
    @Test fun sourcePrecedenceAndPlatformWhitespace() {
        val a = "https://a.invalid/"; val b = "https://b.invalid/"
        assertEquals(listOf("https://cdn.epg.one/epg2.xml.gz"), NativeGuideSources.urls(listOf(" "), a, true, NativeSourceFormat.SWIFT))
        assertEquals(listOf(a), NativeGuideSources.urls(listOf(" "), a, true, NativeSourceFormat.ANDROID))
        assertEquals(emptyList(), NativeGuideSources.urls(listOf(" "), "", false, NativeSourceFormat.ANDROID))
        assertEquals(listOf(b, a), NativeGuideSources.urls(listOf(" $b ", a, b), a, false, NativeSourceFormat.ANDROID))
        assertEquals(listOf(" $a ", a), NativeGuideSources.urls(listOf(a, " ", a), " $a ", false, NativeSourceFormat.ANDROID_RAW))
        assertEquals(listOf(a), NativeGuideSources.urls(listOf("\u0085"), a, true, NativeSourceFormat.SWIFT, trim = { a }))
    }
    @Test fun cacheAndPendingPrecedenceIncludingForcedRefresh() {
        for (stamp in listOf(null, 992801.0, 992800.0, 992799.0, 1000001.0)) {
            for (force in listOf(false, true)) for (pending in listOf(false, true)) {
                val expected = when {
                    !force && stamp != null && stamp > 992800 -> NativeCacheLookup.CACHE
                    pending -> NativeCacheLookup.JOIN
                    else -> NativeCacheLookup.LOAD
                }
                assertEquals(expected, NativeGuideSources.lookup(1000000.0, stamp, force, pending))
                assertEquals(expected, NativeGuideSources.lookupAndroid(1000000, stamp?.toLong(), force, pending))
            }
        }
    }
    @Test fun diskProfilesKeepTheirTtlAndNumberSemantics() {
        assertFalse(NativeGuideSources.diskSwift("a", "a", 7200.0, 0.0, false))
        assertTrue(NativeGuideSources.diskAndroid("a", "a", 7200, 0, false))
        assertFalse(NativeGuideSources.diskAndroid("a", "a", 7201, 0, false))
        assertFalse(NativeGuideSources.diskSwift("a", "b", 0.0, Double.POSITIVE_INFINITY, true))
        assertFalse(NativeGuideSources.diskAndroid("a", "b", 0, Long.MAX_VALUE, true))
        assertFalse(NativeGuideSources.diskSwift("a", "a", 0.0, Double.NaN, false))
        assertTrue(NativeGuideSources.diskSwift("a", "a", 0.0, Double.NaN, true))
        assertTrue(NativeGuideSources.diskAndroid("a", "a", 1000000, Long.MIN_VALUE, false))
    }
    @Test fun sourceOwnershipAndAtomicRefresh() {
        assertEquals(listOf("__proto__", "new"), NativeGuideSources.unowned(listOf("old"), listOf("old", "__proto__", "new", "new")))
        val cases = listOf(
            Triple(false, false, false) to NativeCacheRefresh.REPLACE,
            Triple(false, false, true) to NativeCacheRefresh.REPLACE,
            Triple(false, true, false) to NativeCacheRefresh.FAIL,
            Triple(false, true, true) to NativeCacheRefresh.STALE,
            Triple(true, false, false) to NativeCacheRefresh.REPLACE,
            Triple(true, false, true) to NativeCacheRefresh.STALE,
            Triple(true, true, false) to NativeCacheRefresh.FAIL,
            Triple(true, true, true) to NativeCacheRefresh.STALE)
        for ((input, expected) in cases)
            assertEquals(expected, NativeGuideSources.refresh(input.first, input.second, input.third))
        assertFalse(NativeGuideSources.evictSourceSet(7, false))
        assertFalse(NativeGuideSources.evictSourceSet(8, true))
        assertTrue(NativeGuideSources.evictSourceSet(8, false))
    }
}
