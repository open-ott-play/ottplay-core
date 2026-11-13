package play.ott.core

class CloudStorageFailure : Exception("Invalid cloud settings document")

/** Raw storage strings, not settings policy. Legacy literal XML and storage-v2 are distinct profiles. */
object CloudStorageFraming {
    const val declaration = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
    const val doctype = "<!DOCTYPE properties SYSTEM \"http://java.sun.com/dtd/properties.dtd\">"
    const val marker = "<!--ottplay-storage-v2-->"
    // Native JS string operations consume these same policy tokens; no second regex contract.
    const val escapedUnitsPattern = "[\\u0000-\\u001f\\ud800-\\udfff\\ufffe\\uffff]"
    val forbiddenQuotedRawPattern = escapedUnitsPattern.dropLast(1) + "<]"
    val xmlEscapes = listOf("&" to "&amp;", "<" to "&lt;", ">" to "&gt;", "\"" to "&quot;", "'" to "&apos;")
    val entityTokensPattern = xmlEscapes.joinToString("|") { it.second } + "|[<&]"
    private const val comment = "<comment>OTT-Play Preferences</comment>"
    val header = listOf(declaration, doctype, marker, "<properties>", comment).joinToString("\n")
    private fun fail(): Nothing = throw CloudStorageFailure()
    fun validKey(value: String): Boolean = value != "__proto__" && value != "constructor" && value != "prototype"
    fun entity(token: String): String? = xmlEscapes.firstOrNull { it.second == token }?.first
    fun unicodeEscape(code: Int): String = "\\u" + code.toString(16).padStart(4, '0')

    /** Match JSON.stringify's escapes, then escape XML, preserving every UTF16 code unit. */
    fun quoted(value: String): String = buildString {
        append("&quot;")
        var begin = 0
        value.forEachIndexed { index, c ->
            val escape = when (c) { '&' -> "&amp;"; '<' -> "&lt;"; '>' -> "&gt;"; '\'' -> "&apos;"; '"' -> "\\&quot;"; '\\' -> "\\\\"; '\b' -> "\\b"; '\t' -> "\\t"; '\n' -> "\\n"; '\u000c' -> "\\f"; '\r' -> "\\r"; else -> null }
                ?: if (c.code < 32 || c.code in 0xd800..0xdfff || c.code >= 0xfffe) unicodeEscape(c.code) else null
            if (escape != null) { append(value, begin, index); append(escape); begin = index + 1 }
        }
        append(value, begin, value.length)
        append("&quot;")
    }
    fun entry(key: String, value: String, quoteString: ((String) -> String)? = null): String {
        if (!validKey(key)) fail()
        return "<entry key=\"" + (quoteString?.invoke(key) ?: quoted(key)) + "\">" + (quoteString?.invoke(value) ?: quoted(value)) + "</entry>"
    }

    private fun decoded(value: String, nativeString: ((String) -> String)?): String {
        if (nativeString != null) return nativeString(value)
        if (value.any { it.code < 32 || it.code in 0xd800..0xdfff || it.code >= 0xfffe || it == '<' }) fail()
        val json = buildString {
            var at = 0
            while (true) {
                val amp = value.indexOf('&', at)
                if (amp < 0) { append(value, at, value.length); break }
                append(value, at, amp)
                at = amp + 1
                    val end = value.indexOf(';', at)
                    if (end < 0) fail()
                    append(entity(value.substring(amp, end + 1)) ?: fail())
                    at = end + 1
            }
        }
        var at = 0
        fun space() { while (at < json.length && json[at] == ' ') at++ }
        space()
        if (at >= json.length || json[at++] != '"') fail()
        val result = StringBuilder()
        var closed = false
        while (at < json.length) {
            val c = json[at++]
            if (c == '"') { closed = true; break }
            if (c != '\\') result.append(c)
            else {
                if (at >= json.length) fail()
                result.append(when (json[at++]) {
                    '"' -> '"'; '\\' -> '\\'; '/' -> '/'; 'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                    'u' -> {
                        if (at + 4 > json.length) fail()
                        var code = 0
                        repeat(4) {
                            val digit = json[at++]
                            code = code * 16 + when (digit) { in '0'..'9' -> digit - '0'; in 'a'..'f' -> digit - 'a' + 10; in 'A'..'F' -> digit - 'A' + 10; else -> fail() }
                        }
                        code.toChar()
                    }
                    else -> fail()
                })
            }
        }
        if (!closed) fail()
        space()
        if (at != json.length) fail()
        return result.toString()
    }

    /** Null means no exact storage-v2 prefix in versioned-only mode, leaving legacy parsing to its host profile. */
    fun read(xml: String, versionedOnly: Boolean = false, maximumEntries: Int = Int.MAX_VALUE, nativeString: ((String) -> String)? = null): List<Pair<String, String>>? {
        if (maximumEntries < 0) fail()
        var at = if (xml.startsWith('\ufeff')) 1 else 0
        fun space() { while (at < xml.length && xml[at] in "\t\n\r ") at++ }
        fun take(token: String): Boolean {
            if (!xml.startsWith(token, at)) return false
            at += token.length
            return true
        }
        fun expect(token: String) { if (!take(token)) fail() }
        space(); take(declaration); space(); take(doctype); space()
        val versioned = take(marker)
        if (versionedOnly && !versioned) return null
        space(); expect("<properties>"); space(); expect(comment)
        val seen = mutableSetOf<String>()
        val result = mutableListOf<Pair<String, String>>()
        while (true) {
            space()
            if (take("</properties>")) break
            if (result.size >= maximumEntries) fail()
            expect("<entry key=\"")
            var end = xml.indexOf("\">", at)
            if (end < 0) fail()
            var key = xml.substring(at, end)
            if (key.any { it == '"' || it == '<' }) fail()
            at = end + 2
            end = xml.indexOf("</entry>", at)
            if (end < 0) fail()
            var value = xml.substring(at, end)
            at = end + 8
            if (versioned) { key = decoded(key, nativeString); value = decoded(value, nativeString) }
            else {
                // A raw legacy value may contain markup; structural tokens are ambiguous and rejected.
                if (value.contains("<!") || value.contains("<?")) fail()
                for (token in listOf("<entry", "</entry", "<properties", "</properties")) {
                    var found = value.indexOf(token)
                    while (found >= 0) {
                        val after = found + token.length
                        if (after < value.length && value[after] in "\t\n\r >") fail()
                        found = value.indexOf(token, after)
                    }
                }
            }
            if (!validKey(key) || !seen.add(key)) fail()
            result += key to value
        }
        space()
        if (at != xml.length) fail()
        return result
    }
}
