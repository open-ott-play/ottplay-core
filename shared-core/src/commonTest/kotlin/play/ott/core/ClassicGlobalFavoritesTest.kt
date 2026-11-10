package play.ott.core

import kotlin.test.*

class ClassicGlobalFavoritesTest {
    private fun t(value: String) = ProviderValue.text(value)
    private fun n(value: String) = ProviderValue(ProviderValueKind.NUMBER, value)
    private fun o(vararg fields: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*fields))
    private fun a(vararg values: ProviderValue) = ProviderValue.array(values.toList())
    private fun origin(provider: String = "m3u", profile: String = "Home", alias: String = "Home", subprofile: ProviderValue = ProviderValue.nil) =
        o("provider" to t(provider), "profile" to t(profile), "subprofile" to subprofile, "sourceAlias" to t(alias))
    private fun channel(id: String = "m3u-epg:news") = o("kind" to t("channel"), "channelId" to t(id))
    private fun row(provider: String = "m3u", locator: ProviderValue = channel(), title: String = "News", source: ProviderValue = origin(provider)) =
        o("title" to t(title), "origin" to source, "locator" to locator)
    private fun doc(vararg rows: ProviderValue) = o("version" to n("1"), "entries" to a(*rows))

    @Test fun canonicalIdentityPreservesV1SpellingAndIgnoresTitle() {
        val first = row()
        val expected = "{\"locator\":{\"channelId\":\"m3u-epg:news\",\"kind\":\"channel\"},\"origin\":{\"profile\":\"Home\",\"provider\":\"m3u\",\"sourceAlias\":\"Home\",\"subprofile\":null}}"
        assertEquals(expected, ClassicGlobalFavorites.identity(first))
        assertEquals(expected, ClassicGlobalFavorites.identity(row(title = "Renamed")))
        val normalized = assertNotNull(ClassicGlobalFavorites.normalize(first))
        assertEquals(listOf("locator", "origin", "title"), normalized.properties.keys.toList())
        assertEquals(expected, ClassicGlobalFavorites.identity(normalized))
        assertEquals(listOf("entries", "version"), assertNotNull(ClassicGlobalFavorites.document(doc(first))).properties.keys.toList())
    }

    @Test fun originAndEntryAreClosedStrictShapes() {
        val valid = row()
        assertNull(ClassicGlobalFavorites.normalize(o(*(valid.properties + ("extra" to t("x"))).toList().toTypedArray())))
        assertNull(ClassicGlobalFavorites.normalize(o("title" to t("News"), "origin" to origin(), "locator" to channel(), "__proto__" to t("x"))))
        assertNull(ClassicGlobalFavorites.normalize(row(source = o("provider" to t("m3u"), "profile" to t("Home"), "sourceAlias" to t("Home")))))
        for (provider in listOf("", "M3U", "/m3u", "m3u/", "m3u//a", "m3u\n", "a".repeat(65))) {
            assertNull(ClassicGlobalFavorites.normalize(row(provider)), provider)
        }
        assertNotNull(ClassicGlobalFavorites.normalize(row("bestlist/stalker")))
        assertNull(ClassicGlobalFavorites.normalize(row(source = origin(subprofile = n("0")))))
    }

    @Test fun textUsesClassicUtf16WhitespaceAndSurrogateRules() {
        // The JS backend replaces malformed UTF-16 string literals with '?'.
        // Construct code units at runtime so every target exercises the malformed input.
        val highSurrogate = charArrayOf(0xd800.toChar()).concatToString()
        val lowSurrogate = charArrayOf(0xdc00.toChar()).concatToString()
        assertEquals(0xd800, highSurrogate[0].code)
        assertEquals(0xdc00, lowSurrogate[0].code)
        for (title in listOf("", " News", "News\u00a0", "\ufeffNews", "News\u202f", "A\nB", "A\u0000B", "A\u007fB", "http://x", "x".repeat(1025), highSurrogate, lowSurrogate, highSurrogate + "x")) {
            assertNull(ClassicGlobalFavorites.normalize(row(title = title)))
        }
        for (title in listOf("News", "a\u0085b", "\u0085News", "\u200bNews", "a\ufeffb", "\ud83d\ude00".repeat(512), "A \"quoted\" \\ B")) {
            assertNotNull(ClassicGlobalFavorites.normalize(row(title = title)))
        }
        assertNull(ClassicGlobalFavorites.normalize(row(title = "\ud83d\ude00".repeat(513))))
    }

    @Test fun localPathsAreRawRelativeNamesNotDecodedOrAuthorized() {
        fun local(path: String) = row("local", o("kind" to t("local-media"), "rootAlias" to t("Movies"), "relativePath" to t(path)))
        for (path in listOf("Films/Фильм 1.mkv", "Films/100% real.mp4", "%2e%2e/film", "a/%2F/b", "Films/A:film.mkv")) {
            assertNotNull(ClassicGlobalFavorites.normalize(local(path)), path)
        }
        for (path in listOf("/etc/passwd", "../film", "a/../film", "a//b", "a\\b", "file://secret", "a/./b", "C:film", "C:/film", ".", "..")) {
            assertNull(ClassicGlobalFavorites.normalize(local(path)), path)
        }
    }

    @Test fun locatorKindsKeepTheirProviderSpecificConstraints() {
        val plex = o("kind" to t("plex-media"), "serverId" to t("PMS_1"), "ratingKey" to t("42"))
        assertNotNull(ClassicGlobalFavorites.normalize(row("plex", plex)))
        for (key in listOf("0", "01", "-1", "1\n", "1".repeat(21))) {
            assertNull(ClassicGlobalFavorites.normalize(row("plex", o("kind" to t("plex-media"), "serverId" to t("PMS_1"), "ratingKey" to t(key)))))
        }
        assertNull(ClassicGlobalFavorites.normalize(row("plex", channel())))
        val nested = o("kind" to t("vportal-media"), "idField" to t("episode_id"), "id" to t("part:2"))
        assertNotNull(ClassicGlobalFavorites.normalize(row("m3u", nested)))
        assertNotNull(ClassicGlobalFavorites.normalize(row("vportal", nested)))
        assertNull(ClassicGlobalFavorites.normalize(row("vportal", channel())))
        assertNull(ClassicGlobalFavorites.normalize(row(locator = channel("channel:123"))))
        assertNotNull(ClassicGlobalFavorites.normalize(row(locator = channel("channel:abc"))))
        assertNotNull(ClassicGlobalFavorites.normalize(row(locator = o("kind" to t("channel-name"), "name" to t("News"), "group" to ProviderValue.nil))))
    }

    @Test fun providerIdsPreserveSafeIntegerAndLiteralStringBoundaries() {
        for (number in listOf("0", "-0", "42", "9007199254740991")) {
            assertNotNull(ClassicGlobalFavorites.providerId(n(number)))
        }
        assertEquals("0", ClassicGlobalFavorites.providerId(n("-0")))
        for (number in listOf("-1", "0.5", "NaN", "Infinity", "9007199254740992")) assertNull(ClassicGlobalFavorites.providerId(n(number)))
        for (id in listOf("0", "A:1", "channel:123", "9007199254740992")) assertEquals(id, ClassicGlobalFavorites.providerId(t(id)))
        for (id in listOf("", " x", "x\n", "x/y", "x".repeat(257))) assertNull(ClassicGlobalFavorites.providerId(t(id)))
        assertNull(ClassicGlobalFavorites.providerId(ProviderValue(ProviderValueKind.BOOLEAN, "true")))
    }

    @Test fun documentsRejectDuplicatesAndEnforceIndependentCountAndUtf8Limits() {
        assertNotNull(ClassicGlobalFavorites.document(doc()))
        assertNull(ClassicGlobalFavorites.document(doc(row(), row(title = "Different title"))))
        val distinct = doc(row(), row(source = origin(profile = "Other")))
        assertNotNull(ClassicGlobalFavorites.document(distinct))
        assertNull(ClassicGlobalFavorites.document(o("version" to t("1"), "entries" to a())))
        val rows = (0 until 1001).map { row(locator = channel("m3u-epg:$it")) }
        assertNotNull(ClassicGlobalFavorites.document(doc(*rows.take(1000).toTypedArray())))
        assertNull(ClassicGlobalFavorites.document(doc(*rows.toTypedArray())))
        val oversized = (0 until 400).map { row(locator = channel("m3u-epg:$it"), title = "中".repeat(1024)) }
        assertNull(ClassicGlobalFavorites.document(doc(*oversized.toTypedArray())))
    }

    @Test fun supportedKindsAreSortedUniqueAndNeverGrantPlayback() {
        val local = row("local", o("kind" to t("local-media"), "rootAlias" to t("Movies"), "relativePath" to t("A.mkv")))
        val value = doc(local, row())
        assertEquals(listOf("channel", "local-media"), ClassicGlobalFavorites.requiredLocatorKinds(value))
        assertTrue(ClassicGlobalFavorites.supports(value, a(t("local-media"), t("channel"), t("unknown"))))
        assertFalse(ClassicGlobalFavorites.supports(value, a(t("channel"))))
        assertFalse(ClassicGlobalFavorites.supports(value, a(t("channel"), t("channel"), t("local-media"))))
        assertFalse(ClassicGlobalFavorites.supports(value, ProviderValue.array((0..32).map { t("kind-$it") })))
        assertFalse(ClassicGlobalFavorites.supports(value, a(t("channel"), n("1"))))
    }

    @Test fun originMatchingRequiresExactlyOneExactProfileAndAlias() {
        val value = row()
        assertEquals("missing", ClassicGlobalFavorites.matchOrigin(value, emptyList()).status)
        assertEquals("missing", ClassicGlobalFavorites.matchOrigin(value, listOf(origin(profile = "Other"))).status)
        assertEquals("ambiguous", ClassicGlobalFavorites.matchOrigin(value, listOf(origin(), origin())).status)
        val selected = ClassicGlobalFavorites.matchOrigin(value, listOf(origin(alias = "Other"), origin()))
        assertEquals("selected", selected.status); assertEquals(1, selected.index)
        assertEquals("invalid", ClassicGlobalFavorites.matchOrigin(ProviderValue.nil, listOf(origin())).status)
    }

    @Test fun jsonIdentityEscapesExactlyAndDoesNotNormalizeUnicodeOrPaths() {
        val source = origin(profile = "Room \"A\"\\B", alias = "Cafe\u0301")
        val value = row(source = source)
        assertTrue(ClassicGlobalFavorites.identity(value).contains("Room \\\"A\\\"\\\\B"))
        assertNotEquals(ClassicGlobalFavorites.identity(value), ClassicGlobalFavorites.identity(row(source = origin(profile = "Room \"A\"\\B", alias = "Café"))))
        assertEquals("", ClassicGlobalFavorites.identity(ProviderValue.nil))
    }
}
