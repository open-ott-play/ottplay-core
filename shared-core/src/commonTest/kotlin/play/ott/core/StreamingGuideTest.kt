package play.ott.core

import kotlin.test.*

class StreamingGuideTest {
    private val now = 1_000_000.0
    private fun identity(id: String = "a", name: String = "", days: Double = 7.0) = StreamingGuideIdentity(id, "", name, days)
    private fun guide(rows: List<StreamingGuideIdentity> = listOf(identity()), global: Double = 100.0, perChannel: Double = 10.0) =
        StreamingGuide<String>(rows, now, global, perChannel)
    private fun StreamingGuide<String>.add(id: String, start: Double, end: Double?, title: String) {
        if (accepts(id, now + start, end?.plus(now))) programme(id, now + start, end?.plus(now), title)
    }
    private fun output(guide: StreamingGuide<String>, limit: Double = 10000.0): Pair<StreamingGuideCoverage?, List<String>> {
        val emitted = mutableListOf<String>()
        val coverage = guide.output(limit, { "channel:${it.id}:${it.names.joinToString(",")}:${it.logo}" }, { id, title -> "$id:$title" }, String::length, emitted::add)
        return coverage to emitted
    }

    @Test fun normalizedIdentityKeepsMaximumDepthAndIgnoresLocalPresentation() {
        val result = StreamingGuide.identities(listOf(identity(" a ", " News   HD ", 0.0), identity("a", "news hd", 3.5)))
        assertEquals(listOf(identity("a", "news hd", 3.5)), result)
        assertFailsWith<IllegalArgumentException> { StreamingGuide.identities(listOf(identity("", " "))) }
    }
    @Test fun halfOpenWindowsAndOpenStopsRespectPerChannelDepth() {
        val filter = guide(listOf(identity(days = 1.5)))
        assertFalse(filter.accepts("a", now - 129601, null))
        assertTrue(filter.accepts("a", now - 129600, null))
        assertFalse(filter.accepts("a", now - 129601, now - 129600))
        assertTrue(filter.accepts("a", now - 129601, now - 129599))
        assertFalse(filter.accepts("a", now + 86400, null))
        assertFalse(filter.accepts("a", now, now))
        assertFalse(filter.accepts("a", null, now + 10))
        assertFalse(filter.accepts("unknown", now, null))
    }
    @Test fun distantNextSurvivesNearbyHistoryAndEqualFutureDoesNotReplaceIt() {
        val filter = guide(perChannel = 2.0)
        filter.add("a", -10.0, 100.0, "current")
        filter.add("a", -11.0, -10.0, "history")
        filter.add("a", 10000.0, null, "next")
        filter.add("a", 10000.0, null, "tied next")
        val (coverage, rows) = output(filter)
        assertEquals(listOf("channel:a::", "a:current", "a:next"), rows)
        assertEquals(1, coverage?.truncatedChannels)
    }
    @Test fun firstEqualOverlapWinsButNewerCurrentDisplacesIt() {
        val filter = guide(perChannel = 1.0)
        filter.add("a", -20.0, null, "first")
        filter.add("a", -20.0, null, "equal")
        filter.add("a", -10.0, null, "latest")
        assertEquals("a:latest", output(filter).second.last())
    }
    @Test fun rejectedNextIsRememberedWithoutGivingLaterEqualRowsPriority() {
        val filter = guide(listOf(identity("a"), identity("b")), global = 1.0)
        filter.add("a", -1.0, 1.0, "occupies global budget")
        filter.add("b", 10.0, 20.0, "rejected earliest")
        filter.add("b", 10.0, 30.0, "also rejected")
        val result = output(filter)
        assertEquals(listOf("channel:a::", "channel:b::", "a:occupies global budget"), result.second)
        assertEquals(1, result.first?.truncatedChannels)
    }
    @Test fun ambiguousMetadataRemainsVisibleButReceivesNoSchedule() {
        val filter = guide(listOf(identity("", "news uhd")))
        filter.channel("a", listOf("News HD"), "first")
        filter.channel("b", listOf("News FHD"), "second")
        filter.add("a", -10.0, 10.0, "unselected")
        assertEquals(listOf("channel:a:News HD:first", "channel:b:News FHD:second"), output(filter).second)
    }
    @Test fun metadataPrecedenceAndProgrammeOnlyChannelsSurvive() {
        val filter = guide(listOf(identity("a"), identity("b")))
        filter.channel("a", listOf("News", "News"), "")
        filter.channel("a", listOf("News", "HD News"), "first")
        filter.channel("a", listOf("Last"), "second")
        filter.add("b", -1.0, 1.0, "only programme")
        assertEquals(listOf("channel:a:News,HD News,Last:first", "channel:b::", "b:only programme"), output(filter).second)
    }
    @Test fun lateMetadataShrinksFutureShareWithoutRetroactivePruning() {
        val filter = guide(listOf(identity("a", "news")), global = 4.0, perChannel = 4.0)
        for (i in 1..4) filter.add("a", -i.toDouble(), 10.0, "$i")
        filter.channel("b", listOf("News"), "")
        filter.add("a", 0.0, 10.0, "latest")
        val (coverage, rows) = output(filter)
        assertEquals(2.0, coverage?.programmeLimit)
        assertEquals(listOf("a:latest", "a:1", "a:2", "a:3"), rows.filter { it.startsWith("a:") })
    }
    @Test fun outputVisitsCurrentThenNextAcrossChannelsAndSkipsOversizedRows() {
        val filter = guide(listOf(identity("a"), identity("b")))
        filter.add("a", -1.0, 1.0, "too large")
        filter.add("a", 1.0, 2.0, "next")
        filter.add("b", -1.0, 1.0, "current")
        filter.add("b", 1.0, 2.0, "next")
        val emitted = mutableListOf<String>()
        val coverage = filter.output(515.0, { "" }, { id, title -> "$id:$title" }, { if (it.isEmpty()) 0 else if (it.endsWith("too large")) 100 else 1 }, emitted::add)
        assertEquals(listOf("", "", "b:current", "a:next", "b:next"), emitted)
        assertEquals(1, coverage?.truncatedChannels)
    }
    @Test fun metadataBoundAppliesOnlyToDistinctMatchingChannels() {
        val filter = guide(listOf(identity("", "news")))
        for (id in 0 until 16384) assertTrue(filter.channel(id.toString(), listOf("News"), ""))
        assertTrue(filter.channel("unrelated", listOf("Other"), ""))
        assertTrue(filter.channel("0", listOf("News"), ""))
        assertFalse(filter.channel("overflow", listOf("News"), ""))
        assertNull(output(filter, 512.0).first)
    }
}
