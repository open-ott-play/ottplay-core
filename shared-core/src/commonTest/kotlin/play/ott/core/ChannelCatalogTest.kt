package play.ott.core

import kotlin.test.*

class ChannelCatalogTest {
    private fun row(vararg pairs: Pair<String, String>) = ProviderValue.obj(pairs.associate { it.first to ProviderValue.text(it.second) })
    @Test fun xtreamLabelsNeverDetermineIdentityOrDeduplication() {
        val addresses = XtreamAddresses(XtreamSource("account", "viewer", "password"), { path, _ -> "https://portal.test/" + path.joinToString("/") }, { it })
        fun catalog(group: String, title: String) = ChannelCatalog.xtream(mapOf(
            "get_live_categories" to ProviderValue.array(listOf(row("category_id" to "7", "category_name" to group))),
            "get_live_streams" to ProviderValue.array(listOf(
                row("stream_id" to "42", "name" to title, "category_id" to "7"),
                row("stream_id" to "43", "name" to title, "category_id" to "7"),
                row("name" to "Missing ID"),
                ProviderValue.obj(mapOf("name" to ProviderValue.text("Null ID"), "stream_id" to ProviderValue.nil)),
                row("stream_id" to "42", "name" to "Repeated provider row")
            ))
        ), addresses)
        val before = catalog("News", "Same name")
        val after = catalog("Actualités", "Renamed")
        assertEquals(listOf("xtream:stream:42", "xtream:stream:43"), after.map { it.itemId })
        assertEquals(before.map { it.itemId }, after.map { it.itemId })
        assertEquals(before.map { it.groupId }, after.map { it.groupId })
        assertEquals("Actualités", after[0].groupName)
        assertEquals("https://portal.test/live/viewer/password/42.m3u8", after[0].url)
    }
    @Test fun stalkerIdentitySurvivesDisplayChangesAndGroupOrder() {
        fun catalog(name: String, group: String) = ChannelCatalog.stalker(ProviderValue.array(listOf(
            row("id" to "42", "name" to name, "genre_id" to "7", "genre" to group),
            row("id" to "43", "name" to name, "genre_id" to "8", "genre" to "Films")
        )), "https://portal.test", "AA:BB")
        val old = catalog("News", "English")
        val current = catalog("Actualités", "Français")
        assertEquals(2, current.size)
        assertEquals(old.map { it.itemId }, current.map { it.itemId })
        assertEquals(old.map { it.groupId }, current.map { it.groupId })
        assertEquals("Actualités", current[0].name)
        assertEquals("https://portal.test/stalker_portal/stream/42.m3u8?mac=AA:BB", current[0].url)
    }
    @Test fun missingIdentityIsNotFabricatedFromDisplayName() {
        val result = ChannelCatalog.stalker(ProviderValue.array(listOf(row("name" to "Anonymous"),
            row("name" to "By URL", "url" to "https://stream.test/live"))), "https://portal.test", "MAC")
        assertEquals(1, result.size)
        assertEquals("stalker:channel:https://stream.test/live", result[0].itemId)
    }

    @Test fun xtreamMigrationKeepsOriginalStringBeforeDisplayFallback() {
        val addresses = XtreamAddresses(XtreamSource("account", "viewer", "password"), { path, _ -> "https://portal.test/" + path.joinToString("/") }, { it })
        val rows = listOf(
            row("stream_id" to "1", "name" to ""),
            row("stream_id" to "2", "name" to "News"),
            row("stream_id" to "3"),
            ProviderValue.obj(mapOf("stream_id" to ProviderValue.text("4"), "name" to ProviderValue(ProviderValueKind.NUMBER, "42"))),
            ProviderValue.obj(mapOf("stream_id" to ProviderValue.text("5"), "name" to ProviderValue.nil))
        )
        val catalog = ChannelCatalog.xtream(mapOf("get_live_streams" to ProviderValue.array(rows)), addresses)
        assertEquals(listOf("1", "News", "3", "42", "5"), catalog.map { it.name })
        assertEquals(listOf(LegacyChannelReference.Label(""), LegacyChannelReference.Label("News"), null, null, null), catalog.map { it.legacyReference })
        assertEquals(listOf("1", "2", "3", "4", "5").map { "xtream:stream:$it" }, catalog.map { it.itemId })
        val session = OperatorChannelSession("https://portal.test", addresses)
        session.accept(ProviderValue.obj(mapOf("live_streams" to ProviderValue.array(rows))))
        assertEquals(catalog, session.catalog(), "combined-account catalogs retain the same explicit migration metadata")
    }

    @Test fun stalkerMigrationUsesOriginalIdSelectionNotProviderIdFallback() {
        val catalog = ChannelCatalog.stalker(ProviderValue.array(listOf(
            row("id" to "42", "ch_id" to "142", "name" to "Original ID"),
            row("ch_id" to "43", "name" to "Only ch_id"),
            row("id" to "invalid", "ch_id" to "44", "name" to "Invalid old ID"),
            row("ch_id" to "45", "name" to ""),
            ProviderValue.obj(mapOf("id" to ProviderValue(ProviderValueKind.NUMBER, "0"), "ch_id" to ProviderValue.text("46"), "name" to ProviderValue.text("Zero old ID"))),
            ProviderValue.obj(mapOf("ch_id" to ProviderValue.text("47"), "name" to ProviderValue(ProviderValueKind.NUMBER, "47"))),
            ProviderValue.obj(mapOf("id" to ProviderValue.text("48"), "name" to ProviderValue(ProviderValueKind.NUMBER, "48")))
        )), "https://portal.test", "MAC")
        assertEquals(listOf("42", "43", "invalid", "45", "46", "47", "48"), catalog.map { it.providerId })
        assertEquals(listOf(LegacyChannelReference.NumericId(42.0), LegacyChannelReference.Label("Only ch_id"), null, null, LegacyChannelReference.Label("Zero old ID"), null, LegacyChannelReference.NumericId(48.0)), catalog.map { it.legacyReference })
        assertEquals("45", catalog[3].name)
        assertEquals("stalker:channel:43", catalog[1].itemId)
    }
}
