package play.ott.core

import kotlin.test.*

class XtreamTest {
    private fun text(value: String) = ProviderValue.text(value)
    private fun obj(vararg fields: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*fields))
    private fun array(vararg rows: ProviderValue) = ProviderValue.array(rows.toList())
    private fun row(vararg fields: Pair<String, String>) = obj(*fields.map { it.first to text(it.second) }.toTypedArray())
    private val source = XtreamSource("source", "user", "password")
    private val addresses = XtreamAddresses(source, { path, query ->
        "https://xc.test/" + path.joinToString("/") + if (query.isEmpty()) "" else query.joinToString("&", "?") { it.first + "=" + it.second }
    }, { it })
    private val account = obj("user_info" to row("auth" to "1", "status" to "Active"))
    private fun catalog(data: Map<String, ProviderValue>, format: XtreamFormat) = XtreamCatalogs.catalog(
        data, format, source, addresses, { if (it.startsWith("https://")) it else "" }, { it }, { it.joinToString(":") })
    private fun episodes(data: ProviderValue, format: XtreamFormat) = XtreamCatalogs.episodes(
        data, format, source, addresses, XtreamSeriesParent("9", "Drama", "https://xc.test/cover"),
        { if (it.startsWith("https://")) it else "" }, { it }, { it.joinToString(":") })

    @Test fun browserSessionOrdersRequestsAndRequiresAuthentication() {
        val session = XtreamSession(XtreamFormat.BROWSER)
        assertEquals("", session.request!!.action)
        session.accept(account)
        val actions = mutableListOf<String>()
        while (session.request != null) { actions.add(session.request!!.action); session.accept(array()) }
        assertEquals(listOf("get_live_categories", "get_live_streams", "get_vod_categories", "get_vod_streams", "get_series_categories", "get_series"), actions)
        assertEquals("BROWSER_AUTH", assertFailsWith<XtreamFailure> { XtreamSession(XtreamFormat.BROWSER).accept(obj()) }.code)
        val denied = XtreamSession(XtreamFormat.BROWSER); denied.accept(account)
        assertEquals("RESPONSE_AUTH", assertFailsWith<XtreamFailure> { denied.accept(obj("user_info" to row("auth" to "0"))) }.code)
        assertFalse(denied.reject(404))
    }

    @Test fun nativeSessionRetainsEmbeddedLiveAndOptionalSectionPolicy() {
        val load = XtreamLoad(source, addresses, { it }, { it.joinToString(":") })
        val session = load.session
        session.accept(obj("live_streams" to array(row("stream_id" to "live-id")), "server_info" to row("timezone" to "Europe/Berlin")))
        assertEquals("get_vod_streams", session.request!!.action)
        assertFalse(session.reject(401)); assertFalse(session.reject(403)); assertFalse(session.reject(500))
        assertTrue(session.reject(404))
        assertEquals("get_series", session.request!!.action)
        session.accept(array(row("series_id" to "9")))
        assertTrue(session.reject(501))
        assertNull(session.request)
        assertEquals(listOf("live-id", "9"), load.catalog().entries.map { it.providerId })
        assertEquals(listOf(XtreamNotice("SECTION", "MOVIE", 404), XtreamNotice("GROUPS", "SERIES", 501)), session.notices)
        assertEquals("Europe/Berlin", session.timezone)
    }

    @Test fun nativeLiveIsMandatoryAndCategoriesMayBeUnavailable() {
        val session = XtreamSession(XtreamFormat.ANDROID)
        session.accept(obj())
        assertEquals("get_live_streams", session.request!!.action)
        assertFalse(session.reject(404)); assertFalse(session.reject(405)); assertFalse(session.reject(501))
        session.accept(array())
        assertTrue(session.reject(405))
        assertEquals("get_vod_streams", session.request!!.action)
        assertEquals("AUTH", assertFailsWith<XtreamFailure> {
            XtreamSession(XtreamFormat.ANDROID).accept(obj("user_info" to row("auth" to "false")))
        }.code)
        assertEquals("INACTIVE", assertFailsWith<XtreamFailure> {
            XtreamSession(XtreamFormat.ANDROID).accept(obj("user_info" to row("status" to "Expired")))
        }.code)
    }

    @Test fun nativeLimitStopsBeforeTheNextSectionEvenForDuplicateIds() {
        val load = XtreamLoad(source, addresses, { it }, { it.joinToString(":") })
        load.session.accept(obj())
        load.session.accept(ProviderValue.array(List(100_001) { row("stream_id" to "1") }))
        assertEquals("CATALOG_LIMIT", assertFailsWith<XtreamFailure> { load.session.accept(array()) }.code)
        assertEquals("get_live_categories", load.session.request!!.action)
    }

    @Test fun nativeLimitIncludesEarlierSections() {
        val load = XtreamLoad(source, addresses, { it }, { it.joinToString(":") })
        load.session.accept(obj("live_streams" to ProviderValue.array(List(100_000) { row("stream_id" to "1") })))
        load.session.accept(array(row("stream_id" to "2")))
        assertEquals("CATALOG_LIMIT", assertFailsWith<XtreamFailure> { load.session.accept(array()) }.code)
        assertEquals("get_vod_categories", load.session.request!!.action)
    }

    @Test fun browserAndNativeRetainIdentityExtensionAndArchiveDifferences() {
        val data = mapOf(
            "get_live_categories" to array(row("category_id" to "__proto__", "category_name" to "__proto__")),
            "get_live_streams" to array(row("stream_id" to "01", "category_id" to "__proto__", "name" to "  News  ", "tv_archive" to "true", "tv_archive_duration" to "7")),
            "get_vod_streams" to array(row("stream_id" to "4", "container_extension" to "bad/ext"), row("stream_id" to "4", "container_extension" to "mp4")))
        val browser = catalog(data, XtreamFormat.BROWSER)
        assertEquals(1, browser.entries.size)
        assertEquals("source:xtream:live:01", browser.entries.single().id)
        assertEquals("News", browser.entries.single().name)
        assertEquals("__proto__", browser.entries.single().group)
        assertNull(browser.entries.single().archiveDays)
        assertEquals(listOf("Ignored VOD without a valid container extension"), browser.warnings)
        val native = catalog(data, XtreamFormat.ANDROID)
        assertEquals(2, native.entries.size)
        assertEquals("source:live:01", native.entries[0].id)
        assertEquals("  News  ", native.entries[0].name)
        assertEquals(7.0, native.entries[0].archiveDays)
        assertEquals("https://xc.test/timeshift/user/password/{durationMinutes}/{startDate}/01.ts", native.entries[0].archiveSource)
        assertEquals("https://xc.test/movie/user/password/4.mp4", native.entries[1].url)
        assertEquals("vod", native.entries[1].generatedName)
    }

    @Test fun invalidNonblankDirectUrlRetainsNativeEmptyResult() {
        val data = mapOf("get_live_streams" to array(row("stream_id" to "1", "direct_source" to "javascript:alert(1)")))
        assertEquals("", catalog(data, XtreamFormat.ANDROID).entries.single().url)
        assertEquals("https://xc.test/live/user/password/1.m3u8", catalog(data, XtreamFormat.BROWSER).entries.single().url)
    }

    @Test fun browserEpisodeWarningsPrecedeRowWarningsAndNamesStayStable() {
        val data = obj("seasons" to array(row("season_number" to "2", "name" to " Second ")), "episodes" to obj(
            "2" to array(row("id" to "5", "episode_num" to "2", "container_extension" to "mp4"), row("id" to "bad"), row("id" to "4", "episode_num" to "1", "container_extension" to "mp4")),
            "broken" to ProviderValue.nil, "1" to array(row("id" to "5", "container_extension" to "mp4"))))
        val result = episodes(data, XtreamFormat.BROWSER)
        assertEquals(listOf("4", "5"), result.entries.map { it.providerId })
        assertEquals(listOf("Ignored an invalid episode group", "Ignored an episode without a numeric identity or season"), result.warnings)
        val folders = XtreamCatalogs.seasons(result, source, XtreamSeriesParent("9", "Drama"), { it })
        assertEquals("source:xtream:series:9:season:2", folders.single().id)
        assertEquals("Second", folders.single().name)
    }

    @Test fun nativeEpisodeFallbackIdentityAndSorting() {
        val result = episodes(obj("episodes" to array(row("stream_id" to "b", "season" to "2", "episode_num" to "3"), row("id" to "a", "season" to "1", "episode_num" to "4"), row("id" to "a", "season" to "0"))), XtreamFormat.ANDROID)
        assertEquals(listOf("a", "b"), result.entries.map { it.providerId })
        assertEquals("Episode 4", result.entries[0].name)
        assertEquals("https://xc.test/cover", result.entries[0].logo)
        assertEquals("https://xc.test/series/user/password/a.mp4", result.entries[0].url)
    }

    @Test fun seriesRequestRejectsInvalidNavigationBeforeTransport() {
        assertEquals("FOLDER", assertFailsWith<XtreamFailure> { XtreamCatalogs.seriesRequest(text("2"), "movie", XtreamFormat.BROWSER) }.code)
        assertEquals("FOLDER", assertFailsWith<XtreamFailure> { XtreamCatalogs.seriesRequest(text("../2"), "series", XtreamFormat.BROWSER) }.code)
        assertEquals("SERIES_ID", assertFailsWith<XtreamFailure> { XtreamCatalogs.seriesRequest(text(" "), "", XtreamFormat.ANDROID) }.code)
        assertEquals(mapOf("series_id" to "02"), XtreamCatalogs.seriesRequest(text("02"), "season", XtreamFormat.BROWSER).params)
    }

    @Test fun legacyCatalogPreservesHashIdentityAndRepeatedGroupMembership() {
        val data = mapOf("get_live_categories" to array(row("category_id" to "1", "category_name" to "News")),
            "get_live_streams" to array(row("name" to "A", "stream_id" to "1", "category_id" to "1"), row("name" to "A", "stream_id" to "2", "category_id" to "1"), row("name" to "zero", "stream_id" to "3")))
        val result = LegacyXtream.catalog(data, addresses) { if (it.string() == "zero") 0.0 else 42.0 }
        assertEquals(listOf(42.0, 0.0), result.entries.map { it.id })
        assertEquals(listOf(42.0, 42.0), result.groups["News"])
        assertEquals("1", result.entries[0].providerId)
        assertEquals(1, result.entries[1].category)
        assertEquals("https://xc.test/live/user/password/1.m3u8", result.entries[0].url)
    }

    @Test fun legacyGuideUsesHostDateAndFiltersInvalidEntries() {
        val result = LegacyXtream.guide(obj("epg_listings" to array(row("start" to "10", "end" to "20"), row("start" to "bad", "end" to "40")))) { it.number() }
        assertEquals(1, result!!.size)
        assertEquals("No title", result[0].name.string())
        assertEquals(10.0, result[0].start)
        assertNull(LegacyXtream.guide(obj()) { 0.0 })
    }

    @Test fun baseRoutesRetainEndpointAndCredentialOrdering() {
        assertEquals("https://xc.test/folder", XtreamAddresses.browserBase("https://xc.test/folder/PLAYER_API.PHP/?old=1#x"))
        assertEquals("https://xc.test/player_api.php", XtreamAddresses.browserBase("https://xc.test/player_api.php//"))
        assertEquals(listOf("folder", "PLAYER_API.PHP"), XtreamAddresses.nativeBaseSegments(listOf("", "folder", "PLAYER_API.PHP", "")))
        assertEquals("https://xc.test/player_api.php?username=user&password=password&action=get_series_info&series_id=02", addresses.api(XtreamRequest("get_series_info", mapOf("series_id" to "02"))))
        assertEquals("https://xc.test/xmltv.php?username=user&password=password", addresses.epg())
        assertFalse(source.toString().contains("password"))
    }

    @Test fun wireCoercionsMatchBrowserNumbersWithoutLosingNativeText() {
        assertEquals("", ProviderValue.nil.primitive())
        assertEquals("null", ProviderValue.nil.string())
        assertEquals(0.0, ProviderValue.nil.number())
        assertTrue(ProviderValue.missing.number().isNaN())
        assertEquals("2,,4", array(text("2"), ProviderValue.nil, text("4")).string())
        assertTrue(array(text("2")).numericId())
        assertEquals(16.0, text("0x10").number())
        assertEquals(100.0, text("1e2").number())
        assertTrue(text("1f").number().isNaN())
        assertEquals(0.0, text("Infinity").positive())
        assertFalse(text("true").flag())
        assertTrue(ProviderValue(ProviderValueKind.BOOLEAN, "true").flag())
    }
    @Test fun wirePrimitiveKindsAndSignedExponentBoundariesRemainDistinct() {
        for (kind in ProviderValueKind.entries) {
            val expected = when (kind) {
                ProviderValueKind.TEXT, ProviderValueKind.NUMBER, ProviderValueKind.BOOLEAN -> "payload"
                else -> ""
            }
            assertEquals(expected, ProviderValue(kind, "payload").primitive())
        }
        for ((input, expected) in listOf("+1" to 1.0, "-1" to -1.0, "+.5" to 0.5, "1e+2" to 100.0,
            "1E-2" to 0.01, ".1e1" to 1.0, "-0e+0" to -0.0)) {
            assertEquals(expected, text(input).number(), input)
        }
        for (input in listOf("+", "-", ".", "1e", "1E+", "1e-", "e1", "1e+-2", "1e2x")) {
            assertTrue(text(input).number().isNaN(), input)
        }
    }
}
