package play.ott.core

/** Operator stream and guide request policy. Native clocks/parsers and HTTP remain adapters. */
object OperatorMedia {
    private fun variant(options: List<String>, value: ProviderValue): String =
        options.indices.firstOrNull { it.toString() == value.string() }?.let { options[it] } ?: "undefined"
    fun live(profile: String, id: String, channel: ProviderValue, options: ProviderValue): String {
        if (!channel.present && profile in listOf("itv", "antifriz", "only4"))
            throw OperatorCatalogFailure("MEDIA_" + profile.uppercase(), channel.kind == ProviderValueKind.NULL)
        if (profile == "only4" && channel["url"].kind != ProviderValueKind.TEXT)
            throw OperatorCatalogFailure(if (channel["url"].present) "MEDIA_SPLIT_METHOD" else "MEDIA_SPLIT", channel["url"].kind == ProviderValueKind.NULL)
        if (profile == "edem" && channel["url"].truthy() && channel["url"].kind != ProviderValueKind.TEXT)
            throw OperatorCatalogFailure("MEDIA_REPLACE_METHOD")
        val mode = options["mode"]
        return when (profile) {
            "itv" -> "http://" + channel["server_cdn"].string() + "/$id/" + variant(listOf("index.m3u8", "mpegts", "video.m3u8"), mode) + "?token=" + channel["token"].string()
            "ottclub" -> "http://" + options["server"].string() + "/stream/" + options["key"].string() + "/$id.m3u8"
            "shura" -> "http://s" + options["server"].string() + ".tvshka.net/~" + options["key"].string() + "/$id/" + if (mode.truthy()) "" else "hls/pl.m3u8"
            "antifriz" -> "http://" + channel["server"].string() + ":80/$id/" + variant(listOf("index.m3u8", "mpegts", "video.m3u8", "mono.m3u8", "index.mpd"), if (mode.truthy()) mode else options["hls"]) + "?token=" + channel["token"].string()
            "only4" -> {
                val pieces = channel["url"].string().split("index.m3u8")
                pieces.first() + variant(listOf("mpegts", "video.m3u8", "index.m3u8"), mode) + (pieces.getOrNull(1) ?: "undefined")
            }
            "edem" -> {
                val host = OperatorProfiles.edemHost(if (options["host"].truthy()) options["host"].string() else "")
                val key = if (options["key"].truthy()) options["key"].string() else "1"
                if (host.isEmpty()) ""
                else if (channel["url"].truthy()) replaceFirst(replaceFirst(channel["url"].string(), "localhost", host), "00000000000000", key)
                else "http://$host/iptv/$key/$id/index.m3u8"
            }
            else -> error("Unknown operator media profile")
        }
    }
    // Native String.replace string substitution tokens, without creating a RegExp on old engines.
    private fun replaceFirst(input: String, match: String, replacement: String): String {
        val at = input.indexOf(match)
        if (at < 0) return input
        val prefix = input.substring(0, at); val suffix = input.substring(at + match.length)
        val expanded = buildString {
            var index = 0
            while (index < replacement.length) {
                val current = replacement[index++]
                val next = replacement.getOrNull(index)
                if (current == '$' && next in listOf('$', '&', '`', '\'')) {
                    append(when (next) { '$' -> "$"; '&' -> match; '`' -> prefix; else -> suffix }); index++
                } else append(current)
            }
        }
        return prefix + expanded + suffix
    }
    fun archiveZero(value: ProviderValue): Boolean = when (value.kind) {
        ProviderValueKind.NUMBER -> value.number() == 0.0
        ProviderValueKind.TEXT -> value.scalar == "0"
        ProviderValueKind.BOOLEAN -> value.scalar == "false"
        else -> false
    }
    fun guideUrl(profile: String, id: String, options: ProviderValue, phase: String): String = when (profile) {
        "itv" -> options["base"].string() + "epg/$id" + if (phase == "all") "" else "/" + (options["next"].number() + 2).toInt()
        "ottclub" -> "http://" + options["server"].string() + "/api/channel/$id"
        "shura" -> "http://s" + options["server"].string() + ".tvshka.net/$id/epg/" + when (phase) {
            "week" -> "week.jsonp"; "current" -> "pf.jsonp"; else -> if (archiveZero(options["rec"])) "pf.jsonp" else "archive.jsonp"
        }
        else -> error("Unknown operator guide profile")
    }
    fun vodRoot(profile: String, url: String, key: String): String = if (url.isNotEmpty()) url else when (profile) {
        "antifriz" -> "http://media.af-play.com/$key.xml"
        "kb-team" -> "http://89.163.215.125"
        else -> error("Unknown operator VOD profile")
    }
}

class OperatorGuide(private val profile: String, current: Boolean = false) {
    private var phase = if (profile == "shura") { if (current) "current" else "week" } else "all"
    fun phase(): String = phase
    fun complete() { phase = if (profile == "shura" && phase == "week") "archive" else "" }
    private var value = if (profile == "itv") ProviderValue.array() else ProviderValue.nil
    private var rows = mutableListOf<ProviderValue>()
    fun result() = value
    fun accept(data: ProviderValue, phase: String, rec: ProviderValue) {
        if (profile == "ottclub") { if (data.truthy()) value = data["epg_data"]; return }
        if (profile == "itv") {
            val entries = data["res"]
            if (!entries.isArray) throw OperatorCatalogFailure("GUIDE_ITV_ARRAY")
            for (entry in entries.elements) {
                if (!entry.present) throw OperatorCatalogFailure("GUIDE_ITV_ROW", entry.kind == ProviderValueKind.NULL)
                rows.add(ProviderValue.obj(linkedMapOf("descr" to entry["desc"], "name" to entry["title"], "time" to entry["startTime"], "time_to" to entry["stopTime"])))
                value = ProviderValue.array(rows.toList())
            }
            return
        }
        require(profile == "shura")
        if (data.kind == ProviderValueKind.NULL) return
        if (phase != "archive" || !value.present) { rows = mutableListOf(); value = ProviderValue.array() }
        if (!data.isArray) throw OperatorCatalogFailure("GUIDE_SHURA_ARRAY")
        val entries = if (phase == "archive" && OperatorMedia.archiveZero(rec)) data.elements.dropLast(1) else data.elements
        for (entry in entries) {
            if (!entry.present) throw OperatorCatalogFailure("GUIDE_SHURA_ROW", entry.kind == ProviderValueKind.NULL)
            val from = entry["start_time"]; val duration = entry["duration"]
            val end = if (from.kind == ProviderValueKind.TEXT || duration.kind == ProviderValueKind.TEXT) ProviderValue.text(from.string() + duration.string())
                else ProviderValue(ProviderValueKind.NUMBER, (from.number() + duration.number()).toString())
            val row = ProviderValue.obj(linkedMapOf("descr" to entry["text"], "duration" to duration, "name" to entry["name"], "time" to from, "time_to" to end))
            if (phase == "archive") rows.add(0, row) else rows.add(row)
            value = ProviderValue.array(rows.toList())
        }
    }
}
