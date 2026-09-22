package play.ott.core

data class PlaybackDetection(val format: String, val reason: String)
object PlaybackDetectionRules {
    fun declared(mime: String, format: String, type: String, hint: String, url: String): PlaybackDetection {
        val explicit = PlaybackRules.format(mime).ifEmpty { PlaybackRules.format(format) }.ifEmpty { PlaybackRules.format(type) }
        if (explicit.isNotEmpty()) return PlaybackDetection(explicit, "declared_type")
        val query = PlaybackRules.format(hint)
        if (query.isNotEmpty()) return PlaybackDetection(query, "url_hint")
        val suffix = when {
            PlaybackRules.urlExtension(url, listOf("m3u8")) -> "hls"
            PlaybackRules.urlExtension(url, listOf("mpd")) -> "dash"
            PlaybackRules.urlExtension(url, listOf("flv")) -> "flv"
            PlaybackRules.urlExtension(url, listOf("ts", "m2ts")) -> "mpegts"
            PlaybackRules.urlExtension(url, listOf("mp4", "m4v", "m4a", "webm", "ogg", "mp3", "aac", "mov")) || url.startsWith("blob:", true) -> "file"
            else -> ""
        }
        return PlaybackDetection(suffix, "url_extension")
    }
    fun body(text: String): String {
        val value = text.take(4096)
        val clean = value.removePrefix("\uFEFF").dropWhile(CoreText::space)
        if (value.startsWith("FLV")) return "flv"
        if (clean.startsWith("#EXTM3U")) return "hls"
        var xml = clean
        if (xml.startsWith("<?xml", true)) {
            val end = xml.indexOf('>')
            if (end >= 0) xml = xml.substring(end + 1).dropWhile(CoreText::space)
        }
        if (mpdRoot(xml)) return "dash"
        // The legacy bounded signature accepts a comment through any later terminator.
        // Trying every terminator preserves its backtracking contract without RegExp.
        if (xml.startsWith("<!--")) {
            var end = xml.indexOf("-->")
            while (end >= 0) {
                if (mpdRoot(xml.substring(end + 3).dropWhile(CoreText::space))) return "dash"
                end = xml.indexOf("-->", end + 3)
            }
        }
        for (at in 0 until minOf(188, value.length - 376)) {
            if (value[at].code and 255 == 71 && value[at + 188].code and 255 == 71 && value[at + 376].code and 255 == 71) return "mpegts"
        }
        if (value.length >= 8 && value.substring(4, 8) in listOf("ftyp", "moov", "moof")) return "file"
        return ""
    }
    private fun mpdRoot(xml: String): Boolean {
        if (!xml.startsWith('<')) return false
        val name = xml.substring(1).takeWhile { it != '>' && !CoreText.space(it) }
        val colon = name.indexOf(':')
        val prefix = if (colon < 0) "" else name.substring(0, colon)
        val local = if (colon < 0) name else name.substring(colon + 1)
        return local.equals("MPD", true) && name.length + 1 < xml.length &&
            (colon < 0 || prefix.isNotEmpty() && prefix.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' })
    }

}
