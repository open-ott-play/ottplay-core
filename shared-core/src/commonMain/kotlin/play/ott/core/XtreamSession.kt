package play.ott.core

enum class XtreamFormat { BROWSER, ANDROID, LEGACY }
class XtreamFailure(val code: String) : Exception(code)
data class XtreamNotice(val code: String, val kind: String, val status: Int)
data class XtreamRequest(val action: String, val params: Map<String, String> = emptyMap())

/** Pure request/response machine. It never performs HTTP or stores a credential. */
class XtreamSession(val format: XtreamFormat, private val onSection: (String, Map<String, ProviderValue>) -> Unit = { _, _ -> }) {
    private var stage = -1
    private var finished = false
    private val browserOrder = listOf("get_live_categories", "get_live_streams", "get_vod_categories", "get_vod_streams", "get_series_categories", "get_series")
    private val androidOrder = listOf("get_live_streams", "get_live_categories", "get_vod_streams", "get_vod_categories", "get_series", "get_series_categories")
    private val order get() = if (format == XtreamFormat.BROWSER) browserOrder else androidOrder
    val data = linkedMapOf<String, ProviderValue>()
    val notices = mutableListOf<XtreamNotice>()
    var account: ProviderValue = ProviderValue.missing
        private set
    val request: XtreamRequest? get() = if (finished) null else XtreamRequest(if (stage < 0) "" else order[stage])
    val timezone get() = account["server_info"]["timezone"].primitive().ifBlank { "UTC" }

    fun accept(response: ProviderValue) {
        check(!finished) { "Xtream request already completed" }
        if (stage < 0) {
            account = response
            val user = response["user_info"]
            when (format) {
                XtreamFormat.BROWSER -> {
                    if (!response.truthy() || !user.truthy() || user["auth"].string() != "1" ||
                        user["status"].truthy() && user["status"].string().lowercase() != "active") throw XtreamFailure("BROWSER_AUTH")
                }
                XtreamFormat.ANDROID -> {
                    if (!response.isObject) throw XtreamFailure("ACCOUNT_FORMAT")
                    if (user["auth"].primitive() in listOf("0", "false")) throw XtreamFailure("AUTH")
                    val status = user["status"].primitive()
                    if (status.isNotBlank() && !status.equals("active", true)) throw XtreamFailure("INACTIVE")
                }
                XtreamFormat.LEGACY -> {
                    if (!response["live_streams"].truthy()) throw XtreamFailure("LEGACY_CATALOG")
                    if (!response["live_streams"].isArray || response["categories"].truthy() && !response["categories"].isArray) throw XtreamFailure("LEGACY_CATALOG")
                    data["get_live_streams"] = response["live_streams"]
                    data["get_live_categories"] = if (response["categories"].isArray) response["categories"] else ProviderValue.array()
                    finished = true; return
                }
            }
            if (format == XtreamFormat.ANDROID && response["live_streams"].isArray) {
                data["get_live_streams"] = response["live_streams"]
                data["get_live_categories"] = if (response["categories"].isArray) response["categories"] else ProviderValue.array()
                onSection("live", data)
                stage = 2
            } else stage = 0
            return
        }
        val action = order[stage]
        if (format == XtreamFormat.BROWSER && response["user_info"].truthy() && response["user_info"]["auth"].string() != "1") throw XtreamFailure("RESPONSE_AUTH")
        if (!response.isArray) throw XtreamFailure(if (format == XtreamFormat.BROWSER) "BROWSER_CATALOG" else if (action.endsWith("categories")) "CATEGORY_FORMAT" else "CATALOG_FORMAT")
        data[action] = response
        if (format == XtreamFormat.ANDROID && action.endsWith("categories")) onSection(section(action), data)
        advance()
    }
    /** Returns false when the host must propagate its original transport error. */
    fun reject(status: Int?): Boolean {
        if (finished || stage < 0 || format != XtreamFormat.ANDROID || status !in listOf(404, 405, 501)) return false
        val action = order[stage]
        val categories = action.endsWith("categories")
        val kind = if (action.contains("live")) "LIVE" else if (action.contains("vod")) "MOVIE" else "SERIES"
        if (!categories && kind == "LIVE") return false
        notices.add(XtreamNotice(if (categories) "GROUPS" else "SECTION", kind, status!!))
        data[action] = ProviderValue.array()
        if (!categories) { stage++; data[order[stage]] = ProviderValue.array() }
        onSection(section(action), data)
        advance()
        return true
    }
    private fun section(action: String) = if (action.contains("live")) "live" else if (action.contains("vod")) "vod" else "series"
    private fun advance() { stage++; if (stage == order.size) finished = true }
}

data class XtreamSource(val id: String, val username: String, val password: String, val output: String = "m3u8") {
    override fun toString() = "XtreamSource(id=$id)"
}

/** The host renders a path/query with its URL library; the core chooses routes and parameter order. */
class XtreamAddresses(val source: XtreamSource, private val render: (List<String>, List<Pair<String, String>>) -> String,
    private val segment: (String) -> String) {
    private fun credentials() = listOf("username" to source.username, "password" to source.password)
    fun api(request: XtreamRequest) = render(listOf("player_api.php"), credentials() +
        (if (request.action.isNotEmpty()) listOf("action" to request.action) else emptyList()) + request.params.toList())
    fun epg() = render(listOf("xmltv.php"), credentials())
    fun stream(type: String, id: String, extension: String) = render(listOf(type, source.username, source.password, "$id.$extension"), emptyList())
    fun legacyShortEpg(id: String) = api(XtreamRequest("")) + "&action=get_short_epg&stream_id=" + id
    fun legacyStream(id: String) = render(listOf("live", source.username, source.password), emptyList()) + "/$id.m3u8"
    fun legacyPlaylist(base: String, networkFailure: Boolean): String {
        val endpoint = if (networkFailure) {
            base.trimEnd('/') + "/get.php?username=" + segment(source.username) + "&password=" + segment(source.password)
        } else {
            CoreText.replaceLiteralFirst(api(XtreamRequest("")), "/player_api.php", "/get.php")
        }
        return endpoint + "&type=m3u_plus&output=ts"
    }
    fun archive(id: String) = render(listOf("timeshift", source.username, source.password), emptyList()).trimEnd('/') +
        "/{durationMinutes}/{startDate}/" + segment("$id.ts")
    companion object {
        fun browserBase(value: String): String {
            val clean = value.substringBefore('?').substringBefore('#')
            val candidate = clean.removeSuffix("/")
            val last = candidate.substringAfterLast('/').lowercase()
            return (if (last in listOf("player_api.php", "get.php", "xmltv.php")) candidate.substringBeforeLast('/') else clean).trimEnd('/')
        }
        fun nativeBaseSegments(segments: List<String>): List<String> {
            val paths = segments.filter(String::isNotBlank)
            return if (paths.lastOrNull() in listOf("player_api.php", "get.php", "xmltv.php")) paths.dropLast(1) else paths
        }
    }
}
