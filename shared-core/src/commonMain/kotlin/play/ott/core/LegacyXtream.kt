package play.ott.core

data class LegacyXtreamEntry(val id: Double, val name: ProviderValue, val providerId: String, val category: Int,
    val group: String, val logo: ProviderValue, val url: String, val groupValue: ProviderValue = ProviderValue.text(group))
data class LegacyXtreamCatalog(val entries: List<LegacyXtreamEntry>, val groups: Map<String, List<Double>>, val groupOrder: List<String>,
    val groupValues: List<ProviderValue> = groupOrder.map(ProviderValue::text))

/** One name-hash catalog reducer for the base Xtream and operator profiles. */
class LegacyXtreamCatalogBuilder(private val addresses: XtreamAddresses, private val hash: (ProviderValue) -> Double,
    private val strictOperator: Boolean = false) {
    private val categories = linkedMapOf<String, ProviderValue>()
    private val entries = linkedMapOf<Double, LegacyXtreamEntry>()
    private val groups = OperatorGroups()

    fun category(row: ProviderValue) {
        if (strictOperator && !row.present) throw OperatorCatalogFailure("CATEGORY_ROW", row.kind == ProviderValueKind.NULL)
        val value = if (row["category_name"].truthy()) row["category_name"] else ProviderValue.text("Unknown")
        categories[row["category_id"].string()] = if (strictOperator) value else ProviderValue.text(value.string())
    }

    fun stream(row: ProviderValue) {
        if (strictOperator && !row.present) throw OperatorCatalogFailure("STREAM_ROW", row.kind == ProviderValueKind.NULL)
        val name = row["name"]
        val id = hash(name)
        val groupValue = categories[row["category_id"].string()]?.takeIf { it.truthy() } ?: ProviderValue.text("Other")
        val group = groupValue.string()
        groups.add(groupValue, ProviderValue(ProviderValueKind.NUMBER, id.toString()))
        if (id in entries) return
        val category = groups.category(groupValue)["class"].number().toInt()
        val stream = row["stream_id"].string()
        entries[id] = LegacyXtreamEntry(id, name, stream, category, group,
            if (row["stream_icon"].truthy()) row["stream_icon"] else ProviderValue.text(""), addresses.legacyStream(stream), groupValue)
    }

    fun catalog() = LegacyXtreamCatalog(entries.values.toList(), groups.members.mapValues { it.value.map(ProviderValue::number) },
        groups.members.keys.toList(), groups.order.toList())
}

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
        val builder = LegacyXtreamCatalogBuilder(addresses, hash)
        data["get_live_categories"]?.elements.orEmpty().forEach(builder::category)
        data["get_live_streams"]?.elements.orEmpty().forEach(builder::stream)
        return builder.catalog()
    }
}
