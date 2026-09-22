package play.ott.core

/** Edem VPortal catalog/navigation policy, independent of DOM, callbacks and transport. */
object OperatorPortal {
    private fun text(value: String) = ProviderValue.text(value)
    private fun number(value: Double) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    private fun fields(vararg values: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*values))
    fun params(key: String, request: ProviderValue, limit: ProviderValue = ProviderValue.missing): ProviderValue {
        val result = linkedMapOf("app" to text("ott-play"), "key" to text(key))
        result.putAll(request.properties)
        if (limit.present) result["limit"] = limit
        return ProviderValue.obj(result)
    }
    fun page(params: ProviderValue, selected: Double): ProviderValue {
        val result = params.properties.toMutableMap()
        result["offset"] = number(kotlin.math.floor(selected / params["limit"].number()) * params["limit"].number())
        return ProviderValue.obj(result)
    }
    fun navigate(input: ProviderValue, provider: String, portal: String, key: String, decode: (String) -> String): ProviderValue {
        var endpoint = ProviderValue.missing
        var access = text(key)
        val node = when {
            input.kind == ProviderValueKind.TEXT && input.scalar.isEmpty() -> {
                endpoint = portal.split(']').getOrNull(1)?.let(::text) ?: ProviderValue.missing
                val suffix = portal.split("portal::[key:").getOrNull(1) ?: throw OperatorCatalogFailure("PORTAL_KEY")
                access = text(suffix.substringBefore(']'))
                fields("mediaName" to text("Media from $provider"), "request" to fields())
            }
            input.kind == ProviderValueKind.TEXT && input.scalar.startsWith("search") -> {
                val raw = input.scalar.substring(input.scalar.indexOf('=') + 1)
                val query = try { decode(raw) } catch (_: Throwable) { raw }
                fields("mediaName" to text("[$query]"), "request" to fields("cmd" to text("search"), "query" to text(query)))
            }
            else -> input
        }
        val action = when (node["a"].string()) { "filters" -> "FILTERS"; "filter" -> "FILTER"; else -> "REQUEST" }
        return fields("action" to text(action), "node" to node, "endpoint" to endpoint, "key" to access)
    }
    fun filter(value: ProviderValue, root: Boolean): ProviderValue {
        if (!value.present) throw OperatorCatalogFailure("PORTAL_TITLE", value.kind == ProviderValueKind.NULL)
        val playlist = if (root) fields("a" to text("filter"), "items" to value["items"], "mediaName" to value["title"])
            else fields("mediaName" to value["title"], "request" to value["request"])
        return fields("description" to value["title"], "logo_30x30" to text(""), "playlist_url" to playlist, "title" to value["title"])
    }
    fun item(value: ProviderValue, parent: ProviderValue): ProviderValue {
        if (!value.present) throw OperatorCatalogFailure("PORTAL_TYPE", value.kind == ProviderValueKind.NULL)
        if (value["type"].string() !in listOf("stream", "category", "multistream")) return ProviderValue.missing
        val result = value.properties.toMutableMap()
        if (parent.truthy()) {
            if (parent["title"].truthy()) result["title"] = text(parent["title"].string() + " - " + value["title"].string())
            if (!value["img"].truthy() && !value["imglr"].truthy()) result["img"] = if (parent["img"].truthy()) parent["img"] else parent["imglr"]
            for (key in listOf("year", "duration", "agelimit", "description")) if (!value[key].truthy()) result[key] = parent[key]
        }
        return ProviderValue.obj(result)
    }
    fun media(value: ProviderValue, description: String): ProviderValue {
        val result = linkedMapOf("description" to text(description), "logo_30x30" to if (value["imglr"].truthy()) value["imglr"] else value["img"])
        if (value["type"].string() == "stream") { result["request"] = value["request"]; result["stream_url"] = value["url"] }
        else result["playlist_url"] = fields("mediaName" to value["title"], "request" to value["request"])
        result["title"] = value["title"]
        return ProviderValue.obj(result)
    }
    fun variants(variants: ProviderValue, url: ProviderValue): ProviderValue {
        val keys = variants.properties.keys.toList()
        var selected = 0
        keys.forEachIndexed { index, key -> if (operatorSameValue(variants[key], url)) selected = index }
        return fields("keys" to ProviderValue.array(keys.map(::text)), "selected" to number(selected.toDouble()))
    }
    fun selection(selected: Double, offset: Double, limit: Double, lazy: List<Boolean>): Double {
        var current = selected
        while (current >= offset && current < offset + limit && current % 1 == 0.0 && lazy.getOrNull(current.toInt()) == true) current--
        return current
    }
}

/** Emits one row at a time so malformed later rows retain already delivered catalog entries. */
class OperatorPortalCatalog(private val data: ProviderValue, private val page: Boolean = false) {
    private var at = 0
    private var emitted = 0
    private var controls = 0
    private var fill = false
    private var ended = false
    fun named() = data.present && data["type"].string() in listOf("videoportal", "category", "multistream")
    fun next(): ProviderValue {
        if (ended || !data.present) return ProviderValue.missing
        fun result(kind: String, value: ProviderValue = ProviderValue.missing, index: Int = emitted) = ProviderValue.obj(linkedMapOf(
            "kind" to ProviderValue.text(kind), "value" to value,
            "index" to ProviderValue(ProviderValueKind.NUMBER, index.toString())))
        if (data["type"].string() == "error") { ended = true; return result("ERROR", data["description"]) }
        if (!page && !named()) { ended = true; return ProviderValue.missing }
        val items = data["items"]
        if ((page || items.truthy()) && !items.isArray) throw OperatorCatalogFailure("PORTAL_ITEMS", items.kind == ProviderValueKind.NULL)
        while (at < items.elements.size || fill) {
            if (fill) {
                if (emitted.toDouble() < data["count"].number()) { emitted++; return result("LAZY", index = emitted - 1) }
                fill = false
            }
            if (at >= items.elements.size) break
            val index = at++
            val row = items.elements[index]
            if (!row.present) throw OperatorCatalogFailure("PORTAL_TYPE", row.kind == ProviderValueKind.NULL)
            if (row["type"].string() == "next") { if (!page) fill = true; continue }
            emitted++
            return result("MEDIA", row, if (page) index else emitted - 1)
        }
        if (!page) {
            if (controls == 0) { controls++; if (data["controls"]["search"].truthy()) return result("SEARCH") }
            if (controls == 1) { controls++; if (data["controls"]["filters"].truthy()) return result("FILTERS", data["controls"]["filters"]) }
        }
        ended = true
        return ProviderValue.missing
    }
}
