package play.ott.core

/** Playlist identity policy only. Header validation and HTTP transport belong to the host. */
object M3uUserAgents {
    const val default = "OTT-play-FOSS/1.0"

    private val canonical = linkedMapOf(
        "dune" to "Mozilla/5.0 (Dune HD; DuneOS) AppleWebKit/537.36 (KHTML, like Gecko) DuneHD/1.0 Chrome/68.0.3440.106 Safari/537.36",
        "mag" to "Mozilla/5.0 (STB; Infomir MAG524) Maple 6.0 QtWebKit/3.0",
        "tizen" to "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungTV/3.0 Chrome/76.0.3809.146 Safari/537.36",
        "viera" to "Mozilla/5.0 (Unknown; Linux; Viera/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36",
        "webos" to "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 LG Browser/9.00.00",
    )

    /** A fresh map prevents callers from changing the canonical presets. */
    fun presets(): Map<String, String> = canonical.toMap()

    /** ASCII preset identifiers ignore case; a custom value is never trimmed or rewritten. */
    fun resolve(input: String?): String {
        if (input.isNullOrEmpty()) return default
        // Unicode lowercase can map a custom character to ASCII (e.g. Kelvin sign to k).
        // Native transports use ASCII identifiers, so keep non-ASCII customs unchanged.
        if (input.any { it.code > 0x7f }) return input
        return canonical[input.lowercase()] ?: input
    }
}
