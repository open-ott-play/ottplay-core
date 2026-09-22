package play.ott.core

import kotlin.test.*

class OperatorVodTest {
    private fun t(value: String) = ProviderValue.text(value)
    private fun o(vararg value: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*value))
    private fun a(vararg value: ProviderValue) = ProviderValue.array(value.toList())
    private fun n(value: Int) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    @Test fun vodPreservesProtocolPrefixAndEnvelopePrecedence() {
        assertEquals("https://vod?a=1&box_client=ott-foss&box_mac=raw:mac", OperatorVod.url("antifriz", "https://vod?a=1", "raw:mac"))
        assertEquals(OperatorVodContent("XML", "<?xml data"), OperatorVod.content("prefix#EXTM3U<?xml data"))
        val result = OperatorVod.catalog(o("items" to o("title" to t("Title"), "channel" to o("title" to t("Movie")), "next_page_url" to t("next"))), t("Old"))
        assertEquals("Title", result["name"].string())
        assertEquals(2, result["records"].elements.size)
        assertEquals("next", result["records"].elements.last()["playlist_url"].string())
    }
    @Test fun portalParamsKeepOverridesAndPageOffsetWithoutMutatingInput() {
        val request = OperatorPortal.params("secret", o("key" to t("override"), "app" to t("custom"), "limit" to n(1)), n(20))
        assertEquals("override", request["key"].string())
        assertEquals(20.0, request["limit"].number())
        assertEquals(20.0, OperatorPortal.page(request, 23.0)["offset"].number())
        assertFalse(request["offset"].present)
    }
    @Test fun portalNavigationPreservesMalformedSearchAndFilterNode() {
        val search = OperatorPortal.navigate(t("search=a%ZZ"), "Provider", "", "key") { throw IllegalArgumentException() }
        assertEquals("a%ZZ", search["node"]["request"]["query"].string())
        val root = OperatorPortal.navigate(t(""), "Provider", "portal::[key:secret]https://host", "") { it }
        assertEquals("secret", root["key"].string())
        assertEquals("https://host", root["endpoint"].string())
        assertEquals("Media from Provider", root["node"]["mediaName"].string())
    }
    @Test fun portalInheritsOnlyRecognizedMediaAndPreservesImagePreference() {
        val parent = o("title" to t("Parent"), "img" to t("parent"), "year" to n(2020))
        val item = OperatorPortal.item(o("type" to t("stream"), "title" to t("Child"), "imglr" to t("wide")), parent)
        assertEquals("Parent - Child", item["title"].string())
        assertEquals("wide", OperatorPortal.media(item, "html")["logo_30x30"].string())
        assertEquals(2020.0, item["year"].number())
        assertFalse(OperatorPortal.item(o("type" to t("other")), parent).present)
    }
    @Test fun portalIteratesPlaceholdersAndControlsWithoutLosingPartialRows() {
        val catalog = OperatorPortalCatalog(o("type" to t("category"), "items" to a(o("type" to t("stream")), o("type" to t("next"))), "count" to n(3), "controls" to o("search" to t("yes"), "filters" to a())))
        assertEquals(listOf("MEDIA", "LAZY", "LAZY", "SEARCH", "FILTERS"), (1..5).map { catalog.next()["kind"].string() })
        assertFalse(catalog.next().present)
        val partial = OperatorPortalCatalog(o("type" to t("category"), "items" to a(o("type" to t("stream")), ProviderValue.nil)))
        assertEquals("MEDIA", partial.next()["kind"].string())
        assertFailsWith<OperatorCatalogFailure> { partial.next() }
    }
    @Test fun pageSkipsMarkersButKeepsOriginalOffsetsAndTrimsOnlySelectedPendingRows() {
        val page = OperatorPortalCatalog(o("items" to a(o("type" to t("next")), o("type" to t("stream")))), true)
        assertEquals(1.0, page.next()["index"].number())
        assertEquals(1.0, OperatorPortal.selection(3.0, 2.0, 2.0, listOf(false, false, true, true)))
        assertEquals(4.0, OperatorPortal.selection(4.0, 2.0, 2.0, listOf(false, false, true, true, true)))
    }
}
