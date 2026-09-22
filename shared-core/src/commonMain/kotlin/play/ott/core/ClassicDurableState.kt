package play.ott.core

/** Classic persistence profile preserves installation authority and original list ordering. */
object ClassicDurableState {
    private val installation = listOf("commandServerAddress", "commandServerToken", "commandServerEnabled", "localHttpEnabled", "localHttpDeviceCode")
    fun portableKey(key: String, storage: Boolean): Boolean = if (storage) key !in listOf("commandServerAddress", "commandServerToken", "commandServerEnabled", "sLocalHttpEnabled", "sLocalHttpDeviceCode", "stb_settings_backup") else key !in installation
    fun validEnvelope(version: ProviderValue, settings: ProviderValue): Boolean = version.kind == ProviderValueKind.NUMBER && version.number() == 1.0 && (settings.isObject || settings.isArray)
    fun installation(current: ProviderValue, storage: Boolean): ProviderValue {
        fun field(name: String): ProviderValue = current[name].takeIf { it.truthy() } ?: ProviderValue.text("")
        fun n(v: Int) = ProviderValue(ProviderValueKind.NUMBER, v.toString())
        val enabled = if (storage) current["sLocalHttpEnabled"].string() == "1" else current["localHttpEnabled"].kind == ProviderValueKind.NUMBER && current["localHttpEnabled"].number() == 1.0
        return ProviderValue.obj(linkedMapOf("commandServerAddress" to field("commandServerAddress"), "commandServerToken" to field("commandServerToken"),
            "commandServerEnabled" to if (storage) ProviderValue.text("0") else n(0),
            (if (storage) "sLocalHttpEnabled" else "localHttpEnabled") to if (storage) ProviderValue.text(if (enabled) "1" else "0") else n(if (enabled) 1 else 0),
            (if (storage) "sLocalHttpDeviceCode" else "localHttpDeviceCode") to field(if (storage) "sLocalHttpDeviceCode" else "localHttpDeviceCode")))
    }
    fun parentalPrompt(enabled: Boolean, pinDisabled: Boolean, granted: Boolean): Boolean = enabled && !pinDisabled && !granted
    fun historyLimit(index: ProviderValue): Int {
        val key = index.string()
        return when (key) { "0" -> 0; "1" -> 10; "2" -> 20; "3" -> 30; "4" -> 40; "5" -> 50; else -> 20 }
    }
    fun historyMatch(urlMatches: Boolean, hasSource: Boolean, hasRequest: Boolean, sourceMatches: Boolean, requestMatches: Boolean): Boolean =
        urlMatches || hasSource && hasRequest && sourceMatches && requestMatches
    fun historyAlreadyPlaying(index: Int, mediaMode: Boolean, sameUrl: Boolean): Boolean = index == 0 && mediaMode && sameUrl
    fun historyResume(seconds: Double): Double = kotlin.math.floor(seconds / 60) * 60
}
