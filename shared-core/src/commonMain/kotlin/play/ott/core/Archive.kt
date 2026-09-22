package play.ott.core

import kotlin.math.ceil
import kotlin.math.floor

/** Different public archive contracts, not separate implementations of the rules. */
enum class ArchiveFormat { BROWSER, ANDROID }

data class ArchiveRequest(
    val url: String,
    val mode: String,
    val source: String = "",
    val days: Double = 0.0,
    val start: Double,
    val end: Double,
    val now: Double,
    val correction: Double = 0.0,
    val programmeId: String = "",
    val base: String = "",
    val username: String? = null,
    val password: String? = null,
    val streamId: String = "",
    val extension: String = "",
    val live: Boolean = true,
    val channelId: String = "",
    val epgId: String = "",
    val channelName: String = "",
    /** A URL parser may supply the decoded final path component. */
    val resourceName: String? = null,
)

/** Everything here is deterministic. Hosts supply URL parsing and time-zone
 * calendar fields (year, month, day, hour, minute, second); no clock is read here.
 * Provider credentials never enter diagnostics or a generated script.
 */
object Archive {
    private data class Span(val start: Double, val end: Double, val now: Double) {
        val duration get() = floor(end - start)
        fun values(calendar: (Double) -> List<Int>, corrected: Double = start, correctedEnd: Double = end): Map<String, String> {
            val date by lazy { calendar(corrected) }
            val result = mutableMapOf(
                "start" to integer(corrected), "utc" to integer(corrected),
                "end" to integer(correctedEnd), "utcend" to integer(correctedEnd),
                "now" to integer(now), "timestamp" to integer(now), "lutc" to integer(now),
                "duration" to integer(duration), "offset" to integer(now - start),
                "durationMinutes" to integer(ceil(duration / 60)),
            )
            // Calendar conversion stays lazy until a template needs those fields.
            return object : Map<String, String> by result {
                override fun get(key: String): String? {
                    val index = listOf("Y", "m", "d", "H", "M", "S").indexOf(key)
                    if (index >= 0) return date.getOrNull(index)?.let { if (index == 0) it.toString() else pad(it) }
                    if (key == "startDate") return if (date.size == 6)
                        "${date[0].toString().padStart(4, '0')}-${pad(date[1])}-${pad(date[2])}:${pad(date[3])}-${pad(date[4])}" else null
                    return result[key]
                }
            }
        }
    }

    fun resolve(
        request: ArchiveRequest,
        format: ArchiveFormat,
        calendar: (Double) -> List<Int>,
        resolveUrl: (String) -> String?,
    ): String? {
        val r = request
        val browser = format == ArchiveFormat.BROWSER
        if (!listOf(r.start, r.end, r.now, r.days, r.correction).all { it.isFinite() } ||
            !r.live || r.start >= r.now || r.end <= r.start) return null
        if (browser && (r.days <= 0 || r.end > r.now)) return null
        if (r.days > 0 && r.now - r.start > r.days * 86400) return null
        if (!browser && r.epgId.isNotBlank() && !r.channelId.equals(r.epgId, true) && !r.channelId.equals(r.channelName, true)) return null
        val span = if (browser) Span(r.start, r.end, r.now)
            else Span(truncate(r.start), truncate(minOf(r.end, r.now)), truncate(r.now))
        if (span.end <= span.start) return null
        val mode = if (browser) r.mode else r.mode.lowercase()
        if (mode == "none") return null

        if (browser && mode == "xtream") {
            if (r.base.isEmpty() || r.username == null || r.password == null || r.streamId.isEmpty() ||
                r.streamId.any { it !in '0'..'9' } || r.extension !in listOf("ts", "m3u8")) return null
            val start = floor((span.start + r.correction * 3600) / 60) * 60
            val minutes = maxOf(1.0, ceil((span.end + r.correction * 3600 - start) / 60))
            val date = span.values(calendar, start)["startDate"] ?: return null
            val user = component(r.username) ?: return null
            val password = component(r.password) ?: return null
            return resolveUrl(r.base.trimEnd('/') + "/timeshift/$user/$password/${integer(minutes)}/$date/${r.streamId}.${r.extension}")
        }

        val explicit = if (browser) CoreText.trim(r.source, CoreText::space) else r.source
        val flussonic = if (browser) mode == "flussonic" else explicit.isBlank() && mode.startsWith("flussonic")
        if (flussonic) {
            if (browser && (kotlin.math.abs(r.correction) > 24 || r.days > 30)) return null
            val start = floor(span.start + r.correction * 3600)
            if (browser && (start < 0 || span.duration < 1)) return null
            val parts = resource(r.url, r.resourceName, browser) ?: return null
            val rule = standardResources[parts.name] ?: return null
            val template = if (!browser && span.start > span.now - 600) rule.second else rule.first
            val value = expand(template, span.values(calendar, start), TemplateFormat.MODERN) ?: return null
            return resolveUrl(parts.prefix + value + parts.suffix)
        }

        val raw = when {
            !browser && explicit.isNotBlank() -> if (mode == "append") r.url + explicit else explicit
            browser && mode !in listOf("default", "append", "vod", "shift") -> return null
            mode == "shift" || !browser && mode in listOf("default", "shift", "append") -> "?utc={utc}&lutc={lutc}"
            else -> explicit
        }
        if (raw.isEmpty()) return null
        val corrected = floor(span.start + r.correction * 3600)
        val values = span.values(calendar, corrected, floor(span.end + r.correction * 3600))
        val expanded = expand(raw, values, if (browser) TemplateFormat.BROWSER else TemplateFormat.MODERN, r.programmeId) ?: return null
        val appended = if (browser && mode in listOf("append", "shift") || !browser && explicit.isBlank()) {
            if (r.url.isEmpty() || expanded.firstOrNull() !in listOf('?', '&')) return null
            appendQuery(r.url, expanded.drop(1), stripFragment = browser)
        } else expanded
        return resolveUrl(appended)
    }

    /** Historical wire spellings are data. Only adapters still tied to the old
     * provider interface use these profiles; they contain no template algorithms.
     */
    fun provider(
        profile: String, url: String, source: String, mode: String,
        start: Double, end: Double, now: Double, dune: Boolean = false, variant: Int = 0,
    ): String? {
        if (!listOf(start, end, now).all { it.isFinite() }) return null
        val query = when (profile) {
            "utc" -> "utc=${integer(start)}"
            "archive" -> "archive=${integer(start)}"
            "utc-now", "auto-utc-now" -> "utc=${integer(start)}&lutc=${integer(now)}"
            "club" -> if (end < now && !dune) "archive=${number(start)}&archive_end=${number(end)}"
                else "timeshift=${number(start)}&timenow=${number(now)}"
            else -> null
        }
        if (query != null) return if (profile == "auto-utc-now") appendQuery(url, query) else "$url?$query"
        val paddedFallback = profile in listOf("only4", "itv", "antifriz")
        var stop = if (end < start) now + if (paddedFallback) 600 else 0 else end
        if (profile == "template") {
            if (source.isEmpty()) return null
            return expand(source, legacyValues(start, stop, now), TemplateFormat.PROVIDER)
        }
        if (profile !in listOf("m3u", "kb", "only4", "itv", "antifriz")) return null
        if (dune && !paddedFallback) stop += 7200
        val span = Span(start, stop, now)
        val resourceTable = if (profile == "kb") kbResources else standardResources
        val detected = if (profile in listOf("m3u", "kb") && mode.contains("flussonic"))
            resourceTable.keys.firstOrNull { url.contains(it) } else null
        if (detected != null || paddedFallback) {
            val rule = if (detected != null) resourceTable.getValue(detected)
                else providerResources[profile]?.getOrNull(variant) ?: return null
            val absolute = start > now - 600 || profile == "kb" && detected == "mpegts" ||
                profile == "only4" && variant == 0 || profile in listOf("itv", "antifriz") && variant == 1
            if (!absolute && dune && paddedFallback) stop = floor(stop) + 7200
            val value = expand(if (absolute) rule.second else rule.first, legacyValues(start, stop, now), TemplateFormat.PROVIDER) ?: return null
            // Older provider contracts split at the first marker, even when it
            // is not the terminal resource. New clients use resource() below.
            val marker = detected ?: if (profile == "only4") "index.m3u8" else ""
            if (marker.isEmpty()) return url + value + source
            val parts = url.split(marker)
            return parts[0] + value + (parts.getOrNull(1) ?: "undefined")
        }
        if (source.isNotEmpty()) return expand(if (mode == "append") url + source else source,
            legacyValues(span.start, span.end, span.now), TemplateFormat.PROVIDER)
        return appendQuery(url, "utc=${integer(start)}&lutc=${integer(now)}")
    }

    private enum class TemplateFormat { BROWSER, MODERN, PROVIDER }
    private fun expand(template: String, values: Map<String, String>, format: TemplateFormat, programmeId: String = ""): String? {
        val output = StringBuilder()
        var at = 0
        var identifies = false
        while (at < template.length) {
            val dollar = template[at] == '$' && template.getOrNull(at + 1) == '{'
            val open = if (dollar) at + 1 else at
            if (template[open] != '{' || format == TemplateFormat.PROVIDER && !dollar) {
                output.append(template[at++]); continue
            }
            val close = template.indexOf('}', open + 1)
            if (close < 0) { output.append(template.substring(at)); break }
            val key = template.substring(open + 1, close)
            val allowed = when (format) {
                TemplateFormat.PROVIDER -> key in listOf("start", "end", "timestamp", "offset", "duration")
                TemplateFormat.MODERN -> key in listOf("start", "utc", "end", "utcend", "timestamp", "lutc", "offset", "duration", "durationMinutes", "startDate")
                TemplateFormat.BROWSER -> key !in listOf("durationMinutes", "startDate")
            }
            var value = if (allowed) values[key] else null
            if (format == TemplateFormat.BROWSER && key == "catchup-id") {
                value = programmeId.takeIf { it.isNotEmpty() }?.let(::component)
                identifies = true
            } else if (format == TemplateFormat.BROWSER && ':' in key) {
                val field = key.substringBefore(':')
                val divisor = key.substringAfter(':')
                if (field in listOf("duration", "offset") && divisor.firstOrNull() in '1'..'9' && divisor.all { it in '0'..'9' }) {
                    value = values[field]?.toDoubleOrNull()?.let { integer(floor(it / (divisor.toDoubleOrNull() ?: Double.POSITIVE_INFINITY))) }
                    if (field == "offset") identifies = true
                }
            }
            if (key in listOf("utc", "start", "offset", "Y", "m", "d", "H", "M", "S")) identifies = true
            if (value == null) {
                if (format != TemplateFormat.PROVIDER) return null
                output.append(template.substring(at, close + 1))
            } else output.append(value)
            at = close + 1
        }
        val result = output.toString()
        if (format == TemplateFormat.BROWSER && (!identifies || result.any { it == '{' || it == '}' })) return null
        return result
    }

    private fun legacyValues(start: Double, end: Double, now: Double) = mapOf(
        "start" to integer(start), "end" to integer(end), "timestamp" to integer(now),
        "offset" to integer(floor(now) - floor(start)), "duration" to integer(end - start),
    )
    private data class Resource(val prefix: String, val name: String, val suffix: String)
    private fun resource(url: String, decoded: String?, stripFragment: Boolean): Resource? {
        val clean = url.substringBefore('#')
        val path = clean.substringBefore('?')
        val slash = path.lastIndexOf('/')
        val scheme = path.indexOf("://")
        // A hostname such as index.m3u8 is never a media resource.
        if (slash < 0 || scheme >= 0 && slash < scheme + 3) return null
        return Resource(path.substring(0, slash + 1), decoded ?: path.substring(slash + 1), (if (stripFragment) clean else url).substring(path.length))
    }
    private fun appendQuery(url: String, query: String, stripFragment: Boolean = false): String {
        val base = if (stripFragment) url.substringBefore('#') else url
        return base + (if ('?' in base) "&" else "?") + query
    }
    private fun integer(value: Double): String = floor(value).toLong().toString()
    private fun truncate(value: Double): Double = if (value < 0) ceil(value) else floor(value)
    private fun number(value: Double): String = if (value == floor(value)) integer(value) else value.toString()
    private fun pad(value: Int) = value.toString().padStart(2, '0')

    /** RFC3986 component bytes, with the ECMAScript encodeURIComponent safe set. */
    private fun component(value: String): String? {
        var index = 0
        while (index < value.length) {
            val char = value[index++]
            if (char in '\uD800'..'\uDBFF') {
                if (value.getOrNull(index) !in '\uDC00'..'\uDFFF') return null
                index++
            } else if (char in '\uDC00'..'\uDFFF') return null
        }
        val hex = "0123456789ABCDEF"
        return buildString {
            for (byte in value.encodeToByteArray()) {
                val code = byte.toInt() and 255
                val char = code.toChar()
                if (char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char in "-_.!~*'()") append(char)
                else { append('%'); append(hex[code / 16]); append(hex[code % 16]) }
            }
        }
    }

    private fun rule(archive: String, absolute: String) = archive to absolute
    private val standardResources = linkedMapOf(
        "mpegts" to rule("archive-\${start}-\${duration}.ts", "timeshift_abs-\${start}.ts"),
        "video.m3u8" to rule("video-\${start}-\${duration}.m3u8", "video-timeshift_abs-\${start}.m3u8"),
        "mono.m3u8" to rule("mono-\${start}-\${duration}.m3u8", "mono-timeshift_abs-\${start}.m3u8"),
        "index.m3u8" to rule("archive-\${start}-\${duration}.m3u8", "timeshift_abs-\${start}.m3u8"),
        "index.mpd" to rule("archive-\${start}-\${duration}.mpd", "timeshift_abs-\${start}.mpd"),
    )
    private val kbResources = linkedMapOf(
        "mpegts" to rule("\${start}-\${duration}", "timeshift_abs/\${start}"),
        "video.m3u8" to rule("video-\${start}-\${duration}.m3u8", "timeshift_abs_video-\${start}.m3u8"),
        "index.m3u8" to rule("index-\${start}-\${duration}.m3u8", "timeshift_abs-\${start}.m3u8"),
        // This spelling is part of the retained kb-team wire contract.
        "index.mpd" to rule("archive-\${start}-\${duration}.mdp", "timeshift_abs-\${start}.mdp"),
    )
    private val providerResources = mapOf(
        "only4" to listOf(kbResources.getValue("mpegts"), kbResources.getValue("video.m3u8"), kbResources.getValue("index.m3u8")),
        "itv" to listOf(kbResources.getValue("index.m3u8"), kbResources.getValue("mpegts"), kbResources.getValue("video.m3u8")),
        "antifriz" to listOf(kbResources.getValue("index.m3u8"), kbResources.getValue("mpegts"),
            standardResources.getValue("video.m3u8"), standardResources.getValue("mono.m3u8"),
            rule("index-\${start}-\${duration}.mpd", "timeshift_abs-\${start}.mpd")),
    )
}
