package play.ott.core

/** Provider identity is independent of labels, category position and UI numeric IDs. */
data class CatalogChannel(val itemId: String, val providerId: String, val name: String,
    val groupId: String, val groupName: String, val logo: String, val url: String,
    val archiveHours: Double = 0.0, val archiveMode: String = "")

object ChannelCatalog {
    fun xtream(data: Map<String, ProviderValue>, addresses: XtreamAddresses): List<CatalogChannel> {
        val groups = linkedMapOf<String, String>()
        data["get_live_categories"]?.elements.orEmpty().forEach { row ->
            val id = row["category_id"].string()
            groups[id] = row["category_name"].takeIf { it.truthy() }?.string() ?: "Unknown"
        }
        val seen = mutableSetOf<String>()
        return data["get_live_streams"]?.elements.orEmpty().mapNotNull { row ->
            val providerId = row["stream_id"].takeIf { it.present && it.kind != ProviderValueKind.NULL }?.string()
            if (providerId.isNullOrBlank() || !seen.add(providerId)) return@mapNotNull null
            val categoryId = row["category_id"].string()
            CatalogChannel("xtream:stream:$providerId", providerId, row["name"].takeIf { it.truthy() }?.string() ?: providerId,
                "xtream:category:$categoryId", groups[categoryId] ?: "Other", row["stream_icon"].takeIf { it.truthy() }?.string() ?: "",
                addresses.legacyStream(providerId))
        }
    }

    fun stalker(value: ProviderValue, portal: String, mac: String): List<CatalogChannel> {
        var rows = value
        if (rows.isObject) {
            rows = listOf(rows["data"], rows["items"], rows["channels"]).firstOrNull { it.isArray }
                ?: ProviderValue.array(rows.properties.values.filter { it.isObject && it["name"].truthy() })
        }
        val seen = mutableSetOf<String>()
        return rows.elements.mapNotNull { row ->
            val providerId = listOf(row["id"], row["ch_id"]).firstOrNull { it.truthy() }?.string()
            val rawUrl = row["url"].takeIf { it.truthy() }?.string()
            val identity = providerId ?: rawUrl ?: return@mapNotNull null
            if (!seen.add(identity)) return@mapNotNull null
            var category = listOf(row["genre"], row["categories"], row["category"]).firstOrNull { it.truthy() }
            if (category?.isArray == true) category = category.elements.firstOrNull()
            val group = category?.takeIf { it.kind == ProviderValueKind.TEXT }?.string() ?: "Other"
            val groupId = listOf(row["genre_id"], row["category_id"]).firstOrNull { it.truthy() }?.string() ?: group
            val rawLogo = listOf(row["logo"], row["icon"], row["tv_icon"]).firstOrNull { it.truthy() }?.string() ?: ""
            val logo = when { rawLogo.startsWith("//") -> (if (portal.startsWith("https")) "https:" else "http:") + rawLogo
                rawLogo.startsWith('/') -> portal.trimEnd('/') + rawLogo; else -> rawLogo }
            val hours = listOf(row["archive"], row["archive_duration"]).map { ProviderPlaylist.integer(it.string()) }
                .firstOrNull { it.isFinite() && it > 0 } ?: 0.0
            CatalogChannel("stalker:channel:$identity", providerId ?: "", row["name"].takeIf { it.truthy() }?.string() ?: identity,
                "stalker:category:$groupId", group, logo,
                rawUrl ?: portal.trimEnd('/') + "/stalker_portal/stream/" + providerId + ".m3u8?mac=" + mac,
                hours, if (row["archive"].truthy()) "append" else "")
        }
    }
}
