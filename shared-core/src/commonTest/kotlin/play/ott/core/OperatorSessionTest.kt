package play.ott.core

import kotlin.test.*

class OperatorSessionTest {
    private fun text(value: String) = ProviderValue.text(value)
    private fun obj(vararg values: Pair<String, ProviderValue>) = ProviderValue.obj(mapOf(*values))
    private fun array(vararg values: ProviderValue) = ProviderValue.array(values.toList())
    private fun row(name: ProviderValue, id: String, group: String = "1") = obj("name" to name, "stream_id" to text(id), "category_id" to text(group))
    private fun session(hash: (ProviderValue) -> Double = { if (it.truthy()) it.string().first().code.toDouble() else 0.0 }): OperatorSession {
        val source = XtreamSource("fixture", "user", "password")
        val base = "https://fixture.test/player_api.php/path///"
        val addresses = XtreamAddresses(source, { path, query -> base + "/" + path.joinToString("/") +
            if (query.isEmpty()) "" else query.joinToString("&", "?") { it.first + "=" + it.second } }, { it })
        return OperatorSession(base, addresses, hash)
    }

    @Test fun configurationUsesApiOnlyWithAllThreeCredentials() {
        val configured = obj("server" to text("s"), "user" to text("u"), "pass" to text("p"), "m3u" to text("m"))
        assertEquals(OperatorSourceAction.API, OperatorSession.source(configured))
        assertEquals(OperatorSourceAction.PLAYLIST, OperatorSession.source(obj("server" to text("s"), "m3u" to text("m"))))
        assertEquals(OperatorSourceAction.CONFIGURE, OperatorSession.source(obj("server" to text("s"))))
    }

    @Test fun responseFallbackAndNetworkFallbackRetainDifferentUrlRules() {
        val absent = session().apply { accept(obj()) }
        assertEquals(OperatorSourceAction.PLAYLIST, absent.action())
        assertEquals("https://fixture.test/get.php/path////player_api.php?username=user&password=password&type=m3u_plus&output=ts", absent.request())
        val failed = session().apply { reject() }
        assertEquals("https://fixture.test/player_api.php/path/get.php?username=user&password=password&type=m3u_plus&output=ts", failed.request())
    }

    @Test fun emptyCombinedCatalogIsSuccessful() {
        val state = session().apply { accept(obj("live_streams" to array())) }
        assertEquals(OperatorSourceAction.API, state.action())
        assertTrue(state.catalog().entries.isEmpty())
    }

    @Test fun duplicatesContributeToGroupsButFirstHashOwnsPayload() {
        val state = session().apply { accept(obj("categories" to array(
            obj("category_id" to text("1"), "category_name" to text("News")),
            obj("category_id" to text("2"), "category_name" to text("Other"))),
            "live_streams" to array(row(text("A"), "first"), row(text("A"), "second", "2"), row(text(""), "zero")))) }
        val result = state.catalog()
        assertEquals(listOf(65.0, 0.0), result.entries.map { it.id })
        assertEquals("first", result.entries.first().providerId)
        assertEquals(mapOf("News" to listOf(65.0), "Other" to listOf(65.0)), result.groups)
    }

    @Test fun malformedRowsPreserveTheAlreadyReducedPrefix() {
        val state = session()
        val error = assertFailsWith<OperatorCatalogFailure> {
            state.accept(obj("live_streams" to array(row(text("A"), "first"), ProviderValue.nil, row(text("B"), "later"))))
        }
        assertEquals("STREAM_ROW", error.code)
        assertTrue(error.isNull)
        assertEquals(listOf("first"), state.catalog().entries.map { it.providerId })
    }

    @Test fun malformedCategoryFailsBeforeStreamsAndMalformedStreamsDoNotFallback() {
        val categories = session()
        assertEquals("CATEGORY_ROW", assertFailsWith<OperatorCatalogFailure> {
            categories.accept(obj("categories" to array(ProviderValue.nil), "live_streams" to array(row(text("A"), "first"))))
        }.code)
        assertTrue(categories.catalog().entries.isEmpty())
        val streams = session()
        assertEquals("STREAMS", assertFailsWith<OperatorCatalogFailure> { streams.accept(obj("live_streams" to obj())) }.code)
        assertEquals(OperatorSourceAction.API, streams.action())
    }

    @Test fun hostHashFailureKeepsIdentityAndAlreadyReducedPrefix() {
        val failure = IllegalStateException("host primitive")
        val state = session { if (it.string() == "bad") throw failure else 1.0 }
        assertSame(failure, assertFailsWith<IllegalStateException> {
            state.accept(obj("live_streams" to array(row(text("A"), "first"), row(text("bad"), "second"))))
        })
        assertEquals("first", state.catalog().entries.single().providerId)
    }
}
