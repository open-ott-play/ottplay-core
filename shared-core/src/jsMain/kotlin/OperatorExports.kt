@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

@JsExport
fun operatorSourceAction(config: dynamic): String = OperatorSession.source(wire(config)).name

@JsExport
fun operatorCredentialsValid(profile: String, key: String, address: String): Boolean = OperatorProfiles.valid(profile, key, address)

@JsExport
fun operatorProfileUrl(profile: String, phase: String, config: dynamic): String = OperatorProfiles.url(profile, phase, wire(config))

@JsExport
fun operatorTvteamPlaylist(value: String): String = OperatorProfiles.tvteamPlaylist(value)

@JsExport
fun operatorCapturedTvteamPlaylist(href: String, dune: Boolean): String = OperatorProfiles.capturedTvteamPlaylist(href, dune)

@JsExport
fun operatorEdemHost(value: String): String = OperatorProfiles.edemHost(value)

@JsExport
fun operatorVodUrl(profile: String, url: String, mac: String): String = OperatorVod.url(profile, url, mac)

@JsExport
fun operatorVodContent(text: String): dynamic {
    val content = OperatorVod.content(text)
    val result: dynamic = js("({})")
    result.format = content.format; result.text = content.text
    return result
}

@JsExport
fun operatorVodCatalog(data: dynamic, previousName: dynamic): dynamic = unwire(OperatorVod.catalog(wire(data), wire(previousName)))

@JsExport
fun operatorClubIds(text: String): Array<String> = OperatorCatalogs.clubIds(text).toTypedArray()

private fun operatorError(error: OperatorCatalogFailure): Nothing {
    val message = when (error.code) {
        "CATEGORIES" -> "r.categories.forEach is not a function"
        "STREAMS" -> "r.live_streams.forEach is not a function"
        "ITV_CHANNELS" -> "data.channels.forEach is not a function"
        "SHURA_CHANNELS" -> "data.forEach is not a function"
        "PORTAL_ITEMS" -> "data.items.forEach is not a function"
        "GUIDE_ITV_ARRAY" -> "data.res.forEach is not a function"
        "GUIDE_SHURA_ARRAY" -> "data.forEach is not a function"
        "MEDIA_SPLIT_METHOD" -> "chanels[ch_id].url.split is not a function"
        "MEDIA_REPLACE_METHOD" -> "url.replace is not a function"
        else -> "Cannot read properties of ${if (error.isNull) "null" else "undefined"} (reading '${when(error.code) { "CATEGORY_ROW" -> "category_id"; "ITV_ROW" -> "ch_id"; "SHURA_ROW" -> "id"; "PORTAL_TYPE" -> "type"; "PORTAL_TITLE" -> "title"; "GUIDE_ITV_ROW" -> "desc"; "GUIDE_SHURA_ROW" -> "text"; "MEDIA_ITV" -> "server_cdn"; "MEDIA_ANTIFRIZ" -> "token"; "MEDIA_ONLY4" -> "url"; "MEDIA_SPLIT" -> "split"; else -> "name" }}')"
    }
    throw js("new TypeError(message)")
}

@JsExport
class OperatorCatalogClient(profile: String) {
    private val catalog = OperatorCatalogs(profile)
    fun accept(data: dynamic, ids: Array<String>) {
        try { catalog.accept(wire(data), ids.toList()) } catch (error: OperatorCatalogFailure) { operatorError(error) }
    }
    fun result(): dynamic = unwire(catalog.result())
}

@JsExport
class OperatorPlaylistClient(url: String, relay: String, intercepted: Boolean, profile: String, encode: (String) -> String) {
    private val plan = OperatorPlaylistRequest(url, relay, intercepted, profile, encode)
    fun interceptUrl(): String = plan.interceptUrl()
    fun progress(): Boolean = plan.progress()
    fun accept() = plan.accept()
    fun reject() = plan.reject()
    fun request(): dynamic {
        val request = plan.request() ?: return null
        val result: dynamic = js("({})")
        result.url = request.url; result.timeout = request.timeout
        if (request.method.isNotEmpty()) result.method = request.method
        if (request.dataType.isNotEmpty()) result.dataType = request.dataType
        request.body?.let { body -> result.data = js("({})"); result.data.url = body }
        return result
    }
}

/** Stable provider identities for the active browser catalog path. */
@JsExport
class OperatorChannelClient(config: dynamic, encode: (String) -> String) {
    private val input = wire(config)
    private val base = input["server"].string()
    private val source = XtreamSource("operator", input["user"].string(), input["pass"].string())
    private val addresses = XtreamAddresses(source, { path, query -> base + "/" + path.joinToString("/") { encode(it) } +
        if (query.isEmpty()) "" else query.joinToString("&", "?") { encode(it.first) + "=" + encode(it.second) } }, encode)
    private val session = OperatorChannelSession(base, addresses)
    fun action(): String = session.action().name
    fun request(): String = session.request()
    fun reject() = session.reject()
    fun accept(value: dynamic) {
        try { session.accept(wire(value)) }
        catch (error: OperatorCatalogFailure) { operatorError(error) }
    }
    fun channelCatalog(): dynamic = channelCatalogRows(session.catalog())
}

/** Compatibility client for consumers of the historical numeric catalog. */
@JsExport
class OperatorClient(config: dynamic, encode: (String) -> String, hash: (dynamic) -> Double) {
    private val input = wire(config)
    private val base = input["server"].string()
    private val source = XtreamSource("operator", input["user"].string(), input["pass"].string())
    private val addresses = XtreamAddresses(source, { path, query -> base + "/" + path.joinToString("/") { encode(it) } +
        if (query.isEmpty()) "" else query.joinToString("&", "?") { encode(it.first) + "=" + encode(it.second) } }, encode)
    private val session = OperatorSession(base, addresses) { hash(unwire(it)) }
    fun action(): String = session.action().name
    fun request(): String = session.request()
    fun reject() = session.reject()
    fun accept(value: dynamic) {
        try { session.accept(wire(value)) }
        catch (error: OperatorCatalogFailure) { operatorError(error) }
    }
    fun catalog(): dynamic {
        val catalog = session.catalog()
        val result: dynamic = js("({})")
        result.ids = catalog.entries.map { it.id }.toTypedArray()
        result.channels = js("Object.create(null)"); result.groups = js("Object.create(null)")
        result.groupOrder = catalog.groupValues.map(::unwire).toTypedArray()
        catalog.groups.forEach { (key, ids) -> result.groups[key] = ids.toTypedArray() }
        catalog.entries.forEach { entry ->
            val row = legacyChannel(entry.name, entry.providerId, entry.category, entry.group, entry.logo, entry.url)
            row.category.name = unwire(entry.groupValue)
            result.channels[entry.id] = row
        }
        return result
    }
}

@JsExport
fun operatorPortalNavigate(input: dynamic, provider: String, portal: String, key: String, decode: (String) -> String): dynamic =
    unwire(OperatorPortal.navigate(wire(input), provider, portal, key, decode))
@JsExport
fun operatorPortalParams(key: String, request: dynamic, limit: dynamic = js("undefined")): dynamic =
    unwire(OperatorPortal.params(key, wire(request), wire(limit)))
@JsExport
fun operatorPortalPage(params: dynamic, selected: Double): dynamic = unwire(OperatorPortal.page(wire(params), selected))
@JsExport
fun operatorPortalItem(item: dynamic, parent: dynamic): dynamic {
    try { return unwire(OperatorPortal.item(wire(item), wire(parent))) }
    catch (error: OperatorCatalogFailure) { operatorError(error) }
}
@JsExport
fun operatorPortalMedia(item: dynamic, description: String): dynamic = unwire(OperatorPortal.media(wire(item), description))
@JsExport
fun operatorPortalFilter(item: dynamic, root: Boolean): dynamic = unwire(OperatorPortal.filter(wire(item), root))
@JsExport
fun operatorPortalVariants(variants: dynamic, url: dynamic): dynamic = unwire(OperatorPortal.variants(wire(variants), wire(url)))
@JsExport
fun operatorPortalSelection(selected: Double, offset: Double, limit: Double, lazy: Array<Boolean>): Double =
    OperatorPortal.selection(selected, offset, limit, lazy.toList())
@JsExport
class OperatorPortalCatalogClient(data: dynamic, page: Boolean) {
    private val catalog = OperatorPortalCatalog(wire(data), page)
    fun named(): Boolean = catalog.named()
    fun next(): dynamic {
        try { return unwire(catalog.next()) }
        catch (error: OperatorCatalogFailure) { operatorError(error) }
    }
}

@JsExport
class OperatorRequestClient {
    private val lifetime = OperatorRequestLifetime()
    fun active(): Boolean = lifetime.active
    fun begin(): Int = lifetime.begin()
    fun accept(id: Int): Boolean = lifetime.accept(id)
    fun failed(id: Int) = lifetime.failed(id)
    fun attach(id: Int): String = lifetime.attach(id)
    fun end(): Array<Int>? = lifetime.end()?.toTypedArray()
}
@JsExport
class OperatorLifetimeClient {
    private val lifetime = OperatorLifetime<dynamic, dynamic, dynamic>()
    fun nextGeneration(): Int = lifetime.nextGeneration()
    fun session(source: String): dynamic = lifetime.session(source)
    fun catalog(source: String): dynamic = lifetime.catalog(source)
    fun setSession(source: String, value: dynamic) = lifetime.setSession(source, value)
    fun setCatalog(source: String, value: dynamic) = lifetime.setCatalog(source, value)
    fun series(api: String, id: String): dynamic = lifetime.series(api, id)
    fun setSeries(api: String, id: String, value: dynamic) = lifetime.setSeries(api, id, value)
    fun close(source: String) = lifetime.close(source)
    fun library(source: String): dynamic {
        val catalog = lifetime.catalog(source) ?: return js("[]")
        val rows: Array<dynamic> = catalog.channels
        return OperatorLifetime.libraryIndices(rows.map { wire(it.kind).string() }).map { rows[it] }.toTypedArray()
    }
    fun seriesResult(value: dynamic, folderType: String, seasonNumber: String): dynamic {
        val section = OperatorLifetime.seriesSection(folderType, seasonNumber)
        val rows: dynamic = if (section == null) value.folders else value.episodes[section] ?: js("[]")
        val result: dynamic = js("({})")
        result.items = rows.slice(0)
        result.warnings = value.warnings.slice(0)
        return result
    }
}

private fun operatorSourceError(error: OperatorSourceFailure): Nothing {
    val code = error.code
    val message = when (code) {
        "SOURCE_ID" -> "A persistent source ID is required"
        "SOURCE_URL" -> "An absolute HTTP or HTTPS source URL is required"
        "UNSUPPORTED_PROVIDER" -> "This provider type is not supported"
        "SOURCE_CREDENTIALS" -> "Xtream requires a username and password"
        else -> code
    }
    val native: dynamic = js("new Error(message)")
    native.code = code
    throw native
}
@JsExport
fun operatorSourceNamespace(source: dynamic): String {
    try { return OperatorSources.namespace(wire(source).get("id")) }
    catch (error: OperatorSourceFailure) { operatorSourceError(error) }
}
@JsExport
fun operatorBrowserConfig(source: dynamic, checkedUrl: String): dynamic {
    try { return unwire(OperatorSources.browser(wire(source), checkedUrl)) }
    catch (error: OperatorSourceFailure) { operatorSourceError(error) }
}
@JsExport
fun operatorSourceRelationship(mode: String, kind: String, sourceId: String, entryKind: String, entrySourceId: String): String =
    OperatorSources.relationship(mode, kind, sourceId, entryKind, entrySourceId)

@JsExport
fun operatorLiveUrl(profile: String, id: String, channel: dynamic, options: dynamic): String {
    try { return OperatorMedia.live(profile, id, wire(channel), wire(options)) }
    catch (error: OperatorCatalogFailure) { operatorError(error) }
}
@JsExport
fun operatorGuideUrl(profile: String, id: String, options: dynamic, phase: String): String =
    OperatorMedia.guideUrl(profile, id, wire(options), phase)
@JsExport
fun operatorVodRoot(profile: String, url: String, key: String): String = OperatorMedia.vodRoot(profile, url, key)
@JsExport
class OperatorGuideClient(profile: String, current: Boolean = false) {
    private val guide = OperatorGuide(profile, current)
    fun phase(): String = guide.phase()
    fun complete() = guide.complete()
    fun result(): dynamic = unwire(guide.result())
    fun accept(data: dynamic, phase: String, rec: dynamic) {
        try { guide.accept(wire(data), phase, wire(rec)) }
        catch (error: OperatorCatalogFailure) { operatorError(error) }
    }
}
