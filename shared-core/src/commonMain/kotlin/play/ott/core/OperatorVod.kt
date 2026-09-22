package play.ott.core

data class OperatorVodContent(val format: String, val text: String)

/** XML/JSON/M3U catalog envelope policy; native parsers and HTML presentation stay outside. */
object OperatorVod {
    fun url(profile: String, url: String, mac: String): String {
        require(profile in listOf("antifriz", "kb-team"))
        if (url.isEmpty() || mac.isEmpty()) return url
        return url + (if ('?' in url) "&" else "?") + "box_client=" +
            (if (profile == "antifriz") "ott-foss" else "ott-play") + "&box_mac=" + mac
    }
    fun content(text: String): OperatorVodContent {
        val xml = text.indexOf("<?xml")
        return when {
            xml >= 0 -> OperatorVodContent("XML", text.substring(xml))
            text.contains("#EXTM3U") -> OperatorVodContent("M3U", text)
            else -> OperatorVodContent("JSON", text)
        }
    }
    fun catalog(input: ProviderValue, previousName: ProviderValue): ProviderValue {
        if (!input.present) throw OperatorCatalogFailure("VOD_NULL", input.kind == ProviderValueKind.NULL)
        val data = if (input["items"].truthy()) input["items"] else input
        val name = listOf(data["playlist_name"], data["title"], previousName).firstOrNull { it.truthy() } ?: ProviderValue.text("?")
        val channels = if (data["channel"].truthy()) data["channel"] else data["channels"]
        val records = when {
            !channels.truthy() -> mutableListOf()
            channels.isArray -> channels.elements.toMutableList()
            else -> mutableListOf(channels)
        }
        if (data["next_page_url"].truthy()) records.add(ProviderValue.obj(mapOf(
            "description" to ProviderValue.text("..."), "logo_30x30" to ProviderValue.text(""),
            "playlist_url" to data["next_page_url"], "title" to ProviderValue.text("..."))))
        return ProviderValue.obj(mapOf("name" to name, "records" to ProviderValue.array(records)))
    }
}
