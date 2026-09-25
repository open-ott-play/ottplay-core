package play.ott.core

import kotlin.test.*

class OperatorPlaylistTest {
    private val sample = "#EXTM3U\n#EXTINF:-1 tvg-id=guide tvg-name=one timeshift=2 catchup-days=3 group-title=A,First, suffix\nhttps://v.test/token/one/42.ts\n#EXTINF:-1 tvg-name=one group-title=B,Copy\nhttps://v.test/token/one/42.ts"
    @Test fun operatorIdentityAndTitleProfiles() {
        val one = OperatorPlaylist.read(sample, "1ott", { 5.0 }).entries.single()
        assertEquals("one", one.id); assertEquals("First", one.name)
        val only = OperatorPlaylist.read(sample, "only4", { 5.0 }).entries.single()
        assertEquals("token", only.id); assertEquals("First, suffix", only.name)
        val team = OperatorPlaylist.read(sample, "tvteam", { 5.0 }).entries.single()
        assertEquals(336.0, team.hours)
    }
    @Test fun groupsRetainProviderSpecificDuplicateMembership() {
        val shared = OperatorPlaylist.read(sample, "1ott", { 5.0 })
        assertEquals(listOf("A", "B"), shared.groupOrder)
        val unique = OperatorPlaylist.read(sample, "shara-tv", { 5.0 })
        assertEquals(listOf("A"), unique.groupOrder)
    }
    @Test fun extendedProfilesKeepUndefinedIdsAndWireFallbacks() {
        val input = "#EXTM3U catchup=append\n#EXTINF:-1 tvg-name=Name,\nhttps://v.test/live"
        val edem = OperatorPlaylist.read(input, "edem", { 5.0 }).entries.single()
        assertNull(edem.id); assertEquals("", edem.name); assertFalse(edem.generatedName)
        assertNull(edem.hours); assertEquals("0", edem.fallbackHours)
        val kb = OperatorPlaylist.read(input, "kb-team", { 5.0 }).entries.single()
        assertEquals(5.0, kb.id); assertEquals("kbc", kb.feed); assertEquals("", kb.fallbackHours)
    }
    @Test fun malformedOperatorKeepsEarlierEntries() {
        val parsed = OperatorPlaylist.read("#EXTM3U\n#EXTINF:-1,One\nhttps://v.test/live/token/42.ts\n#EXTINF:-1 broken", "antifriz", { 0.0 })
        assertTrue(parsed.malformed)
        assertEquals("42", parsed.entries.single().id)
        assertEquals("token", parsed.entries.single().token)
    }
    @Test fun categoriesUpdateOnlyKnownChannelsAndMediaRetainsDuplicates() {
        val categories = OperatorPlaylist.read(sample, "shura", { 0.0 }, setOf("one"))
        assertEquals(listOf("A", "B"), categories.entries.map { it.group })
        assertTrue(OperatorPlaylist.read(sample, "shura", { 0.0 }).entries.isEmpty())
        val media = OperatorPlaylist.media(sample)
        assertEquals(listOf("First, suffix", "Copy"), media.map { it.name })
        assertEquals(media[0].url, media[1].url)
    }
}
