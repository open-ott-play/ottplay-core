package play.ott.core

enum class PlaylistFormat { BROWSER, ANDROID }
class PlaylistFailure(val code: String) : Exception(code)
data class PlaylistDirective(val kind: String, val name: String, val value: String)
data class PlaylistArchive(val mode: String, val source: String, val days: Double, val correction: Double = 0.0)
data class PlaylistEntry(
    var id: String, val name: String, val url: String, val group: String, val logo: String,
    val epgId: String, val epgName: String, val movie: Boolean, val shift: Double,
    val epgUrls: List<String>, val archive: PlaylistArchive?, val directives: List<PlaylistDirective>,
    val generatedTitle: Boolean = false, val generatedTitleIndex: Int = 0,
)
data class PlaylistResult(val entries: List<PlaylistEntry>, val epgUrls: List<String>, val warnings: List<String>,
    val hls: Boolean = false, val hlsProperties: List<PlaylistDirective> = emptyList())

/** Common line/attribute state machine. URL resolution, hashing and decoding of
 * platform header/DRM payloads are injected; no transport or global player state.
 */
object Playlist {
    private val archiveKeys = listOf("catchup-days", "timeshift", "tvg-rec")
    private fun trim(value: String, format: PlaylistFormat) = CoreText.trim(value,
        if (format == PlaylistFormat.ANDROID) CoreText::androidSpace else CoreText::space)
    private fun keyChar(c: Char) = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_' || c == '-'

    fun attributes(value: String, format: PlaylistFormat = PlaylistFormat.BROWSER): Map<String, String> {
        val result = linkedMapOf<String, String>()
        val whitespace = if (format == PlaylistFormat.ANDROID) CoreText::asciiSpace else CoreText::space
        var at = 0
        while (at < value.length) {
            if (!keyChar(value[at])) { at++; continue }
            val start = at
            while (at < value.length && keyChar(value[at])) at++
            val key = value.substring(start, at).lowercase()
            while (at < value.length && whitespace(value[at])) at++
            if (value.getOrNull(at) != '=') continue
            at++
            while (at < value.length && whitespace(value[at])) at++
            if (at == value.length) break
            val quote = value[at]
            val close = if (quote == '"' || quote == '\'') value.indexOf(quote, at + 1) else -1
            if (close >= 0) { result[key] = value.substring(at + 1, close); at = close + 1 }
            else {
                val from = at
                while (at < value.length && !whitespace(value[at])) at++
                result[key] = value.substring(from, at)
            }
        }
        return result
    }

    fun titleComma(value: String): Int {
        var quote: Char? = null
        value.forEachIndexed { index, character ->
            if (quote == character) quote = null
            else if (quote == null && character in "\"'") quote = character
            else if (quote == null && character == ',') return index
        }
        return -1
    }

    private fun archive(attrs: Map<String, String>, defaults: Map<String, String>, format: PlaylistFormat,
        fallback: Double, resolve: (String) -> String): PlaylistArchive? {
        fun value(key: String) = attrs[key] ?: defaults[key].orEmpty()
        if (format == PlaylistFormat.BROWSER) {
            val declared = listOf(attrs, defaults).firstNotNullOfOrNull { scope ->
                archiveKeys.firstOrNull(scope::containsKey)?.let { scope.getValue(it) }
            }
            val days = declared?.let { decimalDays(CoreText.trim(it)) } ?: 0.0
            val mode = value("catchup").ifEmpty { value("catchup-type") }
            if (mode.isEmpty() && days == 0.0) return null
            val rawSource = value("catchup-source")
            val source = CoreText.trim(rawSource)
            val type = CoreText.trim(mode.ifEmpty { if (rawSource.isEmpty()) "shift" else "default" }).lowercase()
            return PlaylistArchive(type, if (source.isNotEmpty() && type != "append") resolve(source) else source, days, number(value("catchup-correction")))
        }
        val all = defaults + attrs
        val days = archiveKeys.firstNotNullOfOrNull { all[it]?.toDoubleOrNull() }?.coerceAtLeast(0.0)
            ?: if (archiveKeys.any(all::containsKey)) 0.0 else fallback.takeIf { it.isFinite() && it >= 0 } ?: 0.0
        val mode = all["catchup"] ?: all["catchup-type"].orEmpty()
        val source = all["catchup-source"].orEmpty()
        if (mode.equals("none", true) || !(days > 0 || source.isNotEmpty() || mode.isNotEmpty())) return null
        return PlaylistArchive(mode.ifBlank { "default" }, source, days)
    }

    private fun decimalDays(value: String): Double {
        if (value.isEmpty()) return 0.0
        val dot = value.indexOf('.')
        if (value.any { it !in '0'..'9' && it != '.' } || dot >= 0 && (dot == value.lastIndex || value.indexOf('.', dot + 1) >= 0)) return 0.0
        return value.toDoubleOrNull()?.takeIf { it.isFinite() }?.coerceAtMost(30.0) ?: 0.0
    }
    /** JS numeric attributes historically permit exponents, hex and Infinity. */
    private fun number(value: String): Double = CoreNumber.javascript(value).let { if (it.isNaN() || it == 0.0) 0.0 else it }

    fun read(
        text: String, format: PlaylistFormat, sourceId: String, resolve: (String) -> String,
        identifier: (List<String>) -> String, component: (String) -> String = { it },
        filename: (String) -> String = { "" }, epgUrl: String = "", fallbackDays: Double = 0.0,
        onEntry: (PlaylistEntry) -> Unit = {}, onDirective: (PlaylistDirective) -> Unit = {},
    ): PlaylistResult {
        if (text.length > 32 * 1024 * 1024) throw PlaylistFailure("SIZE")
        val browser = format == PlaylistFormat.BROWSER
        val lines = text.removePrefix("\uFEFF").lines().map { trim(it, format) }
        if (!browser && lines.any { it.startsWith("#EXT-X-STREAM-INF:") || it.startsWith("#EXT-X-TARGETDURATION:") }) {
            return PlaylistResult(emptyList(), emptyList(), emptyList(), true,
                lines.filter { it.startsWith("#KODIPROP:", true) }.map {
                    val property = it.substringAfter(':')
                    PlaylistDirective("property", property.substringBefore('='), property.substringAfter('=', ""))
                })
        }
        val entries = mutableListOf<PlaylistEntry>()
        val seen = mutableSetOf<String>()
        val counts = mutableMapOf<String, Int>()
        val epgUrls = linkedSetOf<String>()
        val defaultEpg = linkedSetOf<String>()
        val warnings = mutableListOf<String>()
        fun feeds(input: String, target: MutableSet<String>? = null) {
            for (value in input.split(',')) {
                val url = resolve(trim(value, format))
                if (url.isNotEmpty()) { epgUrls.add(url); target?.add(url) }
            }
        }
        if (!browser && epgUrl.isNotBlank()) resolve(epgUrl).takeIf { it.isNotEmpty() }?.let(epgUrls::add)
        var defaults = emptyMap<String, String>()
        var attrs = emptyMap<String, String>()
        var name = ""
        var duration = -1.0
        var group = ""
        var pending = false
        var invalid = false
        var vod = false
        var header = false
        var directives = mutableListOf<PlaylistDirective>()
        fun directive(kind: String, key: String = "", value: String = "") {
            val entry = PlaylistDirective(kind, key, value)
            directives.add(entry); onDirective(entry)
        }
        fun reset() {
            attrs = emptyMap(); name = ""; duration = -1.0; pending = false; invalid = false; vod = false; directives = mutableListOf()
            if (!browser) onDirective(PlaylistDirective("reset", "", ""))
        }
        var at = 0
        while (at < lines.size) {
            val line = lines[at++]
            if (line.isEmpty()) continue
            if (line.length > 1_048_576) throw PlaylistFailure("LINE_SIZE")
            if (browser && !header) {
                if (!line.startsWith("#EXTM3U", true) || line.length > 7 && !CoreText.space(line[7])) throw PlaylistFailure("FORMAT")
                defaults = attributes(line, format)
                feeds(defaults["x-tvg-url"].orEmpty(), defaultEpg)
                feeds(defaults["url-tvg"].orEmpty(), defaultEpg)
                feeds(defaults["tvg-url"].orEmpty().ifEmpty { defaults["foss-tvg"].orEmpty() }, defaultEpg)
                header = true
                continue
            }
            when {
                !browser && line.startsWith("#EXTM3U", true) -> {
                    defaults = attributes(line, format)
                    feeds(defaults["url-tvg"].orEmpty()); feeds(defaults["x-tvg-url"].orEmpty())
                }
                line.startsWith("#EXTINF:", true) -> {
                    reset()
                    var info = line.substringAfter(':')
                    if (!browser) while (titleComma(info) < 0 && at < lines.size &&
                        listOf("tvg-", "group-title", "catchup").any { lines[at].startsWith(it, true) }) info += " " + lines[at++]
                    val comma = titleComma(info)
                    if (comma < 0) {
                        invalid = true
                        if (browser) warnings.add("Ignored malformed EXTINF at line $at")
                    } else {
                        attrs = attributes(info.substring(0, comma), format)
                        name = trim(info.substring(comma + 1), format)
                        duration = info.substringBefore(' ').substringBefore(',').toDoubleOrNull() ?: -1.0
                        pending = true
                    }
                }
                line.startsWith("#EXTGRP:", true) -> {
                    val value = trim(line.substringAfter(':'), format)
                    if (!browser) group = value
                    else if (pending && attrs["group-title"].isNullOrEmpty()) attrs = attrs + ("group-title" to value)
                }
                browser && line.equals("#EXT-X-PLAYLIST-TYPE:VOD", true) && pending -> vod = true
                !browser && line.startsWith("#EXTVLCOPT:", true) -> {
                    val option = line.substringAfter(':')
                    val key = when (option.substringBefore('=').lowercase()) {
                        "http-user-agent" -> "User-Agent"
                        "http-referrer", "http-referer" -> "Referer"
                        "http-origin" -> "Origin"
                        else -> null
                    }
                    if (key != null) directive("header", key, option.substringAfter('=', ""))
                }
                !browser && line.startsWith("#KODIPROP:", true) -> {
                    val property = line.substringAfter(':')
                    val key = trim(property.substringBefore('='), format)
                    val value = property.substringAfter('=', "")
                    if (key.equals("inputstream.adaptive.stream_headers", true)) directive("query", "", value)
                    directive("property", key, value)
                }
                !browser && line.startsWith("#EXTHTTP:", true) -> directive("json", "", line.substringAfter(':'))
                line.startsWith('#') -> Unit
                else -> {
                    val raw = if (browser) line else trim(line.substringBefore('|'), format)
                    val eligible = if (browser) pending else !invalid && (pending || raw.startsWith("http://", true) || raw.startsWith("https://", true))
                    val url = if (eligible) resolve(raw) else ""
                    if (url.isEmpty() || !browser && (raw.contains('<') || raw.contains('>'))) {
                        if (browser) warnings.add("Ignored unsupported or incomplete stream at line $at")
                        reset(); continue
                    }
                    fun attr(key: String) = attrs[key] ?: defaults[key].orEmpty()
                    val id = if (browser) trim(attr("tvg-id"), format) else attrs["tvg-id"].orEmpty()
                    val tvgName = if (browser) trim(attr("tvg-name"), format) else attrs["tvg-name"].orEmpty()
                    val title = if (browser) name.ifEmpty { attrs["tvg-name"].orEmpty() }.ifEmpty { "Channel" }
                        else name.ifBlank { tvgName }.ifBlank { id }.ifBlank { filename(url) }.ifBlank { "Stream ${entries.size + 1}" }
                    val entryGroup = if (browser) attr("group-title").ifEmpty { "Other" }
                        else attrs["group-title"].orEmpty().ifBlank { group }
                    if (!browser && entryGroup.isNotBlank()) group = entryGroup
                    val key = if (browser) "$id\n$url" else identifier(listOf(sourceId, id.ifBlank { url }, title))
                    if (browser && key in seen) { reset(); continue }
                    val itemEpg = linkedSetOf<String>()
                    if (browser) { feeds(attrs["url-tvg"].orEmpty(), itemEpg); feeds(attrs["tvg-source"].orEmpty(), itemEpg); itemEpg.addAll(defaultEpg) }
                    if (!browser && '|' in line) directive("query", "", line.substringAfter('|'))
                    val entry = PlaylistEntry(
                        if (browser) "" else key, title, url, entryGroup,
                        resolve(if (browser) attr("tvg-logo") else attrs["tvg-logo"].orEmpty()), id, tvgName,
                        if (browser) vod || attrs["media"].equals("true", true) || attrs["media"] == "1" ||
                            !attrs["media-dir"].isNullOrEmpty() || !attrs["media-size"].isNullOrEmpty()
                        else pending && duration > 0 || attrs["type"].equals("movie", true),
                        if (browser) number(attr("tvg-shift")) else 0.0, itemEpg.toList(),
                        archive(attrs, defaults, format, fallbackDays, resolve), directives.toList(),
                        !browser && name.isBlank() && tvgName.isBlank() && id.isBlank() && filename(url).isBlank(), entries.size + 1,
                    )
                    // Header/DRM validation must also see duplicate rows, before coalescing.
                    onEntry(entry)
                    if (seen.add(key)) {
                        entries.add(entry)
                        counts[id] = (counts[id] ?: 0) + 1
                        if (entries.size > 100_000) throw PlaylistFailure("COUNT")
                    }
                    reset()
                }
            }
        }
        if (browser && !header) throw PlaylistFailure("EMPTY")
        if (!browser && entries.isEmpty()) throw PlaylistFailure("NO_ENTRIES")
        if (browser) for (entry in entries) {
            entry.id = sourceId + ":m3u:" + if (entry.epgId.isEmpty()) "url:" + identifier(listOf(entry.url)) else
                "tvg:" + component(entry.epgId) + if (counts.getValue(entry.epgId) > 1) ":" + identifier(listOf(entry.url)) else ""
        }
        return PlaylistResult(entries, epgUrls.toList(), warnings)
    }
}
