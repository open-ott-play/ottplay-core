package play.ott.core

import kotlin.test.*

class OperatorMediaTest {
    private fun t(value: String) = ProviderValue.text(value)
    private fun n(value: Int) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    private fun o(vararg value: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*value))
    private fun a(vararg value: ProviderValue) = ProviderValue.array(value.toList())
    @Test fun nativeFormatHintsPreserveFallbackAndOutOfRangeTemplates() {
        val channel = o("server" to t("af"), "token" to t("token"))
        assertEquals("http://af:80/42/video.m3u8?token=token", OperatorMedia.live("antifriz", "42", channel, o("mode" to n(0), "hls" to n(2))))
        assertEquals("http://af:80/42/undefined?token=token", OperatorMedia.live("antifriz", "42", channel, o("mode" to n(9))))
        assertEquals("https://live/mpegtsundefined", OperatorMedia.live("only4", "42", o("url" to t("https://live/")), o("mode" to n(0))))
    }
    @Test fun edemUsesFirstPlaceholderAndNativeStringReplacementTokens() {
        val channel = o("url" to t("http://localhost/00000000000000/localhost"))
        assertEquals("http://cdn/key/localhost", OperatorMedia.live("edem", "42", channel, o("host" to t("https://cdn/path"), "key" to t("key"))))
        assertEquals("http://localhost/1/localhost", OperatorMedia.live("edem", "42", channel, o("host" to t("$&"))))
        assertEquals("", OperatorMedia.live("edem", "42", channel, o()))
    }
    @Test fun shuraGuideStateFetchesWeekThenArchiveEvenAfterNullWeek() {
        val guide = OperatorGuide("shura")
        assertEquals("week", guide.phase()); guide.accept(ProviderValue.nil, "week", n(0)); guide.complete()
        assertEquals("archive", guide.phase())
        guide.accept(a(o("name" to t("A"), "start_time" to n(10), "duration" to n(5)), o("name" to t("B"), "start_time" to n(20), "duration" to n(5))), "archive", n(0))
        assertEquals(listOf("A"), guide.result().elements.map { it["name"].string() })
        guide.complete(); assertEquals("", guide.phase())
        assertEquals("http://s1.tvshka.net/42/epg/pf.jsonp", OperatorMedia.guideUrl("shura", "42", o("server" to t("1"), "rec" to n(0)), "archive"))
    }
    @Test fun guidePreservesStringAdditionAndPartialMalformedRows() {
        val guide = OperatorGuide("shura", true)
        guide.accept(a(o("start_time" to t("100"), "duration" to n(30))), "current", n(24))
        assertEquals("10030", guide.result().elements.single()["time_to"].string())
        val itv = OperatorGuide("itv")
        assertFailsWith<OperatorCatalogFailure> { itv.accept(o("res" to a(o("title" to t("First")), ProviderValue.nil)), "all", n(0)) }
        assertEquals("First", itv.result().elements.single()["name"].string())
    }
}
