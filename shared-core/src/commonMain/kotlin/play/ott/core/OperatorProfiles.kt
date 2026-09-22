package play.ott.core

/** Named-provider credentials and request routes are portable data policies. */
object OperatorProfiles {
    fun valid(profile: String, first: String, second: String = ""): Boolean = when (profile) {
        "1ott" -> first.isNotEmpty() && second.isNotEmpty()
        "only4" -> first.length == 10
        "shara-tv" -> first.length == 8 && second.length == 8
        "tvteam", "shura" -> first.length >= 8
        "antifriz" -> first.length == 8
        "edem", "kb-team" -> first.isNotEmpty()
        else -> OperatorCatalogs.validCredentials(profile, first, second)
    }
    fun url(profile: String, phase: String, config: ProviderValue): String = when (profile) {
        "1ott" -> if (phase == "account") config["base"].string() + "/PinApi/" + config["id"].string() + "/" + config["pin"].string()
            else config["base"].string() + "/api/" + config["token"].string() + "/high/ottnav.m3u8"
        "only4" -> "http://only4.tv/pl/" + config["token"].string() + "/102/only4tv.m3u8"
        "shara-tv" -> "http://tvfor.pro/g/" + config["login"].string() + ":" + config["password"].string() + "/1/playlist.m3u"
        "tvteam" -> config["url"].string()
        "antifriz" -> "http://af-play.com/playlist/" + config["key"].string() + ".m3u8"
        "edem" -> config["scheme"].string() + "epg.drm-play.com/edem/edem_epg_ico" +
            (if (config["list"].truthy()) config["list"].string() else "") + ".m3u8"
        "kb-team" -> when (config["list"].number()) {
            0.0 -> "http://kb-team.club/?do=/plugin&id=iptvkino&m3u&box_mac=" + config["mac"].string()
            1.0 -> "http://kb-team.club/?do=/plugin&bid=federaltv&m3u&box_mac=" + config["mac"].string()
            2.0 -> "http://kb-team.club/?do=/plugin&bid=iptvk&m3u&box_mac=" + config["mac"].string()
            else -> ""
        }
        "shura" -> "http://pl.tvshka.net" + if (phase == "categories") "/?uid=shxxxxxxxxxxx&srv=1&type=halva" else ""
        else -> error("Unknown operator request profile")
    }
    fun tvteamPlaylist(value: String): String = CoreText.trim(value).let {
        if (it.isNotEmpty() && !it.contains("/playlist.m3u8")) it + "/playlist.m3u8" else it
    }
    fun capturedTvteamPlaylist(href: String, dune: Boolean): String {
        if (dune) return ""
        val query = href.split('?').getOrNull(1) ?: return ""
        for (item in query.split('&')) {
            val pair = item.split('=')
            if (pair[0] == "token") return pair.getOrNull(1)?.takeIf { it.isNotEmpty() }
                ?.let { "https://tv.team/pl/11/$it/playlist.m3u8" }.orEmpty()
        }
        return ""
    }
    fun edemHost(value: String): String {
        val host = CoreText.trim(value)
        val lowered = host.lowercase()
        return (if (lowered.startsWith("http://")) host.drop(7) else if (lowered.startsWith("https://")) host.drop(8) else host).substringBefore('/')
    }
}
