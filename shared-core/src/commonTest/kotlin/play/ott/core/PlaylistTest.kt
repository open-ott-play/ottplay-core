package play.ott.core

import kotlin.test.*

class PlaylistTest {
    private fun read(text: String, format: PlaylistFormat = PlaylistFormat.BROWSER) = Playlist.read(text, format, "source",
        { if (it.isEmpty()) "" else if (it.startsWith("https://")) it else "https://test/$it" }, { it.joinToString("|") })
    @Test fun quotedCommaAndAttributes() {
        val result = read("#EXTM3U\n#EXTINF:-1 tvg-name='News, world' group-title = \"TV\" tvg-id=a,Actual, title\nlive")
        assertEquals("Actual, title", result.entries.single().name)
        assertEquals("News, world", result.entries.single().epgName)
        assertEquals("TV", result.entries.single().group)
        assertEquals("source:m3u:tvg:a", result.entries.single().id)
    }
    @Test fun channelArchiveOverridesHeaderAliases() {
        val result = read("#EXTM3U catchup-days=7 catchup=append catchup-source=?s={utc}\n#EXTINF:-1 timeshift=0,No archive\none\n#EXTINF:-1,Archive\ntwo")
        assertEquals(0.0, result.entries[0].archive?.days)
        assertEquals(7.0, result.entries[1].archive?.days)
        assertEquals("?s={utc}", result.entries[1].archive?.source)
        assertEquals("default", read("#EXTM3U\n#EXTINF:-1 catchup-days=3 catchup-source=\" \",A\na").entries.single().archive?.mode)
    }
    @Test fun browserDuplicatesAndVariantsKeepIdentity() {
        val result = read("#EXTM3U\n#EXTINF:-1 tvg-id=a,One\na\n#EXTINF:-1 tvg-id=a,Copy\na\n#EXTINF:-1 tvg-id=a,Two\nb")
        assertEquals(listOf("One", "Two"), result.entries.map { it.name })
        assertEquals(listOf("source:m3u:tvg:a:https://test/a", "source:m3u:tvg:a:https://test/b"), result.entries.map { it.id })
    }
    @Test fun browserFeedsAndGroupInheritance() {
        val result = read("#EXTM3U x-tvg-url=guide.xml group-title=Default\n#EXTINF:-1 url-tvg=custom.xml tvg-source=guide.xml,A\n#EXTGRP:Local\na\n#EXTINF:-1,B\nb")
        assertEquals(listOf("https://test/guide.xml", "https://test/custom.xml"), result.epgUrls)
        assertEquals(listOf("https://test/custom.xml", "https://test/guide.xml"), result.entries[0].epgUrls)
        assertEquals(listOf("Local", "Default"), result.entries.map { it.group })
    }
    @Test fun browserWarningsKeepLineNumbers() {
        val result = read("#EXTM3U\n#EXTINF:-1 broken\nurl\n#comment\n#EXTINF:-1,Good\na")
        assertEquals(listOf("Ignored malformed EXTINF at line 2", "Ignored unsupported or incomplete stream at line 3"), result.warnings)
        assertEquals("Good", result.entries.single().name)
        assertEquals("FORMAT", assertFailsWith<PlaylistFailure> { read("html") }.code)
        assertEquals("EMPTY", assertFailsWith<PlaylistFailure> { read("") }.code)
    }
    @Test fun numericBrowserAttributes() {
        for ((input, expected) in listOf("0x10" to 16.0, "0b11" to 3.0, "0o10" to 8.0, "1.5e1" to 15.0, "bad" to 0.0, "1d" to 0.0, "0xＦＦ" to 0.0, "0x1p2" to 0.0))
            assertEquals(expected, read("#EXTM3U\n#EXTINF:-1 tvg-shift=$input,A\na").entries.single().shift)
    }
    @Test fun androidFoldedMetadataAndPersistentGroups() {
        val result = read("#EXTM3U\n#EXTINF:60\ntvg-id=a group-title=Movies,A\none\n#EXTINF:-1,B\ntwo", PlaylistFormat.ANDROID)
        assertEquals(listOf("Movies", "Movies"), result.entries.map { it.group })
        assertTrue(result.entries.first().movie)
        assertFalse(result.entries.last().movie)
    }
    @Test fun androidDirectiveOrderAndDuplicateValidation() {
        val events = mutableListOf<String>()
        val result = Playlist.read("#EXTINF:-1,A\n#EXTVLCOPT:http-user-agent=First\nhttps://t/a|Origin=One\n#EXTINF:-1,A\n#EXTHTTP:invalid\nhttps://t/a",
            PlaylistFormat.ANDROID, "s", { it }, { it.joinToString("|") },
            onDirective = { events.add(it.kind + ":" + it.value) }, onEntry = { events.add("entry") })
        assertEquals(1, result.entries.size)
        assertEquals(listOf("reset:", "header:First", "query:Origin=One", "entry", "reset:", "reset:", "json:invalid", "entry", "reset:"), events)
    }
    @Test fun androidHlsAndGeneratedName() {
        assertTrue(read("#EXT-X-TARGETDURATION:10\n#KODIPROP:a=b", PlaylistFormat.ANDROID).hls)
        val entry = read("https://t/", PlaylistFormat.ANDROID).entries.single()
        assertEquals("Stream 1", entry.name)
        assertTrue(entry.generatedTitle)
        assertEquals(1, entry.generatedTitleIndex)
    }
    @Test fun androidExplicitDisabledArchiveAndLimits() {
        val result = read("#EXTM3U catchup-days=7\n#EXTINF:-1 catchup=none,A\na\n#EXTINF:-1 catchup-days=NaN,B\nb", PlaylistFormat.ANDROID)
        assertNull(result.entries[0].archive)
        assertNull(result.entries[1].archive)
        assertEquals("LINE_SIZE", assertFailsWith<PlaylistFailure> { read("#EXTM3U\n#" + "a".repeat(1_048_576)) }.code)
    }
    @Test fun providerLegacyAttributeRules() {
        assertEquals("News", ProviderPlaylist.attribute("tvg-name=\"News\"", "tvg-name"))
        assertEquals("", ProviderPlaylist.attribute("TVG-NAME=\"News\"", "tvg-name"))
        assertEquals("'News", ProviderPlaylist.attribute("tvg-name='News world'", "tvg-name"))
        assertEquals(12.0, ProviderPlaylist.integer("12days"))
    }
    @Test fun providerProfilesRetainBlankUriAndGroupDuplicates() {
        val text = "#EXTM3U\n#EXTINF:-1 group-title=\"A\",First\n\nhttps://t/1\n#EXTINF:-1 group-title=\"B\",Second\nhttps://t/1"
        val generic = ProviderPlaylist.read(text, ProviderPlaylistFormat.GENERIC, { 1.0 })
        val base = ProviderPlaylist.read(text, ProviderPlaylistFormat.M3U, { if (it.isEmpty()) 2.0 else 1.0 })
        assertEquals("First", generic.entries.single().name)
        assertEquals(listOf("A", "B"), generic.groupOrder)
        assertEquals(listOf(1.0), generic.groups["B"])
        assertEquals("Second", base.entries.single().name)
        assertEquals(listOf(2.0), base.groups["A"])
        assertEquals(3, base.entries.single().category)
    }
}
