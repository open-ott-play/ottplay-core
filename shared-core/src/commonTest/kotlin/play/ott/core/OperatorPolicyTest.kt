package play.ott.core

import kotlin.test.*

class OperatorPolicyTest {
    private fun text(value: String) = ProviderValue.text(value)
    private fun obj(vararg values: Pair<String, ProviderValue>) = ProviderValue.obj(mapOf(*values))
    private fun array(vararg values: ProviderValue) = ProviderValue.array(values.toList())

    @Test fun transportPreservesInterceptionAndOriginalProxyBody() {
        val plan = OperatorPlaylistRequest("https://feed.test/x?q=1", "https://relay.test", true, "classic") { "encoded" }
        assertEquals("https://feed.test/x?q=1", plan.interceptUrl())
        assertEquals("https://feed.test/x?q=1&url=encoded", plan.request()?.url)
        assertEquals(30000, plan.request()?.timeout)
        plan.reject()
        assertTrue(plan.progress())
        assertEquals(OperatorHttpRequest("https://relay.test/m3u/cp.php", "post", "text", 30000, "@https://feed.test/x?q=1"), plan.request())
        plan.reject()
        assertNull(plan.request())
    }

    @Test fun genericRequestsDoNotInterceptOrDeclareDirectTextAndEmptyUrlsDoNotFetch() {
        val generic = OperatorPlaylistRequest("https://feed.test/", "relay", true, "generic") { error("must not encode") }
        assertEquals("", generic.interceptUrl())
        assertEquals("", generic.request()?.dataType)
        assertEquals(15000, generic.request()?.timeout)
        generic.accept()
        assertNull(generic.request())
        assertNull(OperatorPlaylistRequest("", "relay", true, "classic") { error("must not encode") }.request())
    }

    @Test fun itvRetainsTypedIdListWhileObjectKeysUseStringCoercion() {
        val reducer = OperatorCatalogs("itv")
        val number = ProviderValue(ProviderValueKind.NUMBER, "1")
        reducer.accept(obj("channels" to array(
            obj("ch_id" to number, "channel_name" to text("Number"), "cat_name" to text("News")),
            obj("ch_id" to text("1"), "channel_name" to text("String"), "cat_name" to text("Other")))))
        val result = reducer.result()
        assertEquals(2, result["ids"].elements.size)
        assertEquals("String", result["channels"]["1"]["channel_name"].string())
        assertEquals(listOf("News", "Other"), result["groupOrder"].elements.map { it.string() })
    }

    @Test fun clubRetainsAllRowsButOnlyCompactIdMarkersAreListed() {
        assertEquals(listOf("a"), OperatorCatalogs.clubIds("{\"a\":{\"ch_id\":\"a\",\"name\":\"A\"}}"))
        assertTrue(OperatorCatalogs.clubIds("{\"a\": {\"ch_id\": \"a\", \"name\": \"A\"}}").isEmpty())
        val reducer = OperatorCatalogs("ottclub")
        reducer.accept(obj("a" to obj("name" to text("A"), "rec" to text("0"), "group" to text("News")),
            "unlisted" to obj("name" to text("Hidden"))), listOf("a", "absent"))
        val result = reducer.result()
        assertEquals("168", result["channels"]["a"]["rec"].string())
        assertEquals("A", result["channels"]["a"]["channel_name"].string())
        assertEquals("News", result["epg"]["a"].elements.single()["category"]["name"].string())
        assertEquals("Hidden", result["channels"]["unlisted"]["name"].string())
        assertEquals(listOf("a", "absent"), result["ids"].elements.map { it.string() })
    }

    @Test fun shuraRetainsRepeatedIdsAndLastChannelPayload() {
        val reducer = OperatorCatalogs("shura")
        reducer.accept(array(obj("id" to text("a"), "name" to text("First")), obj("id" to text("a"), "name" to text("Last"))))
        assertEquals(listOf("a", "a"), reducer.result()["ids"].elements.map { it.string() })
        assertEquals("Last", reducer.result()["channels"]["a"]["channel_name"].string())
    }

    @Test fun profilesPreserveCredentialBoundariesAndOpaqueUnescapedValues() {
        assertTrue(OperatorProfiles.valid("1ott", "id", "pin"))
        assertFalse(OperatorProfiles.valid("only4", "short"))
        assertTrue(OperatorProfiles.valid("shara-tv", "12345678", "abcdefgh"))
        assertEquals("http://tvfor.pro/g/a/b:p?q/1/playlist.m3u", OperatorProfiles.url("shara-tv", "playlist", obj("login" to text("a/b"), "password" to text("p?q"))))
        assertEquals("", OperatorProfiles.url("kb-team", "playlist", obj("list" to text("9"), "mac" to text("mac"))))
        assertEquals("https://epg.drm-play.com/edem/edem_epg_ico.m3u8", OperatorProfiles.url("edem", "playlist", obj("scheme" to text("https://"), "list" to ProviderValue(ProviderValueKind.NUMBER, "0"))))
    }

    @Test fun tvteamCaptureKeepsFirstRawTokenAndSkipsDune() {
        assertEquals("https://tv.team/pl/11/a%2Fb/playlist.m3u8", OperatorProfiles.capturedTvteamPlaylist("https://player.test/?x=1&token=a%2Fb&token=ignored", false))
        assertEquals("", OperatorProfiles.capturedTvteamPlaylist("https://player.test/?token=&token=later", false))
        assertEquals("", OperatorProfiles.capturedTvteamPlaylist("https://player.test/?token=a", true))
        assertEquals("abc/playlist.m3u8", OperatorProfiles.tvteamPlaylist(" abc "))
        assertEquals("CDN.test:8080", OperatorProfiles.edemHost(" HTTPS://CDN.test:8080/stream "))
    }
}
