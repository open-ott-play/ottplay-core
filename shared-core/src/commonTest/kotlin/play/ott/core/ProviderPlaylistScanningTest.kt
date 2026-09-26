package play.ott.core

import kotlin.test.*

class ProviderPlaylistScanningTest {
    @Test fun shiftPrefixesKeepPartialExponentsSeparateFromStrictNumberCoercion() {
        for ((input, prefix) in listOf("1e" to 1.0, "1e+" to 1.0, "1e-" to 1.0, "1e+-2" to 1.0,
            "1e+2suffix" to 100.0, "+.5tail" to 0.5, "-.5E-2tail" to -0.005,
            "Infinitytail" to Double.POSITIVE_INFINITY, "-Infinitytail" to Double.NEGATIVE_INFINITY)) {
            val playlist = "#EXTM3U\n#EXTINF:-1 tvg-shift=\"$input\",Title\nhttps://tv.test/one"
            val entry = ProviderPlaylist.read(playlist, ProviderPlaylistFormat.M3U, { 1.0 }).entries.single()
            assertEquals(kotlin.math.floor(prefix * -3600), entry.shift, input)
            assertTrue(ProviderValue.text(input).number().isNaN(), input)
        }
        for (input in listOf("", "+", "-", ".", "e1", "0x10")) {
            val playlist = "#EXTM3U\n#EXTINF:-1 tvg-shift=\"$input\",Title\nhttps://tv.test/one"
            assertEquals(0.0, ProviderPlaylist.read(playlist, ProviderPlaylistFormat.M3U, { 1.0 }).entries.single().shift, input)
        }
        assertEquals(16.0, ProviderValue.text("0x10").number())
    }

    @Test fun quotesOpenAtAttributeValueBoundariesNotAtBareApostrophes() {
        for (raw in listOf("-1 group-title=Kids'Club,Actual, title", "-1 tvg-name = 'News, world',Actual, title", "-1 tvg-logo=https://img/x='a,Actual, title")) {
            val comma = Playlist.titleComma(raw)
            assertEquals("Actual, title", raw.substring(comma + 1))
            val text = "#EXTM3U\n#EXTINF:$raw\nhttps://tv.test/one"
            for (format in ProviderPlaylistFormat.entries) {
                assertEquals("Actual, title", ProviderPlaylist.read(text, format, { 1.0 }).entries.single().name)
            }
            for (format in PlaylistFormat.entries) {
                assertEquals("Actual, title", Playlist.read(text, format, "s", { it }, { it.joinToString(":") }).entries.single().name)
            }
            assertEquals("Actual, title", OperatorPlaylist.media(text).single().name)
        }
    }

    @Test fun quotedDelimiterChangesLabelsWithoutChangingUrlIdentityOrCompanionHashInput() {
        val raw = "-1 tvg-name=\"EPG, Alias\" tvg-id=\"one\" group-title=\"TV\" tvg-logo=\"https://img/t,a.png\" catchup-days=2 catchup=append catchup-source=\"?utc={utc},fixed\" tvg-shift=1.5,Actual, title"
        val url = "https://tv.test/a?token=x,y"
        val text = "#EXTM3U catchup-days=7\r\n#EXTINF:$raw\r\n \t\r\n#EXTVLCOPT:http-user-agent=Agent\r\n\t$url \r\n"
        for (format in ProviderPlaylistFormat.entries) {
            val hashed = mutableListOf<String>()
            val result = ProviderPlaylist.read(text, format, { hashed.add(it); 12345.0 }, 96.0)
            val entry = result.entries.single()
            assertEquals(listOf(url), hashed)
            assertEquals(12345.0, entry.id)
            assertEquals(url, entry.url)
            assertEquals("Actual, title", entry.name)
            assertEquals(raw + "\r", entry.raw)
            assertEquals(CoreText.trim(raw.substringAfter(',')), entry.titleHashInput)
            assertEquals("https://img/t,a.png", entry.logo)
            assertEquals(listOf(12345.0), result.groups["TV"])
            assertEquals(2, entry.category)
            if (format == ProviderPlaylistFormat.M3U) {
                assertEquals("EPG, Alias", entry.epgName)
                assertEquals("one", entry.epgId)
                assertEquals(48.0, entry.archiveHours)
                assertEquals("append", entry.archiveMode)
                assertEquals("?utc={utc},fixed", entry.archiveSource)
                assertEquals(-5400.0, entry.shift)
            } else {
                assertEquals("Actual, title", entry.epgName)
                assertEquals(0.0, entry.archiveHours)
                assertEquals("", entry.archiveMode)
            }
        }
    }

    @Test fun recordsStopBeforeTheNextExtinfAndKeepDirectiveGrouping() {
        val text = "#EXTM3U\n#EXTINF:-1,Missing\n\n#comment\n#EXTINF:-1,Found, suffix\n\n#EXTGRP:Local\n#comment\n\thttps://tv.test/found \t\n#EXTINF:-1,Truncated\n#comment"
        val result = ProviderPlaylist.read(text, ProviderPlaylistFormat.M3U, { if (it.isEmpty()) 0.0 else 42.0 })
        assertEquals("Found, suffix", result.entries.single().name)
        assertEquals("https://tv.test/found", result.entries.single().url)
        assertEquals("Local", result.entries.single().group)
        assertEquals(listOf(42.0), result.groups["Local"])
        val media = OperatorPlaylist.media(text).single()
        assertEquals("Found, suffix", media.name)
        assertEquals("https://tv.test/found", media.url)
    }

    @Test fun ordinaryRecordsKeepFirstUrlDedupAndGroupOrder() {
        val text = "#EXTM3U catchup=append catchup-source=?s={utc} catchup-days=3\n" +
            "#EXTINF:-1 group-title=\"A\",First\nhttps://tv.test/one\n" +
            "#EXTINF:-1 group-title=\"B\",Copy\nhttps://tv.test/one\n" +
            "#EXTINF:-1 group-title=\"B\",Second\nhttps://tv.test/two"
        for (format in ProviderPlaylistFormat.entries) {
            val result = ProviderPlaylist.read(text, format, { if (it.endsWith("one")) 101.0 else 202.0 })
            assertEquals(listOf(101.0, 202.0), result.entries.map { it.id })
            assertEquals(listOf("First", "Second"), result.entries.map { it.name })
            assertEquals(listOf("First", "Second"), result.entries.map { it.titleHashInput })
            assertEquals(listOf("A", "B"), result.groupOrder)
            assertEquals(listOf(101.0, 202.0), result.groups["B"])
            assertEquals(listOf(2, 3), result.entries.map { it.category })
            if (format == ProviderPlaylistFormat.M3U) {
                assertTrue(result.entries.all { it.archiveHours == 72.0 && it.archiveMode == "append" && it.archiveSource == "?s={utc}" })
            }
        }
        assertEquals(listOf("First", "Copy", "Second"), OperatorPlaylist.media(text).map { it.name })
    }

    @Test fun malformedMetadataCannotConsumeTheNextRecordOrThrow() {
        for (prefix in listOf("", "#EXTM3U\n", "#EXTINF:", "#EXTINF:-1 broken\n#comment\n")) {
            assertTrue(OperatorPlaylist.media(prefix).isEmpty())
            for (format in ProviderPlaylistFormat.entries) {
                assertTrue(ProviderPlaylist.read(prefix, format, { 0.0 }).entries.isEmpty())
            }
        }
        val text = "#EXTM3U\n#EXTINF:-1 tvg-name=\"unterminated,title\n#comment\n" +
            "#EXTINF:-1,Valid\nhttps://tv.test/valid"
        assertEquals("Valid", OperatorPlaylist.media(text).single().name)
        for (format in ProviderPlaylistFormat.entries) {
            assertEquals("Valid", ProviderPlaylist.read(text, format, { if (it.isEmpty()) 0.0 else 1.0 }).entries.single().name)
        }
        val incompleteLabel = "#EXTM3U\n#EXTINF:-1 tvg-name=\"unterminated,title\nhttps://tv.test/one"
        val recovered = ProviderPlaylist.read(incompleteLabel, ProviderPlaylistFormat.M3U, { 42.0 }).entries.single()
        assertEquals(42.0, recovered.id)
        assertEquals("https://tv.test/one", recovered.url)
        assertTrue(recovered.generatedName)
        assertEquals("", recovered.name)
        assertEquals("title", recovered.titleHashInput)
        assertTrue(OperatorPlaylist.media(incompleteLabel).single().generatedName)
    }

    @Test fun mediaPreservesEmptyAndGeneratedNamesAndDuplicateUris() {
        val text = "#EXTM3U\n#EXTINF:-1 tvg-logo=\"https://img/a,b\",Film, part two\n\n#comment\nhttps://tv.test/film\n" +
            "#EXTINF:-1,\nhttps://tv.test/film\n#EXTINF:-1 broken\nhttps://tv.test/other"
        val media = OperatorPlaylist.media(text)
        assertEquals(listOf("Film, part two", "", ""), media.map { it.name })
        assertEquals(listOf(false, false, true), media.map { it.generatedName })
        assertEquals("https://img/a,b", media.first().logo)
        assertEquals(media[0].url, media[1].url)
    }
}
