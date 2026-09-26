package play.ott.core

import kotlin.test.*

class GuideFeedTest {
    private fun raw(id: String, start: String, stop: String = "", title: String = "Title") =
        GuideRawProgramme(id, start, stop, title, " Text ", "", "fallback")
    private fun feed(identity: String, title: String, records: List<GuideRecord> = emptyList()) =
        GuideFeedInput(identity, identity, listOf(GuideStation("1", mutableListOf(title))), listOf("1"), records, GuideCoverage(), emptyList())

    @Test fun stopInferenceSkipsEqualStartsAndKeepsFirstDuplicatePayload() {
        val result = GuideFeeds.parse(emptyList(), listOf(raw("1", "202601010000", title = "B"), raw("1", "202601010000", title = "A"),
            raw("1", "202601010100", "202601010200"), raw("1", "202601010000", "202601010100", "A")), { it })
        assertEquals(listOf("A", "B", "Title"), result.catalog.programmes.map { it.title })
        assertEquals(1, result.catalog.programmes.first().slot)
        assertEquals(3600.0, result.catalog.programmes.first().end!! - result.catalog.programmes.first().start)
    }
    @Test fun invalidTimesAndUnknownFinalStopRemainDistinctWarnings() {
        val result = GuideFeeds.parse(emptyList(), listOf(raw("1", "bad"), raw("1", "202601010000", " "), raw("1", "202601010100")), { it })
        assertEquals(listOf("Ignored a programme with invalid channel or time", "Ignored a programme with invalid channel or time",
            "Ignored a programme without a known end time"), result.warnings)
        assertTrue(result.catalog.programmes.isEmpty())
    }
    @Test fun duplicateMetadataKeepsFirstUsableIconAndAllNames() {
        val parsed = GuideFeeds.parse(listOf(GuideRawStation(" 1 ", listOf(" News HD ", "News HD"), listOf("bad", "https://a")),
            GuideRawStation("1", listOf("News UHD"), listOf("https://b"))), emptyList(), { if(it.startsWith("https")) it else "" }).catalog
        assertEquals("https://a", parsed.channels.single().logo)
        assertEquals(listOf("News HD", "News UHD"), parsed.channels.single().names)
        assertEquals(listOf("1"), parsed.byAlias["news"]?.toList())
    }
    @Test fun independentFeedIdsNeverMergeAndRepeatedFragmentsDo() {
        val row = GuideRecord("1", 0.0, 10.0, "Show", 0)
        val first = feed("a", "Alpha", listOf(row))
        val result = GuideFeeds.merge(listOf(first, first, feed("b", "Beta", listOf(row.copy(slot=1)))), { f,id -> "$f/$id" }, { it })
        assertEquals(listOf("a/1", "b/1"), result.rawIds["1"])
        assertFalse("1" in result.catalog.byChannel)
        assertEquals(2, result.catalog.programmes.size)
        assertEquals(2, result.feeds.size)
    }
    @Test fun unambiguousAliasesShareTheExactScheduleAndMetadata() {
        val result = GuideFeeds.merge(listOf(feed("a", "Alpha")), { f,id -> "$f/$id" }, { it })
        assertSame(result.catalog.byChannel["a/1"], result.catalog.byChannel["1"])
        assertSame(result.catalog.byId["a/1"], result.catalog.byId["1"])
    }
    @Test fun programmeOnlyFeedsGainMetadataWithoutLosingRows() {
        val programme = GuideRecord("1", 1.0, 2.0, "Show", 0)
        val source = GuideFeedInput("a", "a", emptyList(), listOf("1"), listOf(programme), GuideCoverage(), emptyList())
        val result = GuideFeeds.merge(listOf(source, feed("a", "Name")), { f,id -> "$f/$id" }, { it })
        assertEquals("Name", result.catalog.byId.getValue("1").names.single())
        assertSame(programme, result.catalog.byChannel.getValue("1").single())
    }
    @Test fun publicMapOrderingIsPortableIncludingArrayIndexBoundaries() {
        assertEquals(listOf("0","2","10","4294967294","01","a","4294967295","-1"),
            GuideFeeds.keyOrder(listOf("01","10","a","2","4294967295","4294967294","-1","0")))
    }
    @Test fun publicMapOrderingRejectsNonCanonicalIndicesAndRetainsNamedOrder() {
        val named = listOf("", "00", "01", "+1", "-0", "-1", "1.0", "1e2", " 1", "1 ", "\u0661", "4294967295", "99999999999")
        val keys = named.take(4) + listOf("100", "4294967294", "9", "10", "0", "2", "2") + named.drop(4)
        assertEquals(listOf("0", "2", "2", "9", "10", "100", "4294967294") + named, GuideFeeds.keyOrder(keys))
        assertEquals(emptyList(), GuideFeeds.keyOrder(emptyList()))
    }
    @Test fun coverageRejectsLooseNumbersAndKeepsWindowEnvelope() {
        val invalid = GuideCoverage.parse(mapOf("data-window-start" to "0x10", "data-window-end" to "20", "data-programme-limit" to "1.5"))
        assertEquals(GuideCoverage(), invalid)
        val first = GuideCoverage.parse(mapOf("data-window-start" to "-1", "data-window-end" to "20", "data-truncated-channels" to "49999", "data-programme-limit" to "9"))
        val combined = first.merge(GuideCoverage(false, 0.0, 30.0, 3, 2))
        assertEquals(GuideCoverage(true, -1.0, 30.0, 3, 50000), combined)
        assertEquals(49999, first.truncatedChannels)
    }
    @Test fun declaredFeedPreferenceWinsEvenForEmptySchedules() {
        val selected = GuideFeeds.chooseFeed(listOf("b","a"), 2, { if(it==0) "a" else "b" },
            { _,_->"1" }, { index,id->"$index/$id" })
        assertEquals("1/1", selected)
        var namesOnly = false
        GuideFeeds.chooseFeed(listOf("unknown"), 1, { "a" }, { index,names -> assertEquals(-1,index);namesOnly=names;null }, { _,id->id })
        assertTrue(namesOnly)
    }
    @Test fun loneStaleNameCandidateCannotHideAnotherExactName() {
        val selected = GuideFeeds.choose("", listOf("Alpha", "Beta"), false, { emptyList() },
            { _,name -> listOf(if(name=="alpha") "missing" else "valid") }, { it=="valid" })
        assertEquals("valid", selected)
    }
    @Test fun browserAndLegacySelectionHaveExplicitEndAndOverlapContracts() {
        val starts = listOf(0.0,5.0,10.0); val ends=listOf(10.0,15.0,20.0)
        assertEquals(0, LegacyGuideSchedule.select(3,starts::get,ends::get,10.0,0.0).current)
        assertEquals(2, GuideSchedule.select(3,starts::get,ends::get,10.0).current)
        assertEquals(listOf(1), LegacyGuideSchedule.select(3,starts::get,ends::get,10.0,0.0).following)
    }
    @Test fun legacyMissingProgrammeRetainsOneHourRetryAndSliceSemantics() {
        assertEquals(3621.0, LegacyGuideSchedule.select(1,{0.0},{20.0},21.0,0.0).retryAt)
        assertTrue(LegacyGuideSchedule.select(2,{it.toDouble()},{10.0},0.0,-1.0).following.isEmpty())
        assertEquals(listOf(1,2), LegacyGuideSchedule.select(3,{it.toDouble()},{10.0},0.0,Double.POSITIVE_INFINITY).following)
    }
    @Test fun responseCacheKeepsInclusiveStopAndExactTtlBoundary() {
        assertEquals(1,GuideResponseCache.read(2.0,1,0.0,{20.0},{20000.0}))
        assertEquals(-1,GuideResponseCache.read(2.0,1,0.0,{20.0},{20001.0}))
        assertEquals(-1,GuideResponseCache.read(2.0,1,0.0,{100000.0},{43200000.0}))
        assertEquals(0,GuideResponseCache.read(0.0,1,0.0,{error("disabled")},{error("disabled")}))
        assertEquals(listOf(2,1) to listOf(3),GuideResponseCache.touch(listOf(1,2,3),2,2.0))
    }
    @Test fun protectedLookupCacheBoundsCopiesWithoutEvictingStableWorkingSet() {
        val cache=GuideLookupCache<String,String>(4.0,3.0)
        cache.put("a","A",1);cache.put("b","B",1);cache.put("c","C",1);cache.put("overflow","X",1)
        assertNull(cache.get("overflow"));assertEquals("A",cache.get("a"))
        cache.put("free","F",0);cache.put("rotate","R",0)
        assertNull(cache.get("free"));assertEquals("R",cache.get("rotate"));assertEquals("A",cache.get("a"))
        cache.clear();assertNull(cache.get("a"));cache.put("large","L",3);assertEquals("L",cache.get("large"))
    }
    @Test fun scheduleMemoReusesIntervalsAndHandlesReverseClocks() {
        var reads=0
        val memo=GuideScheduleMemo()
        fun select(now:Double)=memo.select(1,{reads++;10.0},{20.0},now)
        assertEquals(0,select(11.0).current);val before=reads
        assertEquals(0,select(19.0).current);assertEquals(before,reads)
        assertEquals(-1,select(9.0).current);assertTrue(reads>before)
        assertEquals(-1,select(Double.NaN).current)
    }
    @Test fun shiftsAndAndroidDuplicatePolicyPreserveClientContracts() {
        assertEquals(19800.0,GuideProgrammeRules.browserShift(5.5));assertEquals(0.0,GuideProgrammeRules.browserShift(25.0))
        assertFalse(GuideProgrammeRules.legacyShift(3600.0,0.0,1.0));assertTrue(GuideProgrammeRules.legacyShift(Double.POSITIVE_INFINITY,1.0,2.0))
        assertFalse(GuideProgrammeRules.validAndroid("id",1,1))
        val ids=listOf("b","a","b","a");val starts=listOf(2L,1L,2L,0L)
        assertEquals(listOf(3,1,0),GuideProgrammeRules.androidOrder(4,ids::get,starts::get,{10L}))
    }
}
