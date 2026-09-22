package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlaybackRulesTest {
    @Test fun formatPrecedenceAndBoundaries() {
        assertEquals("hls", PlaybackRules.format("application/mpegurl-flv"))
        assertEquals("dash", PlaybackRules.format("foo/mpd?token"))
        assertEquals("", PlaybackRules.format("foo.mpd#fragment"))
        assertEquals("flv", PlaybackRules.format("flv-mpegts"))
        assertEquals("file", PlaybackRules.format("video/mp4extra"))
        assertTrue(PlaybackRules.urlExtension("https://host/?next=a.MPD#x", listOf("mpd")))
        assertFalse(PlaybackRules.urlExtension("https://host/a.mpd/path", listOf("mpd")))
    }
    @Test fun enginePreferenceAndPlatformOrder() {
        val all = PlaybackCapabilities(true, true, true, true, true, true)
        assertEquals(listOf("native", "hls.js", "shaka"), PlaybackRules.engines("hls", "auto", all))
        assertEquals(listOf("hls.js", "shaka", "native"), PlaybackRules.engines("hls", "auto", all.copy(chromium = true)))
        assertEquals(listOf("native"), PlaybackRules.engines("hls", "auto", PlaybackCapabilities(lg = true)))
        assertEquals(emptyList(), PlaybackRules.engines("dash", "auto", PlaybackCapabilities()))
        assertEquals(listOf("shaka"), PlaybackRules.engines("file", "shaka", PlaybackCapabilities()))
    }
    @Test fun classicCapabilitiesStayLazy() {
        val unused = { error("unneeded decoder probe") }
        assertEquals(2, PlaybackRules.classicAutoMode("https://host/a.mpd", unused, unused, unused))
        assertEquals(0, PlaybackRules.classicAutoMode("https://host/a.mp4", unused, unused, unused))
        assertEquals(3, PlaybackRules.classicDefaultMode(true, false, unused))
        assertEquals(1.5, PlaybackRules.classicMode(1.5, false, unused, unused, unused))
        assertEquals(3.0, PlaybackRules.classicMode(0.0, true, unused, unused, unused))
        assertEquals(1, PlaybackRules.classicAutoMode("live.m3u8", { false }, { false }, unused))
        assertEquals(0, PlaybackRules.classicAutoMode("live.m3u8", unused, { true }, { false }))
    }
    @Test fun seekKeepsGapTiesAndLiveEdgePolicy() {
        val ranges = listOf(PlaybackRange(5.0, 10.0), PlaybackRange(20.0, 30.0))
        assertEquals(10.0, PlaybackRules.seek(12.0, 5.0, 30.0, ranges))
        assertEquals(20.0, PlaybackRules.seek(15.0, 5.0, 30.0, ranges))
        assertEquals(20.0, PlaybackRules.seek(12.0, 5.0, 30.0, ranges, true))
        assertEquals(5.0, PlaybackRules.seek(-100.0, 5.0, 30.0, ranges))
        assertEquals(0.0, PlaybackRules.seek(-100.0, 0.0, -2.0, emptyList()))
    }
    @Test fun retriesKeepTheSessionBudgetUntilExplicitReset() {
        val retries = PlaybackRetries(3, 100.0)
        assertFalse(retries.admit(false)); assertEquals(0, retries.attempts)
        for (attempt in 1..3) { assertTrue(retries.admit(true)); assertEquals(attempt * 100.0, retries.delay()) }
        assertFalse(retries.admit(true))
        retries.reset(); assertTrue(retries.admit(true)); assertEquals(100.0, retries.delay())
        assertEquals(3, PlaybackRules.retryLimit(Double.NaN)); assertEquals(3, PlaybackRules.retryLimit(null))
        assertEquals(0, PlaybackRules.retryLimit(-1.0)); assertEquals(1, PlaybackRules.retryLimit(1.9))
    }
    @Test fun shortVideosRetainPositionsOutsideTheirProportionalTail() {
        assertEquals(8_000L, PlaybackRules.nativeResume(8_000, 10_000))
        assertEquals(0L, PlaybackRules.nativeResume(9_500, 10_000))
        assertEquals(94_999L, PlaybackRules.nativeResume(94_999, 100_000))
        assertEquals(0L, PlaybackRules.nativeResume(95_000, 100_000))
        assertEquals(0L, PlaybackRules.nativeResume(-1, 0))
        assertEquals(Long.MAX_VALUE, PlaybackRules.nativeResume(Long.MAX_VALUE, 0))
    }
    @Test fun trackIdentityNeverResolvesLanguageAmbiguityArbitrarily() {
        val tracks = listOf(PlaybackTrack("ru", "Original"), PlaybackTrack("rus", "Commentary"), PlaybackTrack("eng", "English", true))
        assertEquals(1, PlaybackRules.track(tracks, "RU", " commentary ", false))
        assertEquals(-1, PlaybackRules.track(tracks, "ru", "", false))
        assertEquals(2, PlaybackRules.track(tracks, "en", "old title", false))
        assertEquals(-1, PlaybackRules.track(tracks, "de", "English", true))
        assertEquals(-1, PlaybackRules.track(tracks, "", "", false))
        assertEquals(2, PlaybackRules.track(tracks, "", "", true))
    }
}
