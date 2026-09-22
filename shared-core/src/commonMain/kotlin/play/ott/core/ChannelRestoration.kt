package play.ott.core

/** Source-bound restoration. URI codec and comparison of opaque host metadata are supplied by the host. */
class ChannelRestoration(private val encode: (String) -> String, private val decode: (String) -> String,
                         private val equal: (ProviderValue, ProviderValue) -> Boolean) {
    fun text(value: ProviderValue): String = if (value.kind == ProviderValueKind.TEXT) CoreText.trim(value.scalar).take(512) else ""
    fun normalized(value: ProviderValue): String = CoreText.normalizedSpaces(text(value)).lowercase()
    private fun str(value: String) = ProviderValue.text(value)
    fun reference(channel: ProviderValue, source: String): ProviderValue {
        val result = linkedMapOf("sourceId" to str(source.ifEmpty { channel["sourceId"].string() }), "id" to channel["id"])
        listOf("tvgId", "tvgName", "name", "group").forEach { field -> text(channel[field]).takeIf { it.isNotEmpty() }?.let { result[field] = str(it) } }
        return ProviderValue.obj(result)
    }
    private fun hex(value: String) = value.isNotEmpty() && value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
    fun variant(value: String): Boolean { val parts = value.substringAfterLast(':').split('-'); return ':' in value && parts.size == 2 && parts.all(::hex) }
    fun legacy(ref: ProviderValue): String = try {
        val prefix = encode(ref["sourceId"].string()) + ":m3u:tvg:"
        val id = ref["id"].string()
        if (!id.startsWith(prefix)) "" else {
            val value = id.substring(prefix.length)
            val body = if (variant(value)) value.substringBeforeLast(':') else value
            if (body.isEmpty() || ':' in body || ':' in value && !variant(value)) "" else text(str(decode(body)))
        }
    } catch (_: Throwable) { "" }
    fun restore(items: List<ProviderValue>, ref: ProviderValue): Int {
        if (!ref.truthy() || ref["sourceId"].kind != ProviderValueKind.TEXT || ref["id"].kind != ProviderValueKind.TEXT) return -1
        val available = items.indices.filter { val item = items[it]; item.truthy() && item["kind"].scalar == "live" && (!item["sourceId"].truthy() || item["sourceId"].scalar == ref["sourceId"].scalar) }
        var matches = available.filter { items[it]["id"].kind == ref["id"].kind && items[it]["id"].scalar == ref["id"].scalar }
        val legacy = legacy(ref); val tvg = text(ref["tvgId"]).ifEmpty { legacy }; val wasVariant = legacy.isNotEmpty() && variant(ref["id"].scalar)
        if (matches.isNotEmpty()) return matches.singleOrNull() ?: -1
        val variantField = if (normalized(ref["name"]).isNotEmpty()) "name" else "tvgName"
        val variantName = normalized(ref[variantField])
        if (wasVariant && variantName.isEmpty()) return -1
        fun equivalent(candidates: List<Int>): Int {
            if (candidates.size < 2 || legacy.isEmpty() || tvg.isEmpty() || normalized(ref["name"]).isEmpty()) return -1
            val first = items[candidates.first()]; val fields = first.properties.keys.filter { it != "id" && it != "url" }.sorted()
            if (normalized(first["name"]) != normalized(ref["name"])) return -1
            for (index in candidates) {
                val item = items[index]; val keys = item.properties.keys.filter { it != "id" && it != "url" }.sorted()
                if (text(item["tvgId"]) != tvg || legacy(ProviderValue.obj(mapOf("sourceId" to ref["sourceId"], "id" to item["id"]))) != tvg || keys != fields) return -1
                if (fields.any { !equal(item[it], first[it]) }) return -1
            }
            return candidates.first()
        }
        fun narrow(input: List<Int>): Int {
            var candidates = input
            for (field in listOf("name", "tvgName", "group")) {
                val value = normalized(ref[field]); if (candidates.size <= 1 || value.isEmpty()) continue
                val selected = candidates.filter { normalized(items[it][field]) == value }
                if (selected.isNotEmpty()) candidates = selected
            }
            return candidates.singleOrNull() ?: equivalent(candidates)
        }
        if (tvg.isNotEmpty()) {
            matches = available.filter { text(items[it]["tvgId"]) == tvg }
            if (matches.isNotEmpty()) return narrow(if (wasVariant) matches.filter { normalized(items[it][variantField]) == variantName } else matches)
        }
        for (field in listOf("name", "tvgName")) {
            if (wasVariant && field != variantField) continue
            val value = normalized(ref[field]); if (value.isEmpty()) continue
            matches = available.filter { normalized(items[it][field]) == value }
            if (matches.isNotEmpty()) return narrow(matches)
        }
        return -1
    }
}
