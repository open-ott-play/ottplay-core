package play.ott.core

import kotlin.test.*

class OperatorChannelSessionTest {
    private fun text(value: String) = ProviderValue.text(value)
    private fun obj(vararg pairs: Pair<String, ProviderValue>) = ProviderValue.obj(mapOf(*pairs))
    private fun array(vararg values: ProviderValue) = ProviderValue.array(values.toList())
    private fun row(id: String, name: String, category: String = "7") = obj(
        "stream_id" to text(id), "name" to text(name), "category_id" to text(category))
    private fun session(): OperatorChannelSession {
        val addresses = XtreamAddresses(XtreamSource("test", "user", "pass"), { path, query ->
            "https://host.test/" + path.joinToString("/") + if (query.isEmpty()) "" else
                query.joinToString("&", "?") { it.first + "=" + it.second }
        }, { it })
        return OperatorChannelSession("https://host.test", addresses)
    }

    @Test fun identicalTitlesRemainDifferentAndRenamesKeepIdentity() {
        val first = session().apply { accept(obj("live_streams" to array(row("11", "News"), row("22", "News")))) }.catalog()
        assertEquals(listOf("xtream:stream:11", "xtream:stream:22"), first.map { it.itemId })
        val renamed = session().apply { accept(obj("live_streams" to array(row("22", "Actualités"), row("11", "Новости")))) }.catalog()
        assertEquals(first.map { it.itemId }.toSet(), renamed.map { it.itemId }.toSet())
        assertEquals(first[0].url, renamed[1].url)
    }

    @Test fun categoryNamesDoNotOwnMembershipAndInvalidReferencesAreSkipped() {
        val state = session().apply { accept(obj("categories" to array(obj("category_id" to text("7"), "category_name" to text("News"))),
            "live_streams" to array(row("11", "One"), row("11", "Duplicate"), obj("name" to text("Missing ID"))))) }
        assertEquals(1, state.catalog().size)
        assertEquals("xtream:category:7", state.catalog().single().groupId)
        assertEquals("News", state.catalog().single().groupName)
    }

    @Test fun invalidRowsKeepTheAcceptedPrefixAndErrorKind() {
        val state = session()
        val error = assertFailsWith<OperatorCatalogFailure> {
            state.accept(obj("live_streams" to array(row("11", "First"), ProviderValue.nil, row("22", "Later"))))
        }
        assertEquals("STREAM_ROW", error.code)
        assertTrue(error.isNull)
        assertEquals(listOf("11"), state.catalog().map { it.providerId })
        assertEquals(OperatorSourceAction.API, state.action())
    }

    @Test fun fallbackAndSuccessfulEmptyResponseStayDistinct() {
        val empty = session().apply { accept(obj("live_streams" to array())) }
        assertEquals(OperatorSourceAction.API, empty.action())
        assertTrue(empty.catalog().isEmpty())
        val missing = session().apply { accept(obj()) }
        assertEquals(OperatorSourceAction.PLAYLIST, missing.action())
        assertTrue(missing.request().contains("get.php"))
        val failed = session().apply { reject() }
        assertEquals(OperatorSourceAction.PLAYLIST, failed.action())
        assertTrue(failed.request().contains("get.php"))
    }
}
