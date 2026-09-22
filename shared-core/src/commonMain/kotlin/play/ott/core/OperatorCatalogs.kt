package play.ott.core

internal fun operatorSameValue(a: ProviderValue, b: ProviderValue): Boolean = a === b ||
    a.kind == b.kind && a.kind !in listOf(ProviderValueKind.ARRAY, ProviderValueKind.OBJECT) && a.scalar == b.scalar

/** Category ownership and insertion order shared by operator API catalog profiles. */
class OperatorGroups {
    val members = linkedMapOf<String, MutableList<ProviderValue>>()
    val order = mutableListOf<ProviderValue>()
    fun add(group: ProviderValue, id: ProviderValue) {
        if (!group.truthy() || !id.truthy()) return
        members.getOrPut(group.string()) { order.add(group); mutableListOf() }.add(id)
    }
    fun category(group: ProviderValue) = ProviderValue.obj(mapOf(
        "class" to ProviderValue(ProviderValueKind.NUMBER, (order.indexOfFirst { operatorSameValue(it, group) } + 2).toString()),
        "name" to group))
}

/** Decoded provider payload reducer; the host retains JSON parsing and typed application state. */
class OperatorCatalogs(private val profile: String) {
    private val ids = mutableListOf<ProviderValue>()
    private var channels = ProviderValue.obj()
    private val groups = OperatorGroups()
    private val guide = linkedMapOf<String, ProviderValue>()
    init { require(profile in listOf("itv", "ottclub", "shura")) }

    fun accept(data: ProviderValue, sourceIds: List<String> = emptyList()) {
        if (profile == "itv") {
            if (!data.truthy() || !data["channels"].truthy()) return
            if (!data["channels"].isArray) throw OperatorCatalogFailure("ITV_CHANNELS")
            val result = linkedMapOf<String, ProviderValue>()
            channels = ProviderValue.obj(result)
            for (row in data["channels"].elements) {
                if (!row.present) throw OperatorCatalogFailure("ITV_ROW", row.kind == ProviderValueKind.NULL)
                val id = row["ch_id"]
                if (ids.any { operatorSameValue(it, id) }) continue
                val group = row["cat_name"]
                groups.add(group, id)
                ids.add(id)
                result[id.string()] = ProviderValue.obj(mapOf("category" to groups.category(group), "channel_name" to row["channel_name"],
                    "rec" to row["rec_time"], "server_cdn" to row["server_cdn"], "time" to number(0), "time_to" to number(0), "token" to row["token"]))
            }
        } else if (profile == "shura") {
            if (!data.truthy() || !data.isArray && !data["forEach"].truthy()) return
            if (!data.isArray) throw OperatorCatalogFailure("SHURA_CHANNELS")
            val result = linkedMapOf<String, ProviderValue>()
            channels = ProviderValue.obj(result)
            for (row in data.elements) {
                if (!row.present) throw OperatorCatalogFailure("SHURA_ROW", row.kind == ProviderValueKind.NULL)
                val id = row["id"]
                ids.add(id)
                result[id.string()] = ProviderValue.obj(mapOf("category" to ProviderValue.obj(mapOf("class" to number(0))),
                    "channel_name" to row["name"], "rec" to row["archive"], "time" to number(0), "time_to" to number(0)))
            }
        } else {
            ids.addAll(sourceIds.map(ProviderValue::text))
            val result = data.properties.toMutableMap()
            channels = if (data.isObject) ProviderValue.obj(result) else data
            for (id in sourceIds) {
                val original = result[id] ?: continue
                if (!original.truthy()) continue
                if (!original.isObject) { guide[id] = ProviderValue.array(listOf(original)); continue }
                val row = original.properties.toMutableMap()
                row["rec"] = number(if (original["rec"].truthy()) 168 else 0)
                if (!original["channel_name"].truthy() && original["name"].truthy()) row["channel_name"] = original["name"]
                result[id] = ProviderValue.obj(row)
                guide[id] = ProviderValue.array(listOf(result.getValue(id)))
            }
            for (id in sourceIds) {
                val original = result[id] ?: continue
                if (!original.truthy()) continue
                val category = original["category"]
                val group = when {
                    category.truthy() -> if (category.kind == ProviderValueKind.TEXT) category else category["name"]
                    original["group"].truthy() -> original["group"]
                    else -> original["group_title"]
                }
                if (!group.truthy()) continue
                groups.add(group, ProviderValue.text(id))
                val row = original.properties.toMutableMap()
                row["category"] = groups.category(group)
                result[id] = ProviderValue.obj(row)
                guide[id] = ProviderValue.array(listOf(result.getValue(id)))
            }
        }
    }

    fun result() = ProviderValue.obj(mapOf("ids" to ProviderValue.array(ids.toList()), "channels" to channels,
        "groups" to ProviderValue.obj(groups.members.mapValues { ProviderValue.array(it.value.toList()) }),
        "groupOrder" to ProviderValue.array(groups.order.toList()), "epg" to ProviderValue.obj(guide)))

    companion object {
        private fun number(value: Int) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
        fun clubIds(text: String) = text.split("\"ch_id\":\"").drop(1).map { it.substringBefore("\",\"") }
        fun validCredentials(profile: String, key: String, address: String = "") = when (profile) {
            "itv" -> key.length in 10..12
            "ottclub" -> key.length >= 8 && address.length >= 4
            else -> error("Unknown operator credential profile")
        }
    }
}
