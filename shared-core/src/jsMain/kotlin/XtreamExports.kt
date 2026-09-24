@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

@JsExport
fun xtreamBase(value: String): String = XtreamAddresses.browserBase(value)

@JsExport
class XtreamClient(input: dynamic, legacy: Boolean,
    render: (Array<String>, Array<Array<String>>) -> String, resolve: (String) -> String,
    component: (String) -> String, identity: (Array<String>) -> String) {
    private val source = XtreamSource(input.id.unsafeCast<String>(), input.username.unsafeCast<String>(), input.password.unsafeCast<String>(), input.output.unsafeCast<String>())
    private val base = input.base.unsafeCast<String>()
    private val session = XtreamSession(if (legacy) XtreamFormat.LEGACY else XtreamFormat.BROWSER)
    private val addresses = XtreamAddresses(source, { path, query -> render(path.toTypedArray(), query.map { arrayOf(it.first, it.second) }.toTypedArray()) }, component)
    private val resolveUrl = resolve
    private val encode = component
    private val identify = { values: List<String> -> identity(values.toTypedArray()) }
    fun request(): String? = session.request?.let(addresses::api)
    fun accept(value: dynamic): dynamic = try { session.accept(wire(value)); null } catch (error: XtreamFailure) { failure(error.code) }
    fun catalog(): dynamic = try {
        val catalog = XtreamCatalogs.catalog(session.data, XtreamFormat.BROWSER, source, addresses, resolveUrl, encode, identify)
        val result: dynamic = js("({})")
        result.channels = catalog.entries.map { item(it) }.toTypedArray()
        result.epgUrls = arrayOf(addresses.epg()); result.warnings = catalog.warnings.toTypedArray()
        result
    } catch (error: XtreamFailure) { failure(error.code) }
    fun shortEpgUrl(id: String): String = addresses.legacyShortEpg(id)
    fun fallbackPlaylist(networkFailure: Boolean): String = addresses.legacyPlaylist(base,networkFailure)
    fun guide(data: dynamic, clock: (dynamic) -> Double): dynamic = legacyGuide(LegacyXtream.guide(wire(data)) { clock(unwire(it)) })
    fun channelCatalog(): dynamic = channelCatalogRows(ChannelCatalog.xtream(session.data, addresses))
    fun legacyCatalog(hash: (dynamic) -> Double): dynamic {
        val catalog = LegacyXtream.catalog(session.data, addresses) { hash(unwire(it)) }
        val result: dynamic = js("({})")
        result.ids = catalog.entries.map { it.id }.toTypedArray()
        result.channels = js("Object.create(null)"); result.groups = js("Object.create(null)")
        result.groupOrder = catalog.groupOrder.toTypedArray()
        catalog.groups.forEach { (key, ids) -> result.groups[key] = ids.toTypedArray() }
        catalog.entries.forEach { entry ->
            result.channels[entry.id] = legacyChannel(entry.name,entry.providerId,entry.category,entry.group,entry.logo,entry.url)
        }
        return result
    }
    fun seriesRequest(parentValue: dynamic): dynamic = try {
        val parent = wire(parentValue)
        val result: dynamic = js("({})")
        result.url = addresses.api(XtreamCatalogs.seriesRequest(parent["seriesId"], parent["folderType"].string(), XtreamFormat.BROWSER))
        result
    } catch (error: XtreamFailure) { failure(error.code) }
    fun series(data: dynamic, parentValue: dynamic): dynamic = try {
        val node = wire(parentValue)
        val parent = XtreamSeriesParent(node["seriesId"].string(), if (node["name"].truthy()) node["name"].string() else "",
            if (node["logo"].truthy()) node["logo"].string() else "", if (node["description"].truthy()) node["description"].string() else "", node["adult"].truthy())
        val series = XtreamCatalogs.episodes(wire(data), XtreamFormat.BROWSER, source, addresses, parent, resolveUrl, encode, identify)
        val result: dynamic = js("({})")
        result.episodes = js("Object.create(null)")
        series.entries.groupBy { it.season }.forEach { (key, rows) -> result.episodes["$" + key] = rows.map { item(it) }.toTypedArray() }
        result.folders = XtreamCatalogs.seasons(series, source, parent, encode).map { item(it) }.toTypedArray()
        result.warnings = series.warnings.toTypedArray()
        result
    } catch (error: XtreamFailure) { failure(error.code) }
    private fun item(entry: XtreamItem): dynamic {
        val result: dynamic = js("({})")
        result.id = entry.id; result.name = entry.name; result.group = entry.group; result.logo = entry.logo
        result.kind = when (entry.kind) { "series", "season" -> "folder"; "episode" -> "vod"; else -> entry.kind }
        result.sourceId = source.id; result.description = entry.description; result.adult = entry.adult
        if (entry.kind != "season") result.url = entry.url
        if (entry.kind == "series" || entry.kind == "season") {
            result.folderType = entry.kind; result.seriesId = entry.providerId
            if (entry.kind == "season") result.seasonNumber = entry.season
        }
        if (entry.kind == "episode") { result.episodeNumber = entry.episode; result.seasonNumber = entry.season }
        else if (entry.kind != "season") { result.tvgId = entry.epgId; result.epgUrls = if (entry.kind == "live") arrayOf(addresses.epg()) else emptyArray<String>() }
        entry.archiveDays?.let { days ->
            result.archiveDays = days
            val archive: dynamic = js("({})")
            archive.type = "xtream"; archive.days = days; archive.base = base; archive.username = source.username; archive.password = source.password
            archive.streamId = entry.providerId; archive.extension = source.output; archive.correction = 0
            result.catchup = archive
        }
        return result
    }
}

/** Shared JS URL codec for classic providers; routes are selected by commonMain. */
@JsExport
fun legacyXtreamClient(base: String, username: String, password: String, encode: (String)->String): XtreamClient {
    val source: dynamic=js("({})");source.id="xtream";source.base=base;source.username=username;source.password=password;source.output="m3u8"
    return XtreamClient(source,true,{path,query->base+"/"+path.joinToString("/"){encode(it)}+
        if(query.isEmpty())"" else query.joinToString("&","?"){encode(it[0])+"="+encode(it[1])}}, {it},encode,{""})
}
