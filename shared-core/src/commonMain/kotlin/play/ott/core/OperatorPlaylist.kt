package play.ott.core

/** Historical operator formats are data profiles. Sessions, requests and UI remain in adapters. */
data class OperatorEntry(
    val id: Any?, val name: String, val generatedName: Boolean, val url: String,
    val group: String, val category: Int, val logo: String, val epgId: String, val epgName: String,
    val hours: Double?, val fallbackHours: String, val mode: String, val archive: String,
    val feed: String, val drm: String, val server: String, val token: String,
)
data class OperatorCatalog(val entries: List<OperatorEntry>, val groups: Map<String, List<Any?>>,
    val groupOrder: List<String>, val malformed: Boolean = false)
data class PlaylistMedia(val name: String, val generatedName: Boolean, val url: String, val logo: String)

object OperatorPlaylist {
    private fun attr(text: String, key: String) = ProviderPlaylist.attribute(text, key)
    private fun integer(text: String, key: String) = ProviderPlaylist.integer(attr(text, key)).let { if (it.isNaN()) 0.0 else it }
    private fun hours(text: String): Double? = listOf("catchup-days", "timeshift", "tvg-rec")
        .firstOrNull { text.contains(it) }?.let { integer(text, it) * 24 }
    private fun mode(text: String) = attr(text, "catchup").ifEmpty { attr(text, "catchup-type") }
    private fun next(lines: List<String>, comments: Boolean): String {
        for (line in lines.drop(1)) {
            val value = CoreText.trim(line)
            if (!comments || !value.startsWith('#')) return value
        }
        return ""
    }
    fun media(text: String): List<PlaylistMedia> = ProviderPlaylist.blocks(text).drop(1).mapNotNull { block ->
        val lines = block.split('\n')
        val comma = Playlist.titleComma(lines[0])
        val title = if (comma < 0) null else lines[0].substring(comma + 1)
        val url = Playlist.recordUri(lines)
        if (url.isEmpty()) null else PlaylistMedia(title?.let(CoreText::trim).orEmpty(), title == null, url, attr(lines[0], "tvg-logo"))
    }
    fun read(text: String, profile: String, hash: (String) -> Double, existing: Set<String> = emptySet()): OperatorCatalog {
        require(profile in listOf("1ott", "only4", "shara-tv", "tvteam", "antifriz", "edem", "kb-team", "shura"))
        val blocks = ProviderPlaylist.blocks(text)
        val header = blocks[0]
        val groups = linkedMapOf<String, MutableList<Any?>>()
        val categories = mutableMapOf<String, Int>()
        val entries = linkedMapOf<Any?, OperatorEntry>()
        val updates = mutableListOf<OperatorEntry>()
        var previousGroup = ""
        var malformed = false
        val extended = profile == "edem" || profile == "kb-team"
        fun addGroup(group: String, id: Any?) {
            if (group.isNotEmpty() && id != null && id != "" && id != 0.0) groups.getOrPut(group) {
                categories[group] = groups.size + 2; mutableListOf()
            }.add(id)
        }
        for (block in blocks.drop(1)) {
            val lines = block.split('\n')
            var raw = lines[0]
            var url = next(lines, extended)
            var group = attr(raw, "group-title")
            var title: String? = when {
                profile == "only4" -> raw.split(',').drop(1).take(100).joinToString(",")
                extended -> raw.indexOf(',').takeIf { it > 0 }?.let { raw.substring(it + 1) }
                else -> raw.split(',').getOrNull(1)
            }?.let(CoreText::trim)
            if (profile == "antifriz") {
                val segments = block.split(',')
                if (segments.size < 2) { malformed = true; break }
                raw = segments[0]
                group = attr(raw, "group-title")
                val content = segments[1].split('\n')
                title = content[0]
                url = content.getOrNull(2).orEmpty().ifEmpty { content.getOrNull(1).orEmpty() }
            } else if (extended) {
                for (line in lines.drop(1)) {
                    val value = CoreText.trim(line)
                    if (!value.startsWith('#')) break
                    if (group.isEmpty() && value.contains("#EXTGRP:")) group = CoreText.trim(value.substringAfter("#EXTGRP:").substringBefore("#EXTGRP:"))
                }
                if (group.isEmpty()) group = previousGroup else previousGroup = group
            } else if ((profile == "shara-tv" || profile == "tvteam") && url.contains("#EXTGRP:")) {
                if (lines.size > 2) url = CoreText.trim(lines[2])
                if (group.isEmpty()) group = CoreText.trim(lines[1].substringAfter("#EXTGRP:").substringBefore("#EXTGRP:"))
            }
            val parts = url.split('/')
            val epg = attr(raw, "tvg-id")
            val epgName = attr(raw, "tvg-name")
            val id: Any? = when (profile) {
                "1ott" -> parts.getOrNull(4).orEmpty().ifEmpty { epg }
                "only4", "shara-tv" -> parts.getOrNull(3).orEmpty()
                "tvteam" -> epgName
                "antifriz" -> parts.getOrNull(5).orEmpty().substringBefore('.')
                "edem" -> lines.getOrNull(1).orEmpty().ifEmpty { url }.split('/').getOrNull(5)
                "kb-team" -> hash(url.substringBefore('?'))
                else -> lines.getOrNull(1)?.split('/')?.getOrNull(4)
            }
            if (profile == "shura" && (id !is String || id !in existing || id.isEmpty())) continue
            val eligible = url.isNotEmpty() && (extended || id != null && id != "")
            if ((profile == "shara-tv" && (!eligible || entries.containsKey(id))) ||
                (profile in listOf("tvteam", "antifriz") && !eligible)) continue
            addGroup(group, id)
            if (profile != "shura" && (!eligible || entries.containsKey(id))) continue
            val logo = attr(raw, "tvg-logo").let {
                if (profile == "antifriz") CoreText.replaceLiteralFirst(it, "https:", "http:")
                else if (extended && !it.startsWith("//") && !it.startsWith("http", true)) "" else it
            }
            val hours = when {
                extended -> hours(raw) ?: hours(header)
                profile == "tvteam" -> integer(raw, "timeshift") * 168
                profile == "antifriz" -> integer(raw, "tvg-rec") * 24
                else -> integer(raw, "catchup-days") * 24
            }
            val entry = OperatorEntry(id, title.orEmpty(), title == null, url, group, categories[group] ?: 1,
                logo, epg, epgName, hours, if (profile == "edem") "0" else "",
                if (extended) mode(raw).ifEmpty { mode(header) } else "",
                attr(raw, "catchup-source").ifEmpty { if (extended) attr(header, "catchup-source") else "" },
                if (extended) attr(raw, "url-tvg").ifEmpty { if (profile == "kb-team") "kbc" else attr(header, "url-tvg").ifEmpty { attr(header, "x-tvg-url") } } else "",
                attr(raw, "drm"), parts.getOrNull(2).orEmpty().substringBefore(':'), parts.getOrNull(4).orEmpty())
            if (profile == "shura") updates.add(entry) else entries[id] = entry
        }
        return OperatorCatalog(if (profile == "shura") updates else entries.values.toList(), groups, groups.keys.toList(), malformed)
    }
}
