package play.ott.core

data class XtreamItem(
    val id: String, val providerId: String, val kind: String, val name: String, val url: String,
    val group: String, val logo: String, val epgId: String = "", val description: String = "",
    val adult: Boolean = false, val archiveDays: Double? = null, val archiveSource: String = "",
    val generatedName: String = "", val generatedGroup: Boolean = false,
    val season: String = "", val episode: Double? = null,
)
data class XtreamCatalog(val entries: List<XtreamItem>, val warnings: List<String> = emptyList())
data class XtreamSeries(val entries: List<XtreamItem>, val names: Map<String, String>, val warnings: List<String>)
data class XtreamSeriesParent(val id: String, val name: String = "", val logo: String = "", val description: String = "", val adult: Boolean = false)

object XtreamCatalogs {
    fun seriesRequest(id: ProviderValue, folder: String, format: XtreamFormat): XtreamRequest {
        if (format == XtreamFormat.BROWSER && (!id.numericId() || folder !in listOf("series", "season"))) throw XtreamFailure("FOLDER")
        val value = if (format == XtreamFormat.BROWSER) id.string() else id.primitive()
        if (format == XtreamFormat.ANDROID && value.isBlank()) throw XtreamFailure("SERIES_ID")
        return XtreamRequest("get_series_info", mapOf("series_id" to value))
    }

    fun seasons(series: XtreamSeries, source: XtreamSource, parent: XtreamSeriesParent, component: (String) -> String): List<XtreamItem> =
        series.entries.map { it.season }.distinct().map { season ->
            XtreamItem(component(CoreText.trim(source.id)) + ":xtream:series:" + parent.id + ":season:" + season,
                parent.id, "season", series.names[season].orEmpty().ifEmpty { "Season $season" }, "", parent.name,
                parent.logo, description = parent.description, adult = parent.adult, season = season)
        }.sortedBy { CoreNumber.javascript(it.season) }

    private fun validExtension(value: String, limit: Int) = value.length in 1..limit && value.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }
    private fun kindAction(kind: String) = if (kind == "series") "get_series" else "get_${kind}_streams"
    private fun identity(format: XtreamFormat, source: XtreamSource, kind: String, id: String,
        component: (String) -> String, hash: (List<String>) -> String) = if (format == XtreamFormat.BROWSER)
        component(CoreText.trim(source.id)) + ":xtream:$kind:$id" else hash(listOf(source.id, kind, id))

    fun catalog(data: Map<String, ProviderValue>, format: XtreamFormat, source: XtreamSource, addresses: XtreamAddresses,
        resolve: (String) -> String, component: (String) -> String, hash: (List<String>) -> String, kinds: List<String> = listOf("live", "vod", "series"), deduplicate: Boolean = true): XtreamCatalog {
        require(format != XtreamFormat.LEGACY)
        val browser = format == XtreamFormat.BROWSER
        val entries = mutableListOf<XtreamItem>()
        val seen = mutableSetOf<String>()
        val warnings = mutableListOf<String>()
        for (kind in kinds) {
            val groups = linkedMapOf<String, String>()
            for (row in data["get_${kind}_categories"]?.elements.orEmpty()) {
                if (browser) {
                    if (row.truthy() && row["category_id"].present) groups[row["category_id"].string()] = row["category_name"].trimmed().ifEmpty { "Other" }
                } else if (row.isObject) groups[row["category_id"].primitive()] = row["category_name"].primitive()
            }
            for (row in data[kindAction(kind)]?.elements.orEmpty()) {
                if (!browser && !row.isObject) continue
                val value = row[if (kind == "series") "series_id" else "stream_id"]
                if (browser && !value.numericId()) { warnings.add("Ignored a catalog record without a numeric stream ID"); continue }
                val id = if (browser) value.string() else value.primitive()
                if (!browser && id.isBlank()) continue
                val key = identity(format, source, kind, id, component, hash)
                if (browser && !seen.add(key)) continue
                val rawName = if (browser) row["name"].trimmed() else row["name"].primitive()
                val generated = if (browser) rawName.isEmpty() else rawName.isBlank()
                val name = if (!generated) rawName else if (browser) (if (kind == "series") "Series " else "Channel ") + id else "Untitled $kind"
                val category = if (browser) row["category_id"].string() else row["category_id"].primitive()
                val rawGroup = groups[category].orEmpty()
                val fallbackGroup = if (browser) rawGroup.isEmpty() else rawGroup.isBlank()
                val group = if (!fallbackGroup) rawGroup else if (browser && kind != "live") if (kind == "vod") "Movies" else "Series" else "Other"
                val direct = if (browser) resolve(row["direct_source"].trimmed()) else row["direct_source"].primitive().takeIf { it.isNotBlank() }?.let(resolve)
                val candidate = if (browser && kind == "live") source.output else if (browser) row["container_extension"].trimmed() else row["container_extension"].primitive()
                val valid = validExtension(candidate, if (browser) 10 else 8)
                if (browser && kind != "series" && direct.isNullOrEmpty() && !valid) { warnings.add("Ignored VOD without a valid container extension"); continue }
                val extension = if (valid) candidate else if (kind == "live") "m3u8" else "mp4"
                val url = if (kind == "series") "" else if (browser) direct.orEmpty().ifEmpty { addresses.stream(if (kind == "vod") "movie" else "live", id, extension) }
                    else direct ?: addresses.stream(if (kind == "vod") "movie" else "live", id, extension)
                val days = if (browser) row["tv_archive_duration"].positive() else row["tv_archive_duration"].primitive().toDoubleOrNull() ?: 0.0
                val archive = kind == "live" && days > 0 && if (browser) row["tv_archive"].flag() else row["tv_archive"].primitive() in listOf("1", "true")
                val logo = if (browser) (if (row["stream_icon"].truthy()) row["stream_icon"] else row["cover"]).trimmed()
                    else row["stream_icon"].primitive().ifBlank { row["cover"].primitive() }
                entries.add(XtreamItem(key, id, kind, name, url, group, resolve(logo),
                    if (browser) row["epg_channel_id"].trimmed() else if (kind == "live") row["epg_channel_id"].primitive().ifBlank { id } else "",
                    if (browser) row["plot"].trimmed() else row["plot"].primitive(), browser && row["is_adult"].flag(),
                    if (archive) days else null, if (archive && !browser) addresses.archive(id) else "",
                    if (generated) kind else "", fallbackGroup))
                if (!browser && entries.size > 100_000) throw XtreamFailure("CATALOG_LIMIT")
            }
        }
        return XtreamCatalog(if (browser || !deduplicate) entries else entries.distinctBy { it.id }, warnings)
    }

    fun episodes(data: ProviderValue, format: XtreamFormat, source: XtreamSource, addresses: XtreamAddresses,
        parent: XtreamSeriesParent, resolve: (String) -> String, component: (String) -> String, hash: (List<String>) -> String): XtreamSeries {
        val browser = format == XtreamFormat.BROWSER
        if (browser && data["user_info"].truthy() && data["user_info"]["auth"].string() != "1") throw XtreamFailure("RESPONSE_AUTH")
        if (!browser && !data.isObject) throw XtreamFailure("SERIES_FORMAT")
        val episodes = data["episodes"]
        if (!episodes.isObject && !episodes.isArray) throw XtreamFailure(if (browser) "BROWSER_SERIES" else "EPISODES_FORMAT")
        val warnings = mutableListOf<String>()
        val names = linkedMapOf<String, String>()
        if (browser) for (season in data["seasons"].elements) if (season["season_number"].numericId()) names[season["season_number"].string()] = season["name"].trimmed()
        val sections = if (episodes.isObject) episodes.properties.toList() else if (browser)
            episodes.elements.mapIndexed { index, value -> index.toString() to if (value.truthy() && !value.isArray) ProviderValue.array(listOf(value)) else value }
            else listOf("0" to episodes)
        val result = mutableListOf<XtreamItem>()
        val seen = mutableSetOf<String>()
        if (browser) sections.filter { !it.second.isArray }.forEach { warnings.add("Ignored an invalid episode group") }
        for ((seasonKey, rows) in sections) {
            if (!rows.isArray) continue
            for (row in rows.elements) {
                if (!browser && !row.isObject) continue
                val id = if (browser) row["id"].string() else row["id"].primitive().ifBlank { row["stream_id"].primitive() }
                val season = if (browser) (if (row["season"].present) row["season"] else ProviderValue.text(seasonKey)) else ProviderValue.text(row["season"].primitive().toIntOrNull()?.toString() ?: seasonKey.toIntOrNull()?.toString().orEmpty())
                if (browser && (!row["id"].numericId() || !season.numericId())) { warnings.add("Ignored an episode without a numeric identity or season"); continue }
                if (!browser && id.isBlank()) continue
                val direct = if (browser) resolve(row["direct_source"].trimmed()) else row["direct_source"].primitive().takeIf { it.isNotBlank() }?.let(resolve)
                val candidate = if (browser) row["container_extension"].trimmed() else row["container_extension"].primitive()
                val valid = validExtension(candidate, if (browser) 10 else 8)
                if (browser && direct.isNullOrEmpty() && !valid) { warnings.add("Ignored an episode without a valid container extension"); continue }
                if (browser && !seen.add(id)) continue
                val title = if (browser) row["title"].trimmed() else row["title"].primitive()
                val generated = if (browser) title.isEmpty() else title.isBlank()
                val label = if (browser) (if (row["episode_num"].truthy()) row["episode_num"].string() else id) else row["episode_num"].primitive().ifBlank { id }
                val url = if (browser) direct.orEmpty().ifEmpty { addresses.stream("series", id, candidate) } else direct ?: addresses.stream("series", id, if (valid) candidate else "mp4")
                result.add(XtreamItem(identity(format, source, "episode", id, component, hash), id, "episode", if (generated) "Episode $label" else title, url,
                    if (browser) parent.name.ifEmpty { "Series" } else parent.name,
                    resolve(if (browser) row["info"]["movie_image"].trimmed() else row["info"]["movie_image"].primitive()).ifEmpty { parent.logo },
                    description = if (browser) row["info"]["plot"].trimmed() else row["info"]["plot"].primitive(), adult = parent.adult,
                    generatedName = if (generated) label else "", season = season.string(),
                    episode = if (browser) row["episode_num"].positive() else row["episode_num"].primitive().toIntOrNull()?.toDouble()))
                if (!browser && result.size > 100_000) throw XtreamFailure("EPISODES_LIMIT")
            }
        }
        val items = if (browser) result.groupBy { it.season }.values.flatMap { rows -> rows.sortedBy { it.episode ?: 0.0 } } else result.distinctBy { it.id }.sortedWith(compareBy<XtreamItem> { it.season.toIntOrNull() ?: 0 }.thenBy { it.episode ?: 0.0 })
        return XtreamSeries(items, names, warnings)
    }
}

/** Native catalogs are processed when their section completes, before requesting the next one. */
class XtreamLoad(source: XtreamSource, addresses: XtreamAddresses, resolve: (String) -> String, hash: (List<String>) -> String) {
    private val entries = mutableListOf<XtreamItem>()
    val session = XtreamSession(XtreamFormat.ANDROID) { kind, data ->
        val section = XtreamCatalogs.catalog(data, XtreamFormat.ANDROID, source, addresses, resolve, { it }, hash, listOf(kind), false)
        if (entries.size + section.entries.size > 100_000) throw XtreamFailure("CATALOG_LIMIT")
        entries.addAll(section.entries)
    }
    fun catalog(): XtreamCatalog {
        check(session.request == null) { "Xtream catalog is still loading" }
        return XtreamCatalog(entries.distinctBy { it.id })
    }
}
