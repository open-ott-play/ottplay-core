package play.ott.core

data class OperatorHttpRequest(val url: String, val method: String, val dataType: String, val timeout: Int, val body: String?)

/** The same direct/proxy retry contract serves named operators and combined-API fallbacks. */
class OperatorPlaylistRequest(private val url: String, private val relay: String, intercepted: Boolean,
    private val profile: String, encode: (String) -> String) {
    private var stage = if (url.isEmpty()) 2 else 0
    private val intercept = intercepted && profile in listOf("classic", "quiet") && url.isNotEmpty()
    private val direct = if (intercept) url + (if ('?' in url) "&" else "?") + "url=" + encode(url) else url
    init { require(profile in listOf("classic", "quiet", "generic", "shura")) }
    fun interceptUrl() = if (intercept) url else ""
    fun progress() = stage == 1 && profile in listOf("classic", "quiet")
    fun request(): OperatorHttpRequest? {
        if (stage == 2) return null
        val timeout = when (profile) { "generic" -> 15000; "shura" -> 10000; else -> 30000 }
        return if (stage == 0) OperatorHttpRequest(direct, "", if (profile == "generic") "" else "text", timeout, null)
        else OperatorHttpRequest(relay + "/m3u/cp.php", "post", "text", timeout, "@" + url)
    }
    fun reject() { if (stage < 2) stage++ }
    fun accept() { stage = 2 }
}
