package play.ott.core

class OperatorSourceFailure(val code: String) : Exception(code)

object OperatorSources {
    fun validId(id: String, native: Boolean = false): Boolean = if (native) id.isNotBlank() else CoreText.trim(id).isNotEmpty()
    fun namespace(id: ProviderValue): String = id.trimmed().also { if (it.isEmpty()) throw OperatorSourceFailure("SOURCE_ID") }
    fun credentials(kind: String, username: String, password: String, mac: String, native: Boolean): String = when {
        kind == "xtream" && (if (native) username.isBlank() || password.isBlank() else username.isEmpty() || password.isEmpty()) -> "SOURCE_CREDENTIALS"
        native && kind == "stalker" && !StalkerProtocol.validMac(mac) -> "STALKER_MAC"
        else -> ""
    }
    fun browser(source: ProviderValue, checkedUrl: String): ProviderValue {
        fun text(value: String) = ProviderValue.text(value)
        fun nullish(value: ProviderValue) = if (value.present) value.string() else ""
        val type = source["type"].trimmed().lowercase()
        val username = nullish(source["username"]); val password = nullish(source["password"])
        if (checkedUrl.isEmpty()) throw OperatorSourceFailure("SOURCE_URL")
        if (type !in listOf("m3u", "xtream", "stalker")) throw OperatorSourceFailure("UNSUPPORTED_PROVIDER")
        val failure = credentials(type, username, password, source["mac"].trimmed(), false)
        if (failure.isNotEmpty()) throw OperatorSourceFailure(failure)
        return ProviderValue.obj(linkedMapOf(
            "id" to text(source["id"].string()), "type" to text(type), "url" to text(checkedUrl),
            "username" to text(username), "password" to text(password), "mac" to text(source["mac"].trimmed().uppercase()),
            "timezone" to text(source["timezone"].trimmed().ifEmpty { "UTC" }), "language" to text(source["language"].trimmed().ifEmpty { "en" }),
            "output" to text(if (source["output"].kind == ProviderValueKind.TEXT && source["output"].scalar == "ts") "ts" else "m3u8"),
            "profile" to if (source["profile"].truthy()) source["profile"] else ProviderValue.obj()))
    }
    fun relationship(mode: String, kind: String, sourceId: String, entryKind: String, entrySourceId: String): String = when (mode) {
        "android-episodes" -> if (kind != "xtream" || entryKind != "series" || entrySourceId != sourceId) "EPISODES" else ""
        "android-resolve" -> when { entrySourceId != sourceId -> "SOURCE_MISMATCH"; entryKind == "series" -> "FOLDER_REQUIRED"; else -> "" }
        "browser-browse" -> when { entrySourceId != sourceId -> "SOURCE_MISMATCH"; entryKind != "folder" -> "FOLDER_REQUIRED"; else -> "" }
        "browser-resolve" -> if (entryKind == "folder") "FOLDER_REQUIRED" else ""
        else -> error("Unsupported source relationship mode")
    }
}
