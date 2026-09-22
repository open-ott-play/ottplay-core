package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlaybackRecoveryTest {
    @Test fun decoderRecoveryAndTransientNetworkBudgetsAreIndependent() {
        val policy = PlaybackRecovery()
        assertFalse(policy.media(false)); assertTrue(policy.media()); assertFalse(policy.media())
        assertTrue(policy.network("timeout")); assertTrue(policy.network("timeout")); assertFalse(policy.network("timeout"))
        policy.reset(); assertFalse(policy.network("manifestParsingError")); assertTrue(policy.network("timeout"))
    }
    @Test fun restartIsOneShotUntilSuccessfulManifestOrExplicitPlayback() {
        val policy = PlaybackRestart()
        assertEquals("stop", policy.admit(true, true, true))
        assertEquals("stop", policy.admit(true, false, false))
        assertEquals("restart", policy.admit(true, false, true)); assertTrue(policy.pending)
        assertEquals("stop", policy.admit(true, false, true))
        policy.finish(); assertFalse(policy.pending); assertEquals("stop", policy.admit(true, false, true))
        policy.reset(); assertEquals("restart", policy.admit(true, false, true))
    }
    @Test fun fallbackKeepsOrderAndNeverLoopsBackToFailedEngine() {
        val policy = PlaybackEngineSequence()
        policy.set(listOf("native", "hls.js", "shaka"))
        assertFalse(policy.canAdvance(false)); assertTrue(policy.canAdvance(true))
        policy.advance(); assertEquals("hls.js", policy.current()); assertEquals(1, policy.fallbacks)
        policy.advance(); assertEquals("shaka", policy.current()); assertFalse(policy.canAdvance(true))
        policy.reset(); assertTrue(policy.empty()); assertEquals(0, policy.fallbacks)
    }
    @Test fun detectionHonorsDeclaredMetadataAndBoundedBinaryPrefixes() {
        assertEquals(PlaybackDetection("dash", "declared_type"), PlaybackDetectionRules.declared("dash+xml", "ts", "flv", "hls", "video.mp4"))
        assertEquals(PlaybackDetection("flv", "url_hint"), PlaybackDetectionRules.declared("", "", "", "flv", "live.m3u8"))
        assertEquals("dash", PlaybackDetectionRules.body("<?xml version='1'?><!--x--><dash:MPD >"))
        assertEquals("dash", PlaybackDetectionRules.body("<!--x--><!--y--><MPD>"))
        assertEquals("", PlaybackDetectionRules.body("<MPD/>"))
        assertEquals("mpegts", PlaybackDetectionRules.body("G" + ".".repeat(187) + "G" + ".".repeat(187) + "G"))
    }
}
