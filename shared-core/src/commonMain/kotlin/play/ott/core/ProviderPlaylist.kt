package play.ott.core

enum class ProviderPlaylistFormat { GENERIC, M3U }
data class ProviderPlaylistEntry(
    val id: Double, val name: String, val url: String, val group: String, val category: Int,
    val logo: String, val epgId: String, val epgName: String, val archiveHours: Double,
    val archiveMode: String, val archiveSource: String, val shift: Double,
    val raw: String, val titleHashInput: String, val generatedName: Boolean,
)
data class ProviderPlaylistResult(val header: String, val entries: List<ProviderPlaylistEntry>,
    val groups: Map<String, List<Double>>, val groupOrder: List<String>)

/** Provider wire profiles share lexical scanning, grouping and deduplication.
 * URL identity, archive rules and the companion title-hash input remain stable;
 * display titles use the unquoted delimiter and URI scanning skips blank lines.
 */
object ProviderPlaylist {
    internal fun blocks(text: String) = text.split("#EXTINF:")
    fun attribute(text: String, name: String): String {
        val marker = "$name="
        val position = text.indexOf(marker)
        if (position < 0) return ""
        val start = position + marker.length
        if (start == text.length) return ""
        // split(marker)[1] historically stopped at the next identical marker.
        val boundary = text.indexOf(marker, start).let { if (it < 0) text.length else it }
        val end = if (text[start] == '"') text.indexOf('"', start + 1).let { if (it < 0 || it > boundary) boundary else it }
            else (start until boundary).firstOrNull { text[it] == ' ' || text[it] == ',' } ?: boundary
        return text.substring(start + if (text[start] == '"') 1 else 0, end)
    }
    private fun quoted(text: String, name: String): String {
        val marker = "$name=\""
        val at = text.indexOf(marker, ignoreCase = true)
        if (at < 0) return ""
        val start = at + marker.length
        val end = text.indexOf('"', start)
        return if (end < 0) "" else text.substring(start, end)
    }
    fun integer(value: String): Double {
        val input = CoreText.trim(value)
        var at = if (input.firstOrNull() == '+' || input.firstOrNull() == '-') 1 else 0
        val start = at
        while (at < input.length && input[at] in '0'..'9') at++
        if (at == start) return Double.NaN
        return input.substring(0, at).toDoubleOrNull() ?: Double.NaN
    }
    private fun hours(text: String, fallback: Double): Double {
        val name = listOf("catchup-days", "timeshift", "tvg-rec").firstOrNull { text.contains(it) } ?: return fallback
        val number = integer(attribute(text, name))
        return (if (number.isNaN()) 0.0 else number) * 24
    }
    private fun floatPrefix(value: String): Double {
        val input = CoreText.trim(value)
        if (input.startsWith("Infinity") || input.startsWith("+Infinity")) return Double.POSITIVE_INFINITY
        if (input.startsWith("-Infinity")) return Double.NEGATIVE_INFINITY
        return CoreNumber.decimal(input, prefix = true)
    }
    fun read(text: String, format: ProviderPlaylistFormat, hash: (String) -> Double, fallbackHours: Double = 0.0): ProviderPlaylistResult {
        val blocks = blocks(text)
        val header = blocks[0]
        val entries = linkedMapOf<Double, ProviderPlaylistEntry>()
        val groups = linkedMapOf<String, MutableList<Double>>()
        val categories = mutableMapOf<String, Int>()
        val generic = format == ProviderPlaylistFormat.GENERIC
        var previousGroup = ""
        val defaultHours = hours(header, fallbackHours)
        val defaultMode = attribute(header, "catchup").ifEmpty { attribute(header, "catchup-type") }
        val defaultSource = attribute(header, "catchup-source")
        for (block in blocks.drop(1)) {
            val lines = block.split('\n')
            val raw = lines[0]
            var group = if (generic) quoted(raw, "group-title") else attribute(raw, "group-title")
            val url = Playlist.recordUri(lines) { value ->
                if (!generic && group.isEmpty() && value.contains("#EXTGRP:")) group = CoreText.trim(value.substringAfter("#EXTGRP:").substringBefore("#EXTGRP:"))
            }
            if (generic && url.isEmpty()) continue
            if (group.isEmpty()) group = previousGroup.ifEmpty { if (generic) "Other" else "" }
            else previousGroup = group
            if (generic) previousGroup = group
            val comma = Playlist.titleComma(raw)
            val title = if (comma > 0) CoreText.trim(raw.substring(comma + 1)) else ""
            // Companion EPG/logo requests hash this historical input. It is a
            // wire compatibility field, independent of the corrected label.
            val hashComma = raw.indexOf(',')
            val titleHashInput = if (hashComma == comma) title
                else if (hashComma > 0) CoreText.trim(raw.substring(hashComma + 1)) else ""
            val epgId = if (generic) "" else attribute(raw, "tvg-id")
            val epgName = if (generic) "" else attribute(raw, "tvg-name")
            val name = if (generic) if (comma > 0) title else "???"
                else if (comma > 0) title.ifEmpty { epgName }.ifEmpty { epgId } else ""
            val generated = !generic && name.isEmpty()
            val id = hash(url)
            if (group.isNotEmpty() && id != 0.0) groups.getOrPut(group) {
                categories[group] = groups.size + 2
                mutableListOf()
            }.add(id)
            if (url.isEmpty() || entries.containsKey(id)) continue
            val logo = if (generic) quoted(raw, "tvg-logo") else attribute(raw, "tvg-logo").takeIf { it.startsWith("//") || it.startsWith("http", true) }.orEmpty()
            val shift = if (generic) 0.0 else floatPrefix(attribute(raw, "tvg-shift")).let { if (it.isNaN() || it == 0.0) 0.0 else kotlin.math.floor(it * -3600) }
            entries[id] = ProviderPlaylistEntry(id, name, url, group, categories[group] ?: 1, logo, epgId,
                if (generic) name else epgName, if (generic) 0.0 else hours(raw, defaultHours),
                if (generic) "" else attribute(raw, "catchup").ifEmpty { attribute(raw, "catchup-type") }.ifEmpty { defaultMode },
                if (generic) "" else attribute(raw, "catchup-source").ifEmpty { defaultSource }, shift, raw,
                titleHashInput, generated)
        }
        return ProviderPlaylistResult(header, entries.values.toList(), groups, groups.keys.toList())
    }
}
