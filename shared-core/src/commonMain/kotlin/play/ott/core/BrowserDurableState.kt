package play.ott.core

class DurableStateFailure(message: String) : IllegalArgumentException(message)

/** Validated durable JSON. Hosts perform JSON/storage/URI decoding and cryptographic effects. */
object BrowserDurableState {
    val fonts = listOf("system", "Roboto", "RobotoCondensed", "Caveat", "Liberation", "Gabriela", "PTSansNarrow")
    private fun text(v: String) = ProviderValue.text(v)
    private fun number(v: Number) = ProviderValue(ProviderValueKind.NUMBER, v.toString())
    private fun bool(v: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, v.toString())
    private fun obj(vararg fields: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*fields))
    private fun array(v: List<ProviderValue> = emptyList()) = ProviderValue.array(v)
    private fun isText(v: ProviderValue) = v.kind == ProviderValueKind.TEXT
    private fun finite(v: ProviderValue) = v.kind == ProviderValueKind.NUMBER && v.number().isFinite()
    private fun strict(v: ProviderValue, target: String) = isText(v) && v.scalar == target
    private fun strictNumber(v: ProviderValue, target: Double) = v.kind == ProviderValueKind.NUMBER && v.number() == target
    private fun strictTrue(v: ProviderValue) = v.kind == ProviderValueKind.BOOLEAN && v.scalar == "true"
    private fun strictFalse(v: ProviderValue) = v.kind == ProviderValueKind.BOOLEAN && v.scalar == "false"
    private fun properties(v: ProviderValue): Map<String, ProviderValue> = if (v.isArray) v.elements.mapIndexed { i, value -> i.toString() to value }.toMap() else v.properties
    private fun fail(message: String): Nothing = throw DurableStateFailure(message)
    private fun validStream(value: String): Boolean {
        val parts = value.split('-')
        return parts.size == 2 && parts.all { part -> part.length in 1..8 && part.all { it in '0'..'9' || it in 'a'..'f' } }
    }
    fun safeKey(v: ProviderValue): Boolean = isText(v) && DurableSelections.safeListName(v.scalar)
    fun channelKey(v: ProviderValue): Boolean = isText(v) && v.scalar.isNotEmpty() && v.scalar.length <= 4096 && v.scalar !in setOf("__proto__", "constructor", "prototype")
    private fun http(v: ProviderValue) = isText(v) && (v.scalar.lowercase().startsWith("http://") || v.scalar.lowercase().startsWith("https://"))

    fun defaults(security: ProviderValue): ProviderValue = obj(
        "schema" to number(1), "sources" to array(), "activeSourceId" to text(""), "lastChannel" to ProviderValue.nil, "previousChannel" to ProviderValue.nil,
        "playbackPreferences" to array(), "channelReferences" to array(), "favorites" to obj("default" to array()), "activeFavorites" to text("default"),
        "history" to array(), "bookmarks" to obj(), "channelOverrides" to obj(), "favoriteItems" to obj(), "reminders" to array(), "security" to security,
        "settings" to obj("language" to text("en"), "interfaceVersion" to number(2), "startupVersion" to number(1), "fontFamily" to text("RobotoCondensed"),
            "playerEngine" to text("auto"), "streamFormat" to text("auto"), "fontScale" to number(1), "volume" to number(0.8), "muted" to bool(false),
            "epgUrl" to text(""), "epgUrls" to array(), "restore" to bool(true), "accent" to text("amber"), "aspect" to text("auto"), "zoom" to number(1), "relay" to bool(false)))

    fun validate(value: ProviderValue, securityDefault: () -> ProviderValue, securityValidate: (ProviderValue) -> ProviderValue,
                 decode: (String) -> String, stringify: (ProviderValue) -> String = { it.string() }): ProviderValue {
        if (!value.truthy() || !strictNumber(value["schema"], 1.0) || !value["sources"].isArray) fail("Unsupported settings format")
        val result = LinkedHashMap(defaults(securityDefault()).properties)
        val sources = value["sources"].elements
        if (sources.size > 100) fail("Too many sources")
        val seen = mutableSetOf<String>()
        fun fallback(v: ProviderValue, default: ProviderValue) = if (v.truthy()) v else default
        result["sources"] = array(sources.map { source ->
            val id = source["id"]
            if (!source.truthy() || !safeKey(id) || id.scalar in seen || !isText(source["type"]) || source["type"].scalar !in listOf("m3u", "xtream", "stalker")) fail("Invalid source")
            val url = source["url"]
            if (!isText(url) || url.truthy() && !http(url)) fail("Invalid source URL")
            if (source.properties.containsKey("text") && (!isText(source["text"]) || source["text"].scalar.length > 10 * 1024 * 1024 || source["text"].truthy() && !strict(source["type"], "m3u"))) fail("Invalid playlist content")
            seen += id.scalar
            obj("id" to id, "name" to text(stringify(fallback(source["name"], id)).take(160)), "type" to source["type"], "url" to url,
                "text" to fallback(source["text"], text("")), "username" to text(stringify(fallback(source["username"], text("")))),
                "password" to text(stringify(fallback(source["password"], text("")))), "mac" to text(stringify(fallback(source["mac"], text("")))),
                "timezone" to text(stringify(fallback(source["timezone"], text("UTC"))).take(100)), "language" to text(stringify(fallback(source["language"], text("en"))).take(10)),
                "output" to text(if (strict(source["output"], "ts")) "ts" else "m3u8"))
        })
        result["activeSourceId"] = if (stringify(value["activeSourceId"]) in seen) value["activeSourceId"] else result.getValue("sources").elements.firstOrNull()?.get("id") ?: text("")
        fun reference(input: ProviderValue): ProviderValue? {
            if (!input.isObject || !safeKey(input["sourceId"]) || input["sourceId"].scalar !in seen || !channelKey(input["id"])) return null
            val id = input["id"].scalar
            val owner = decode(id.substringBefore(':'))
            if (':' in id && owner in seen && owner != input["sourceId"].scalar) return null
            val output = linkedMapOf("sourceId" to input["sourceId"], "id" to input["id"])
            listOf("tvgId", "tvgName", "name", "group").forEach { field ->
                if (isText(input[field])) CoreText.trim(input[field].scalar).take(512).takeIf { it.isNotEmpty() }?.let { output[field] = text(it) }
            }
            return ProviderValue.obj(output)
        }
        val referenceIds = mutableSetOf<String>()
        result["channelReferences"] = array(value["channelReferences"].elements.take(50000).mapNotNull { entry ->
            val ref = reference(entry) ?: return@mapNotNull null
            if (!referenceIds.add(ref["id"].scalar)) return@mapNotNull null
            val output = LinkedHashMap(ref.properties)
            if (isText(entry["kind"]) && entry["kind"].scalar in listOf("live", "vod", "folder")) output["kind"] = entry["kind"]
            if (isText(entry["stream"]) && validStream(entry["stream"].scalar)) output["stream"] = entry["stream"]
            ProviderValue.obj(output)
        })
        result["lastChannel"] = reference(value["lastChannel"]) ?: ProviderValue.nil
        result["previousChannel"] = reference(value["previousChannel"]) ?: ProviderValue.nil
        fun track(input: ProviderValue): ProviderValue? {
            if (!input.isObject) return null
            if (strictTrue(input["off"])) return obj("off" to bool(true))
            val output = linkedMapOf("language" to text(if (isText(input["language"])) input["language"].scalar.take(80) else ""),
                "label" to text(if (isText(input["label"])) input["label"].scalar.take(160) else ""))
            val id = stringify(input["id"])
            if (id.length in 1..4 && id.all { it in '0'..'9' } && isText(input["backend"]) && input["backend"].scalar in listOf("native", "hls.js", "shaka", "mpegts")) {
                output["id"] = text(id); output["backend"] = input["backend"]
            }
            return if (output.values.any { it.truthy() }) ProviderValue.obj(output) else null
        }
        val preferenceIds = mutableSetOf<Pair<String, String>>()
        result["playbackPreferences"] = array(value["playbackPreferences"].elements.take(200).mapNotNull { entry ->
            val ref = reference(entry["reference"]); val audio = track(entry["audio"]); val subtitle = track(entry["subtitle"])
            if (ref == null || !preferenceIds.add(ref["sourceId"].scalar to ref["id"].scalar)) return@mapNotNull null
            val output = linkedMapOf("reference" to ref)
            if (audio != null && !strictTrue(audio["off"])) output["audio"] = audio
            if (subtitle != null) output["subtitle"] = subtitle
            if (isText(entry["aspect"]) && entry["aspect"].scalar in listOf("auto", "16:9", "4:3", "fill")) output["aspect"] = entry["aspect"]
            if (entry["zoom"].kind == ProviderValueKind.NUMBER && entry["zoom"].number() in listOf(1.0, 1.1, 1.25, 1.5)) output["zoom"] = entry["zoom"]
            ProviderValue.obj(output)
        })
        val favorites = linkedMapOf("default" to array())
        if (value["favorites"].isObject) value["favorites"].properties.forEach { (name, list) ->
            if (DurableSelections.safeListName(name)) {
                if (!list.isArray || list.elements.size > 50000) fail("Invalid favorites")
                val ids = mutableSetOf<String>()
                favorites[name] = array(list.elements.filter { isText(it) && it.scalar.length < 4096 && ids.add(it.scalar) })
            }
        }
        result["favorites"] = ProviderValue.obj(favorites)
        result["activeFavorites"] = if (favorites.containsKey(stringify(value["activeFavorites"]))) value["activeFavorites"] else text("default")
        result["history"] = array(value["history"].elements.filter { isText(it["id"]) && isText(it["name"]) && finite(it["time"]) }.take(100).map { obj("id" to it["id"], "name" to it["name"], "time" to it["time"]) })
        result["bookmarks"] = ProviderValue.obj(properties(value["bookmarks"]).filter { (name, p) -> channelKey(text(name)) && finite(p) && p.number() >= 0 })
        if (value["security"].truthy()) result["security"] = securityValidate(value["security"])
        result["channelOverrides"] = ProviderValue.obj(properties(value["channelOverrides"]).entries.take(50000).mapNotNull { (id, entry) ->
            if (!channelKey(text(id)) || !entry.present || !(entry.isObject || entry.isArray)) return@mapNotNull null
            val row = linkedMapOf("hidden" to bool(strictTrue(entry["hidden"])))
            listOf("name", "group").forEach { if (isText(entry[it])) row[it] = text(entry[it].scalar.take(160)) }
            if (finite(entry["order"])) row["order"] = number(entry["order"].number().coerceIn(0.0, 50000.0))
            id to ProviderValue.obj(row)
        }.toMap())
        result["favoriteItems"] = ProviderValue.obj(properties(value["favoriteItems"]).entries.take(10000).mapNotNull { (id, entry) ->
            if (!channelKey(text(id)) || !safeKey(entry["sourceId"]) || !isText(entry["name"]) || !entry["parents"].isArray || entry["parents"].elements.size > 20 || !entry["parents"].elements.all(::channelKey)) return@mapNotNull null
            id to obj("name" to text(entry["name"].scalar.take(160)), "sourceId" to entry["sourceId"], "parents" to entry["parents"])
        }.toMap())
        result["reminders"] = array(value["reminders"].elements.filter { entry ->
            isText(entry["id"]) && entry["id"].scalar.length <= 4130 && channelKey(entry["channelId"]) && isText(entry["title"]) && finite(entry["start"]) && finite(entry["end"]) && entry["end"].number() > entry["start"].number()
        }.takeLast(500).map { obj("id" to it["id"], "channelId" to it["channelId"], "title" to text(it["title"].scalar.take(500)), "start" to it["start"], "end" to it["end"]) })
        val settings = value["settings"]; val normalized = LinkedHashMap(result.getValue("settings").properties)
        fun option(key: String, choices: List<String>, fallback: String) { normalized[key] = if (isText(settings[key]) && settings[key].scalar in choices) settings[key] else text(fallback) }
        fun numericOption(key: String, choices: List<Double>, fallback: Double) { normalized[key] = if (settings[key].kind == ProviderValueKind.NUMBER && settings[key].number() in choices) settings[key] else number(fallback) }
        option("language", listOf("ru"), "en"); option("fontFamily", fonts, "RobotoCondensed")
        if (!settings["interfaceVersion"].truthy() && normalized["fontFamily"]?.scalar == "system") normalized["fontFamily"] = text("RobotoCondensed")
        option("playerEngine", listOf("auto", "native", "hls.js", "shaka", "mpegts"), "auto")
        option("streamFormat", listOf("auto", "hls", "dash", "mpegts", "flv", "file"), "auto")
        numericOption("fontScale", listOf(0.85, 1.0, 1.15, 1.3), 1.0)
        normalized["volume"] = number(if (finite(settings["volume"])) settings["volume"].number().coerceIn(0.0, 1.0) else 0.8)
        normalized["muted"] = bool(strictTrue(settings["muted"]))
        normalized["restore"] = bool(!strictNumber(settings["startupVersion"], 1.0) || !strictFalse(settings["restore"]))
        normalized["relay"] = bool(strictTrue(settings["relay"]))
        option("accent", listOf("amber", "blue", "green"), "amber"); option("aspect", listOf("auto", "16:9", "4:3", "fill"), "auto")
        numericOption("zoom", listOf(1.0, 1.1, 1.25, 1.5), 1.0)
        val epg = mutableSetOf<String>()
        normalized["epgUrls"] = array(settings["epgUrls"].elements.filter { http(it) && epg.add(it.scalar) }.take(10))
        normalized["epgUrl"] = if (http(settings["epgUrl"])) settings["epgUrl"] else text("")
        result["settings"] = ProviderValue.obj(normalized)
        return ProviderValue.obj(result)
    }

    fun removeSources(previous: ProviderValue, next: ProviderValue, encode: (String) -> String): ProviderValue {
        val result = LinkedHashMap(next.properties)
        previous["sources"].elements.forEach { source ->
            if (next["sources"].isArray && next["sources"].elements.any { it["id"].kind == source["id"].kind && it["id"].scalar == source["id"].scalar }) return@forEach
            val prefix = encode(source["id"].scalar) + ":"
            val owned = previous["channelReferences"].elements.filter { it["sourceId"].scalar == source["id"].scalar }.map { it["id"].scalar }.toMutableSet()
            previous["favoriteItems"].properties.forEach { (id, entry) -> if (entry["sourceId"].scalar == source["id"].scalar) owned += id }
            fun keep(id: ProviderValue) = !isText(id) || !id.scalar.startsWith(prefix) && id.scalar !in owned
            val favorites = result["favorites"] ?: ProviderValue.missing
            if (favorites.isObject || favorites.isArray) result["favorites"] = ProviderValue.obj(properties(favorites).mapValues { (_, list) -> if (list.isArray) array(list.elements.filter(::keep)) else list })
            listOf("bookmarks", "channelOverrides", "favoriteItems").forEach { field ->
                val current = result[field] ?: ProviderValue.missing
                if (current.isObject) result[field] = ProviderValue.obj(current.properties.filterKeys { keep(text(it)) })
            }
            listOf("history" to "id", "reminders" to "channelId").forEach { (field, id) ->
                val current = result[field] ?: ProviderValue.missing
                if (current.isArray) result[field] = array(current.elements.filter { keep(it[id]) })
            }
            val security = result["security"] ?: ProviderValue.missing
            if (security["protectedIds"].isArray) result["security"] = ProviderValue.obj(security.properties + ("protectedIds" to array(security["protectedIds"].elements.filter(::keep))))
        }
        return ProviderValue.obj(result)
    }

    fun export(state: ProviderValue, includeCredentials: Boolean): ProviderValue {
        if (includeCredentials) return state
        return ProviderValue.obj(state.properties + mapOf("sources" to array(), "activeSourceId" to text(""), "lastChannel" to ProviderValue.nil,
            "previousChannel" to ProviderValue.nil, "playbackPreferences" to array(), "channelReferences" to array(),
            "settings" to ProviderValue.obj(state["settings"].properties + mapOf("epgUrl" to text(""), "epgUrls" to array()))))
    }

    fun recordHistory(history: ProviderValue, id: String, name: ProviderValue, time: Double): ProviderValue =
        array((listOf(obj("id" to text(id), "name" to name, "time" to number(time))) + history.elements.filter { !strict(it["id"], id) }).take(100))

    fun removeHistory(history: ProviderValue, id: String): ProviderValue = array(history.elements.filter { !strict(it["id"], id) })

}
