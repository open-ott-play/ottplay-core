package play.ott.core

import kotlin.test.*

class DurableStateTest {
    private fun t(value: String) = ProviderValue.text(value)
    private fun n(value: Number) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    private fun b(value: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, value.toString())
    private fun obj(vararg fields: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*fields))
    private fun array(vararg values: ProviderValue) = ProviderValue.array(values.toList())
    private fun defaults() = BrowserDurableState.defaults(ParentalState.defaults())
    private fun validate(value: ProviderValue) = BrowserDurableState.validate(value, ParentalState::defaults, ParentalState::validate, { it })
    @Test fun resumeCapacityAndEqualityPreserveOrder() {
        val old = (0 until 500).associate { "film-$it" to it.toLong() }
        assertSame(old, DurableSelections.saveResume(old, "film-0", -10))
        val next = DurableSelections.saveResume(old, "new", 999)
        assertEquals(500, next.size); assertFalse("film-0" in next); assertEquals("new", next.keys.last())
        val changed = DurableSelections.saveResume(old, "film-0", 99)
        assertEquals("film-0", changed.keys.last()); assertEquals(500, changed.size)
    }
    @Test fun nativeBackupRejectsBeforeMergingAndPreservesSelectionFallback() {
        assertFailsWith<IllegalArgumentException> { DurableSelections.validateBackup("bad\nsource", emptySet(), emptyMap()) }
        assertFailsWith<IllegalArgumentException> { DurableSelections.validateBackup(null, emptySet(), mapOf("movie" to -1)) }
        assertEquals("current", DurableSelections.selectedSource("missing", "current", setOf("current")))
        assertEquals(listOf("b", "c", "a"), DurableSelections.mergeResume(linkedMapOf("a" to 1, "b" to 2), linkedMapOf("c" to 3, "a" to 4)).keys.toList())
    }
    @Test fun favoritesProfilesKeepDefaultAndAliasingDecisionsDistinct() {
        val browser = FavoriteLists.change(FavoriteListProfile.BROWSER, "rename", "default", "New", true, false, 2, true, 0, listOf(true, true))
        assertEquals("copy", browser.write); assertTrue(browser.clearOld); assertFalse(browser.eraseOld)
        val classic = FavoriteLists.change(FavoriteListProfile.CLASSIC, "rename", "default", "New", true, false, 2, true, 0, listOf(true, true))
        assertEquals("alias", classic.write); assertTrue(classic.eraseOld); assertTrue(classic.synchronize)
        assertFalse(FavoriteLists.change(FavoriteListProfile.CLASSIC, "delete", "Only", "", true, false, 1, true, 0, listOf(true)).accepted)
    }
    @Test fun validationRetainsSafeRecordsAndRejectsConflictingSourceOwner() {
        val value = obj(*(defaults().properties + mapOf("sources" to array(obj("id" to t("one"), "type" to t("m3u"), "url" to t("https://a")), obj("id" to t("two"), "type" to t("m3u"), "url" to t("https://b"))),
            "lastChannel" to obj("sourceId" to t("one"), "id" to t("two:channel")), "bookmarks" to obj("one:film" to n(5), "negative" to n(-1)),
            "favorites" to obj("default" to array(t("one:channel"), t("one:channel"))))).toList().toTypedArray())
        val result = validate(value)
        assertEquals(ProviderValueKind.NULL, result["lastChannel"].kind)
        assertEquals(setOf("one:film"), result["bookmarks"].properties.keys)
        assertEquals(1, result["favorites"]["default"].elements.size)
    }
    @Test fun removedSourcesPurgeOpaqueOwnedIdsWithoutTouchingOtherSelections() {
        val previous = obj("sources" to array(obj("id" to t("one"))), "channelReferences" to array(obj("sourceId" to t("one"), "id" to t("opaque"))))
        val next = obj("sources" to array(), "favorites" to obj("default" to array(t("one:1"), t("opaque"), t("two:1"))), "security" to obj("protectedIds" to array(t("opaque"), t("two:1"))))
        val result = BrowserDurableState.removeSources(previous, next) { it }
        assertEquals(listOf("two:1"), result["favorites"]["default"].elements.map { it.scalar })
        assertEquals(listOf("two:1"), result["security"]["protectedIds"].elements.map { it.scalar })
    }
    @Test fun securitySessionRevokesForClockSourceAndIdentityChanges() {
        val session = ParentalSession(); session.observe("first", "a"); session.clock(1000.0); session.grant(1000.0, 5.0)
        assertEquals(301000.0, session.expires(1000.0)); session.observe("first", "b"); assertEquals(0.0, session.expires(1000.0))
        session.grant(1000.0, 5.0); assertEquals(1000.0, session.clock(Double.NaN)); assertEquals(0.0, session.expires(1000.0))
        session.grant(1000.0, 5.0); session.clock(999.0); assertEquals(0.0, session.expires(999.0))
    }
    @Test fun persistentLockoutStartsAtFiveAndCapsAtFiveMinutes() {
        assertEquals(0.0, ParentalState.failedBlock(4.0, 0.0, 1000.0))
        assertEquals(31000.0, ParentalState.failedBlock(5.0, 0.0, 1000.0))
        assertEquals(301000.0, ParentalState.failedBlock(30.0, 0.0, 1000.0))
        assertEquals(301000.0, ParentalState.blockedUntil(1e15, 1000.0))
        assertEquals(1.0, ParentalState.retryAfter(1001.0, 1000.0))
    }
    @Test fun scopeAndCredentialValidationFailClosed() {
        val enabled = obj(*(ParentalState.defaults().properties + mapOf("enabled" to b(true), "salt" to t("public-test-salt-1234"), "hash" to t("A".repeat(64)), "protectedIds" to array(t("adult"), t("adult")), "scopes" to obj("settings" to b(false)))).toList().toTypedArray())
        val result = ParentalState.validate(enabled)
        assertTrue(ParentalState.validate(obj(*(enabled.properties + ("iterations" to n(Double.NaN))).toList().toTypedArray()))["iterations"].number().isNaN())
        assertEquals("a".repeat(64), result["hash"].scalar); assertEquals(1, result["protectedIds"].elements.size)
        assertTrue(ParentalState.protected(result, t("adult"), t("play"))); assertFalse(ParentalState.protected(result, t("adult"), t("settings")))
        assertTrue(ParentalState.protected(result, t("free"), t("unknown")))
        assertFailsWith<DurableStateFailure> { ParentalState.validate(obj(*(enabled.properties + ("iterations" to n(1e9))).toList().toTypedArray())) }
    }
    @Test fun nativeImporterPreservesPortalDialectAndTypedMessages() {
        val root = obj("M3Us" to array(obj("www" to t("https://a"), "rechours" to t("24"))), "stalker_data" to obj("portal" to t("https://p/"), "mac" to t("00:1A:79:01:02:03")))
        val result = LegacySettingsImport.native(root, { ProviderValue.nil }, { it.takeIf { it.startsWith("https://") } }, { "/" })
        assertEquals(listOf("M3U", "STALKER"), result.sources.map { it.type }); assertEquals(1.0, result.sources[0].days)
        assertEquals("https://p/stalker_portal/api/", result.sources[1].url)
        assertEquals("00:1a:79:01:02:03", result.sources[1].identity.last())
    }
    @Test fun classicBackupRetainsInstallationAuthorityAndDisconnectsRemote() {
        val current = obj("commandServerToken" to t("local"), "commandServerEnabled" to n(1), "sLocalHttpEnabled" to n(1))
        val retained = ClassicDurableState.installation(current, true)
        assertEquals("local", retained["commandServerToken"].scalar); assertEquals("0", retained["commandServerEnabled"].scalar); assertEquals("1", retained["sLocalHttpEnabled"].scalar)
        assertFalse(ClassicDurableState.portableKey("stb_settings_backup", true)); assertTrue(ClassicDurableState.portableKey("m3u:m3uArr", true))
        assertFalse(ClassicDurableState.validEnvelope(t("1"), obj()))
    }
    @Test fun restorationDoesNotSelectAmbiguousOrDifferentSourceChannels() {
        val restoration = ChannelRestoration({ it }, { it }, { a, b -> a.string() == b.string() })
        val ref = obj("sourceId" to t("source"), "id" to t("old"), "name" to t("News HD"))
        val item = obj("sourceId" to t("source"), "id" to t("new"), "kind" to t("live"), "name" to t(" News  HD "))
        assertEquals(0, restoration.restore(listOf(item), ref)); assertEquals(-1, restoration.restore(listOf(item, item), ref))
        assertEquals(-1, restoration.restore(listOf(obj(*(item.properties + ("sourceId" to t("other"))).toList().toTypedArray())), ref))
    }
    @Test fun remindersAndPerChannelChoicesRetainBoundedNewestEntries() {
        val channel = obj("id" to t("channel")); val programme = obj("title" to t("Title"), "start" to n(1), "end" to n(2))
        val first = LibraryState.toggleReminder(array(), channel, programme); assertEquals(1, first.elements.size)
        assertTrue(LibraryState.toggleReminder(first, channel, programme).elements.isEmpty())
        val active = obj("sourceId" to t("one"), "id" to t("new")); val previous = obj("sourceId" to t("one"), "id" to t("old"))
        val saved = LibraryState.savePreference(array(obj("reference" to previous)), LibraryState.preferenceEntry(active, ProviderValue.nil, "zoom", n(1.25)), previous)
        assertEquals(1, saved.elements.size); assertEquals("new", saved.elements[0]["reference"]["id"].scalar)
    }
}
