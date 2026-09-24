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
}
