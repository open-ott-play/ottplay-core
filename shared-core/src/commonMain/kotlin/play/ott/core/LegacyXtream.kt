package play.ott.core

data class LegacyXtreamEntry(val id: Double, val name: ProviderValue, val providerId: String, val category: Int,
    val group: String, val logo: ProviderValue, val url: String)
data class LegacyXtreamCatalog(val entries: List<LegacyXtreamEntry>, val groups: Map<String, List<Double>>, val groupOrder: List<String>)

/** The base player's name-hash identity is retained for existing favorites. */
data class LegacyXtreamProgramme(val name: ProviderValue, val description: ProviderValue, val start: Double, val end: Double)
object LegacyXtream {
    fun guide(response: ProviderValue, clock: (ProviderValue) -> Double): List<LegacyXtreamProgramme>? {
        if (!response["epg_listings"].isArray) return null
        return response["epg_listings"].elements.mapNotNull { row ->
            val start = clock(row["start"]); val end = clock(row["end"])
            if (start.isNaN() || end.isNaN()) null else LegacyXtreamProgramme(
                if (row["title"].truthy()) row["title"] else ProviderValue.text("No title"),
                if (row["description"].truthy()) row["description"] else ProviderValue.text(""), start, end)
        }
    }

    fun catalog(data: Map<String, ProviderValue>, addresses: XtreamAddresses, hash: (ProviderValue) -> Double): LegacyXtreamCatalog {
        val categories = linkedMapOf<String, String>()
        for (row in data["get_live_categories"]?.elements.orEmpty()) categories[row["category_id"].string()] =
            if (row["category_name"].truthy()) row["category_name"].string() else "Unknown"
        val entries = linkedMapOf<Double, LegacyXtreamEntry>()
        val groups = linkedMapOf<String, MutableList<Double>>()
        val indexes = mutableMapOf<String, Int>()
        for (row in data["get_live_streams"]?.elements.orEmpty()) {
            val name = row["name"]
            val id = hash(name)
            val group = categories[row["category_id"].string()].orEmpty().ifEmpty { "Other" }
            if (id != 0.0) groups.getOrPut(group) { indexes[group] = groups.size + 2; mutableListOf() }.add(id)
            if (id in entries) continue
            val stream = row["stream_id"].string()
            entries[id] = LegacyXtreamEntry(id, name, stream, indexes[group] ?: 1, group,
                if (row["stream_icon"].truthy()) row["stream_icon"] else ProviderValue.text(""), addresses.legacyStream(stream))
        }
        return LegacyXtreamCatalog(entries.values.toList(), groups, groups.keys.toList())
    }
}
