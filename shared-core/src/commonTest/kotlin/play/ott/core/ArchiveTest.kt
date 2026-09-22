package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ArchiveTest {
    private val epoch = 1767225600.0 // 2026-01-01T00:00Z
    private val base = ArchiveRequest("https://video.test/index.m3u8?token=a%2Fb&x=1&x=2", "default",
        "https://archive.test/?s={utc}&e={end}&d={duration}&o={offset}", 2.0, epoch, epoch + 3600, epoch + 7200)
    private fun resolve(request: ArchiveRequest = base, format: ArchiveFormat = ArchiveFormat.BROWSER) =
        Archive.resolve(request, format, { listOf(2026, 1, 1, 0, 0, 0) }, { it })

    @Test fun retentionAndCurrentProgrammesUseExplicitClientContracts() {
        assertNull(resolve(base.copy(now = epoch + 1800)))
        assertEquals("https://archive.test/?s=1767225600&e=1767227400&d=1800&o=1800", resolve(base.copy(now = epoch + 1800), ArchiveFormat.ANDROID))
        assertEquals("https://archive.test/?s=1767225600&e=1767229200&d=3600&o=172800", resolve(base.copy(now = epoch + 172800)))
        assertNull(resolve(base.copy(now = epoch + 172800.001)))
        assertNull(resolve(base.copy(start = base.now)))
        assertNull(resolve(base.copy(end = base.start)))
        assertNull(resolve(base.copy(days = 0.0)))
        assertEquals(resolve(base), resolve(base.copy(days = 0.0), ArchiveFormat.ANDROID))
    }

    @Test fun appendCorrectionAndFractionalValuesDoNotChangeRetention() {
        val request = base.copy(mode = "append", source = "&s=\${start}&e={end}&d={duration:60}&o={offset:60}",
            start = epoch + 0.75, end = epoch + 61.25, now = epoch + 121.25, correction = 1.0)
        assertEquals(base.url + "&s=1767229200&e=1767229261&d=1&o=2", resolve(request))
        assertEquals("https://video.test/index.m3u8?s=1767229200&e=1767229261&d=1&o=2", resolve(request.copy(url = "https://video.test/index.m3u8#player")))
        assertNull(resolve(request.copy(source = "/not-a-query/{start}")))
    }

    @Test fun templatesFailClosedWithoutPretendingToPlayArchive() {
        for (template in listOf("https://a.test/live", "https://a.test/{unknown}", "https://a.test/{duration}", "https://a.test/{offset:0}", "https://a.test/{utc", "https://a.test/{catchup-id}"))
            assertNull(resolve(base.copy(source = template)), template)
        assertNull(resolve(base.copy(mode = "unsupported")))
        for (bad in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertNull(resolve(base.copy(start = bad)))
            assertNull(resolve(base.copy(days = bad)))
            assertNull(resolve(base.copy(correction = bad)))
        }
        assertNull(resolve(base.copy(live = false), ArchiveFormat.ANDROID))
    }

    @Test fun programmeIdsAreEncodedAsComponentsOnEveryTarget() {
        assertEquals("https://a.test/%D0%9A%D0%B8%D0%BD%D0%BE%2F%F0%9F%8E%AC%3Fx%3D1", resolve(base.copy(mode = "vod", source = "https://a.test/{catchup-id}", programmeId = "Кино/🎬?x=1")))
        assertNull(resolve(base.copy(source = "https://a.test/{catchup-id}", programmeId = charArrayOf(0xD800.toChar()).concatToString())))
        assertEquals("https://a.test/2026-01-01T00:00:00", resolve(base.copy(source = "https://a.test/{Y}-{m}-{d}T{H}:{M}:{S}")))
    }

    @Test fun xtreamRoundsOutwardsAndEscapesCredentials() {
        val request = base.copy(mode = "xtream", base = "https://xc.test/", username = "a/b", password = "x?&",
            streamId = "42", extension = "m3u8", start = epoch + 30, end = epoch + 91)
        var calendarInput = 0.0
        val url = Archive.resolve(request, ArchiveFormat.BROWSER, { calendarInput = it; listOf(2026, 1, 1, 0, 0, 0) }, { it })
        assertEquals(epoch, calendarInput)
        assertEquals("https://xc.test/timeshift/a%2Fb/x%3F%26/2/2026-01-01:00-00/42.m3u8", url)
        assertNull(resolve(request.copy(streamId = "42/other")))
        assertNull(resolve(request.copy(username = null)))
        assertNull(resolve(request.copy(extension = "../ts")))
    }

    @Test fun flussonicChangesOnlyTerminalResourceAndKeepsSignedQueryBytes() {
        for ((name, prefix, extension) in listOf(Triple("index.m3u8", "archive-", ".m3u8"), Triple("video.m3u8", "video-", ".m3u8"),
            Triple("mono.m3u8", "mono-", ".m3u8"), Triple("mpegts", "archive-", ".ts"), Triple("index.mpd", "archive-", ".mpd"))) {
            val request = base.copy(mode = "flussonic", source = "", url = "https://v.test/$name?token=a%2Fb&x=1&x=2#ignored")
            assertEquals("https://v.test/${prefix}1767225600-3600$extension?token=a%2Fb&x=1&x=2", resolve(request))
        }
        for (url in listOf("https://v.test/index.m3u8/other", "https://v.test/other?file=index.m3u8", "https://v.test/index.m3u8x", "https://index.m3u8?token=x", "https://mpegts"))
            assertNull(resolve(base.copy(mode = "flussonic", source = "", url = url)))
        assertNull(resolve(base.copy(mode = "flussonic", days = 31.0)))
        assertNull(resolve(base.copy(mode = "flussonic", correction = 25.0)))
        val current = base.copy(mode = "flussonic", source = "", start = base.now - 599, end = base.now + 30)
        assertEquals("https://video.test/timeshift_abs-1767232201.m3u8?token=a%2Fb&x=1&x=2", resolve(current, ArchiveFormat.ANDROID))
    }

    @Test fun androidKeepsChannelAuthorizationAndHostTimeZoneFields() {
        val request = base.copy(epgId = "exact-id", channelName = "Display", channelId = "EXACT-ID", mode = "xtream", source = "https://xc.test/{durationMinutes}/{startDate}")
        assertEquals("https://xc.test/60/2026-01-01:00-00", resolve(request, ArchiveFormat.ANDROID))
        assertEquals(resolve(request, ArchiveFormat.ANDROID), resolve(request.copy(channelId = "display"), ArchiveFormat.ANDROID))
        assertNull(resolve(request.copy(channelId = "other"), ArchiveFormat.ANDROID))
        assertEquals("https://xc.test/60/2026-01-01:05-30", Archive.resolve(request, ArchiveFormat.ANDROID, { listOf(2026, 1, 1, 5, 30, 0) }, { it }))
    }

    @Test fun providerProfilesKeepDuneAndAbsoluteShiftBoundaries() {
        fun url(profile: String, start: Double = 100.25, end: Double = 160.75, now: Double = 1000.5, dune: Boolean = false, variant: Int = 0) =
            Archive.provider(profile, "https://v.test/index.m3u8?token=x", "", "flussonic", start, end, now, dune, variant)
        assertEquals("https://v.test/archive-100-7260.m3u8?token=x", url("m3u", dune = true))
        assertEquals("https://v.test/archive-400-59.m3u8?token=x", url("m3u", start = 400.5, end = 460.0))
        assertEquals("https://v.test/timeshift_abs-400.m3u8?token=x", url("m3u", start = 400.501, end = 460.0))
        assertEquals("https://v.test/index-100-60.m3u8?token=x", url("kb"))
        assertEquals("https://v.test/index-100-1500.m3u8?token=x", url("only4", end = 0.0, variant = 2))
        assertEquals("https://v.test/index.m3u8?token=x&utc=100&lutc=1000", url("auto-utc-now"))
    }

    @Test fun providerTemplatesPreserveUnknownWirePlaceholders() {
        assertEquals("s=100&e=160&d=60&o=900&keep={utc}&unknown=\${foo}", Archive.provider("template", "", "s=\${start}&e=\${end}&d=\${duration}&o=\${offset}&keep={utc}&unknown=\${foo}", "", 100.25, 160.75, 1000.1))
        assertNull(Archive.provider("template", "", "", "", 0.0, 1.0, 2.0))
    }
}
