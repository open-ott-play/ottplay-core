package play.ott.core

/** Portable favorites v1 only. Hosts own property descriptors, grants, storage and playback. */
object ClassicGlobalFavorites {
    private fun text(value: String) = ProviderValue.text(value)
    private fun obj(vararg fields: Pair<String, ProviderValue>) = ProviderValue.obj(linkedMapOf(*fields))
    private fun exact(value: ProviderValue, vararg keys: String) =
        value.isObject && value.properties.size == keys.size && keys.all { it in value.properties }
    private fun asciiLetter(c: Char) = c in 'A'..'Z' || c in 'a'..'z'
    private fun alphaNumeric(c: Char) = asciiLetter(c) || c in '0'..'9'
    private fun wellFormed(value: String): Boolean {
        var at = 0
        while (at < value.length) {
            val code = value[at++].code
            if (code in 0xd800..0xdbff) {
                if (at >= value.length || value[at++].code !in 0xdc00..0xdfff) return false
            } else if (code in 0xdc00..0xdfff) return false
        }
        return true
    }
    private fun edgeWhitespace(c: Char) = c.code in 9..13 || c == ' ' || c.code in
        setOf(0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff) || c.code in 0x2000..0x200a
    private fun validText(value: ProviderValue, maximum: Int): Boolean {
        if (value.kind != ProviderValueKind.TEXT) return false
        val s = value.scalar
        return s.isNotEmpty() && s.length <= maximum && wellFormed(s) &&
            !edgeWhitespace(s.first()) && !edgeWhitespace(s.last()) &&
            s.none { it.code in 0..31 || it.code == 127 } && "://" !in s
    }
    private fun identifier(value: ProviderValue, maximum: Int): Boolean {
        if (value.kind != ProviderValueKind.TEXT) return false
        val s = value.scalar
        return s.isNotEmpty() && s.length <= maximum && alphaNumeric(s.first()) &&
            s.all { alphaNumeric(it) || it in "._:-" }
    }
    private fun provider(value: ProviderValue): Boolean {
        if (value.kind != ProviderValueKind.TEXT || value.scalar.length !in 1..64) return false
        return value.scalar.split('/').all { part -> part.isNotEmpty() &&
            (part.first() in 'a'..'z' || part.first() in '0'..'9') &&
            part.all { it in 'a'..'z' || it in '0'..'9' || it in "_.-" } }
    }

    fun origin(value: ProviderValue): ProviderValue? {
        if (!exact(value, "provider", "profile", "subprofile", "sourceAlias") ||
            !provider(value["provider"]) || !validText(value["profile"], 256) ||
            !(value["subprofile"].kind == ProviderValueKind.NULL || validText(value["subprofile"], 256)) ||
            !validText(value["sourceAlias"], 256)) return null
        return obj("profile" to value["profile"], "provider" to value["provider"],
            "sourceAlias" to value["sourceAlias"], "subprofile" to value["subprofile"])
    }

    private fun relative(value: ProviderValue): Boolean {
        if (!validText(value, 8192)) return false
        val s = value.scalar
        if (s.startsWith('/') || '\\' in s || s.length >= 2 && asciiLetter(s[0]) && s[1] == ':') return false
        return s.split('/').all { it.isNotEmpty() && it != "." && it != ".." }
    }

    fun locator(provider: String, value: ProviderValue): ProviderValue? {
        if (provider == "plex") {
            val server = value["serverId"]
            val key = value["ratingKey"]
            if (!exact(value, "kind", "serverId", "ratingKey") || value["kind"].scalar != "plex-media" ||
                value["kind"].kind != ProviderValueKind.TEXT || server.kind != ProviderValueKind.TEXT ||
                server.scalar.length !in 1..256 || !alphaNumeric(server.scalar.first()) ||
                !server.scalar.all { alphaNumeric(it) || it in "._-" } || key.kind != ProviderValueKind.TEXT ||
                key.scalar.length !in 1..20 || key.scalar.first() !in '1'..'9' || !key.scalar.all { it in '0'..'9' }) return null
            return obj("kind" to text("plex-media"), "ratingKey" to key, "serverId" to server)
        }
        if (provider == "local") {
            if (!exact(value, "kind", "rootAlias", "relativePath") || value["kind"].kind != ProviderValueKind.TEXT ||
                value["kind"].scalar != "local-media" || !validText(value["rootAlias"], 256) || !relative(value["relativePath"])) return null
            return obj("kind" to text("local-media"), "relativePath" to value["relativePath"], "rootAlias" to value["rootAlias"])
        }
        if (provider == "vportal" || provider == "m3u" && exact(value, "kind", "idField", "id") &&
            value["kind"].kind == ProviderValueKind.TEXT && value["kind"].scalar == "vportal-media") {
            if (!exact(value, "kind", "idField", "id") || value["kind"].kind != ProviderValueKind.TEXT ||
                value["kind"].scalar != "vportal-media" || value["idField"].kind != ProviderValueKind.TEXT ||
                value["idField"].scalar !in listOf("id", "fid", "stream_id", "itemId", "media_id", "episode_id") ||
                !identifier(value["id"], 256)) return null
            return obj("id" to value["id"], "idField" to value["idField"], "kind" to text("vportal-media"))
        }
        if (exact(value, "kind", "name", "group") && value["kind"].kind == ProviderValueKind.TEXT && value["kind"].scalar == "channel-name") {
            if (!validText(value["name"], 1024) || !(value["group"].kind == ProviderValueKind.NULL || validText(value["group"], 256))) return null
            return obj("group" to value["group"], "kind" to text("channel-name"), "name" to value["name"])
        }
        val id = value["channelId"]
        if (!exact(value, "kind", "channelId") || value["kind"].kind != ProviderValueKind.TEXT || value["kind"].scalar != "channel" ||
            !identifier(id, 256) || id.scalar.startsWith("channel:") && id.scalar.drop(8).let { s -> s.isNotEmpty() && s.all { it in '0'..'9' } }) return null
        return obj("channelId" to id, "kind" to text("channel"))
    }

    fun providerId(value: ProviderValue): String? {
        val candidate = if (value.kind == ProviderValueKind.NUMBER) {
            val number = value.number()
            if (!number.isFinite() || number < 0 || number > 9007199254740991.0 || kotlin.math.floor(number) != number) return null
            text(number.toLong().toString())
        } else value
        return if (identifier(candidate, 256)) candidate.scalar else null
    }

    fun normalize(value: ProviderValue): ProviderValue? {
        if (!exact(value, "title", "origin", "locator") || !validText(value["title"], 1024)) return null
        val origin = origin(value["origin"]) ?: return null
        val locator = locator(origin["provider"].scalar, value["locator"]) ?: return null
        return obj("locator" to locator, "origin" to origin, "title" to value["title"])
    }

    /** ECMAScript JSON spelling for the normalized, data-only v1 shape. */
    private fun json(value: ProviderValue): String = when (value.kind) {
        ProviderValueKind.NULL -> "null"
        ProviderValueKind.TEXT -> buildString {
            append('"')
            value.scalar.forEach { c -> when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (c.code < 32) append("\\u" + c.code.toString(16).padStart(4, '0')) else append(c)
            } }
            append('"')
        }
        ProviderValueKind.NUMBER -> value.number().toLong().toString()
        ProviderValueKind.ARRAY -> value.elements.joinToString(",", "[", "]", transform = ::json)
        ProviderValueKind.OBJECT -> value.properties.entries.joinToString(",", "{", "}") { json(text(it.key)) + ":" + json(it.value) }
        else -> error("Nonportable favorite value")
    }
    fun identity(value: ProviderValue): String {
        val row = normalize(value) ?: return ""
        return json(obj("locator" to row["locator"], "origin" to row["origin"]))
    }
    fun document(value: ProviderValue): ProviderValue? {
        if (!exact(value, "version", "entries") || value["version"].kind != ProviderValueKind.NUMBER ||
            value["version"].number() != 1.0 || !value["entries"].isArray || value["entries"].elements.size > 1000) return null
        val seen = mutableSetOf<String>()
        val rows = mutableListOf<ProviderValue>()
        for (value in value["entries"].elements) {
            val row = normalize(value) ?: return null
            if (!seen.add(identity(row))) return null
            rows += row
        }
        val result = obj("entries" to ProviderValue.array(rows), "version" to ProviderValue(ProviderValueKind.NUMBER, "1"))
        return result.takeIf { json(it).encodeToByteArray().size <= 1048576 }
    }
    fun requiredLocatorKinds(value: ProviderValue): List<String>? = document(value)?.get("entries")?.elements
        ?.map { it["locator"]["kind"].scalar }?.distinct()?.sorted()
    fun supports(value: ProviderValue, advertised: ProviderValue): Boolean {
        val required = requiredLocatorKinds(value) ?: return false
        if (!advertised.isArray || advertised.elements.size > 32) return false
        val kinds = advertised.elements.map { if (it.kind == ProviderValueKind.TEXT && it.scalar.length <= 64) it.scalar else return false }
        return kinds.distinct().size == kinds.size && required.all { it in kinds }
    }

    data class OriginMatch(val status: String, val index: Int = -1)
    /** Hosts retain opaque candidates and perform verify/current checks around this selection. */
    fun matchOrigin(value: ProviderValue, candidates: List<ProviderValue>): OriginMatch {
        val row = normalize(value) ?: return OriginMatch("invalid")
        val key = json(row["origin"])
        val matches = candidates.indices.filter { origin(candidates[it])?.let(::json) == key }
        return when (matches.size) {
            0 -> OriginMatch("missing")
            1 -> OriginMatch("selected", matches[0])
            else -> OriginMatch("ambiguous")
        }
    }
}
