package play.ott.core

/** Decisions over decoder facts. Media objects, timers and OS capabilities stay with hosts. */
data class PlaybackCapabilities(
    val nativeHls: Boolean = false, val hls: Boolean = false,
    val nativeDash: Boolean = false, val shaka: Boolean = false,
    val transportStream: Boolean = false, val nativeTransport: Boolean = false,
    val lg: Boolean = false, val chromium: Boolean = false,
)
data class PlaybackRange(val start: Double, val end: Double)
data class PlaybackTrack(val language: String, val label: String, val savedId: Boolean = false)

object PlaybackRules {
    private val engines = setOf("auto", "native", "hls.js", "shaka", "mpegts")
    private val formats = setOf("auto", "hls", "dash", "mpegts", "flv", "file")
    private val languages = mapOf("eng" to "en", "rus" to "ru", "deu" to "de", "ger" to "de",
        "fra" to "fr", "fre" to "fr", "spa" to "es", "ita" to "it", "ukr" to "uk", "pol" to "pl", "por" to "pt")
    fun retryLimit(value: Double?): Int = if (value == null || !value.isFinite()) 3 else kotlin.math.floor(value).coerceIn(0.0, 3.0).toInt()
    fun validEngine(value: String) = value in engines
    fun validFormat(value: String) = value in formats

    fun format(value: String): String {
        val text = value.lowercase()
        if (text.contains("mpegurl") || text.contains("m3u8")) return "hls"
        val mpd = text.indices.any { at -> text.startsWith("mpd", at) &&
            (at == 0 || text[at - 1] in "/.") && (at + 3 == text.length || text[at + 3] in ";?") }
        if (text == "dash" || text.contains("dash+xml") || mpd) return "dash"
        if (text.contains("flv")) return "flv"
        if (text == "ts" || listOf("mp2t", "mpegts", "mpeg-ts").any(text::contains)) return "mpegts"
        if (text == "file" || listOf("video/mp4", "video/webm", "video/ogg", "video/quicktime",
                "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg").any(text::contains)) return "file"
        return ""
    }

    fun engines(format: String, preferred: String, cap: PlaybackCapabilities): List<String> {
        if (preferred != "auto") return listOf(preferred)
        val result = mutableListOf<String>()
        when (format) {
            "hls" -> {
                if (cap.lg || cap.nativeHls && !cap.chromium) result.add("native")
                if (cap.hls) result.add("hls.js")
                if (cap.shaka) result.add("shaka")
                if (cap.nativeHls && "native" !in result) result.add("native")
            }
            "dash" -> {
                if (cap.shaka) result.add("shaka")
                if (cap.nativeDash) result.add("native")
            }
            "mpegts", "flv" -> {
                if (cap.transportStream) result.add("mpegts")
                if (cap.nativeTransport) result.add("native")
            }
            else -> result.add("native")
        }
        return result
    }

    fun urlExtension(url: String, extensions: List<String>): Boolean {
        val value = url.lowercase()
        return extensions.any { extension ->
            val suffix = ".$extension"
            var at = value.indexOf(suffix)
            var found = false
            while (at >= 0) {
                val end = at + suffix.length
                if (end == value.length || value[end] == '?' || value[end] == '#') { found = true; break }
                at = value.indexOf(suffix, at + 1)
            }
            found
        }
    }
    fun classicAutoMode(url: String, nativeHls: () -> Boolean, testWebView: () -> Boolean, hls: () -> Boolean): Int = when {
        urlExtension(url, listOf("mpd")) -> 2
        urlExtension(url, listOf("m3u8")) && testWebView() -> if (hls()) 1 else 0
        urlExtension(url, listOf("m3u8")) && !nativeHls() -> 1
        else -> 0
    }
    fun classicDefaultMode(webOs: Boolean, desktop: Boolean, testWebView: () -> Boolean) =
        if (webOs || desktop || testWebView()) 3 else 0
    fun classicMode(mode: Double, webOs: Boolean, autoAvailable: () -> Boolean, nativeHls: () -> Boolean, hls: () -> Boolean) = when {
        webOs -> 3.0
        mode != 3.0 || autoAvailable() -> mode
        !nativeHls() && hls() -> 1.0
        else -> 0.0
    }

    /** Explicit seeks choose the nearest gap edge (ties forward); live restoration goes forward. */
    fun seek(position: Double, start: Double, end: Double, ranges: List<PlaybackRange>, restoreLive: Boolean = false): Double {
        var target = maxOf(start, minOf(position, end))
        for (index in 1 until ranges.size) {
            val previous = ranges[index - 1].end
            val next = ranges[index].start
            if (target > previous && target < next) {
                target = if (restoreLive || target - previous >= next - target) next else previous
                break
            }
        }
        return target
    }

    /** Native millisecond retention uses a proportional tail for clips shorter than 100 seconds. */
    fun nativeResume(positionMs: Long, durationMs: Long): Long {
        val position = positionMs.coerceAtLeast(0)
        if (durationMs <= 0) return position
        return if (durationMs - position <= minOf(5_000, durationMs / 20)) 0 else minOf(position, durationMs)
    }

    private fun trackText(value: String) = CoreText.trim(value).lowercase()
    private fun language(value: String): String {
        val normalized = trackText(value).split('_').joinToString("-")
        return languages[normalized] ?: normalized
    }
    fun track(tracks: List<PlaybackTrack>, savedLanguage: String, savedLabel: String, sameBackend: Boolean): Int {
        val wantedLanguage = language(savedLanguage)
        val label = trackText(savedLabel)
        var candidates = tracks.indices.toList()
        if (wantedLanguage.isNotEmpty()) {
            candidates = candidates.filter { language(tracks[it].language) == wantedLanguage }
            if (candidates.isEmpty()) return -1
        }
        if (label.isNotEmpty()) {
            val exact = candidates.filter { trackText(tracks[it].label) == label }
            if (exact.size == 1) return exact.first()
            if (exact.isNotEmpty()) candidates = exact
            else if (wantedLanguage.isEmpty()) return -1
        }
        if ((wantedLanguage.isNotEmpty() || label.isNotEmpty()) && candidates.size == 1) return candidates.first()
        return if (wantedLanguage.isEmpty() && label.isEmpty() && sameBackend) tracks.indexOfFirst { it.savedId } else -1
    }
}

/** A retry budget lasts across automatic reloads and resets only on an explicit new attempt. */
class PlaybackRetries(private val limit: Int, private val delay: Double) {
    var attempts: Int = 0
        private set
    fun reset() { attempts = 0 }
    fun delay(): Double = delay * attempts
    fun admit(live: Boolean): Boolean {
        if (!live || attempts >= limit) return false
        attempts++
        return true
    }
}
