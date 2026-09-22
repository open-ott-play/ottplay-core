@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.*

@JsExport fun classicPortableKey(key: String, storage: Boolean): Boolean = ClassicDurableState.portableKey(key, storage)
@JsExport fun classicPortableSnapshot(items: dynamic, storage: Boolean): dynamic {
    if (storage && (items == null || jsTypeOf(items) != "object" || js("Array.isArray(items)").unsafeCast<Boolean>())) throw js("new Error('Invalid settings snapshot')")
    val result: dynamic = if (storage) js("Object.create(null)") else js("({})")
    js("Object.keys(items)").unsafeCast<Array<String>>().forEach { key -> if (ClassicDurableState.portableKey(key, storage)) result[key] = items[key] }
    return result
}
@JsExport fun classicInstallationState(current: dynamic, storage: Boolean): dynamic = unwire(ClassicDurableState.installation(wire(current), storage))
@JsExport fun classicImportEnvelope(env: dynamic): Boolean {
    if (env == null || !ClassicDurableState.validEnvelope(wire(env.version), wire(env.settings))) return false
    if (!js("Array.isArray(env.parentalArray)").unsafeCast<Boolean>()) env.parentalArray = js("[]")
    if (!js("Array.isArray(env.favoritesArray)").unsafeCast<Boolean>()) env.favoritesArray = js("[]")
    return true
}
@JsExport fun classicParentalPrompt(enabled: dynamic, pin: dynamic, granted: dynamic): Boolean = ClassicDurableState.parentalPrompt(js("Boolean(enabled)").unsafeCast<Boolean>(), js("pin === '*'").unsafeCast<Boolean>(), js("Boolean(granted)").unsafeCast<Boolean>())
@JsExport fun classicHistorySelection(history: dynamic, item: dynamic, streamUrl: String, playType: dynamic, limitIndex: dynamic): dynamic {
    var index = -1
    for (i in 0 until history.length.unsafeCast<Int>()) {
        val row = history[i]
        val urlMatches = js("row.stream_url === item.stream_url").unsafeCast<Boolean>()
        val hasSource = js("Boolean(item.vportalSource)").unsafeCast<Boolean>()
        val hasRequest = js("Boolean(item.request && row.request)").unsafeCast<Boolean>()
        val sourceMatches = js("row.vportalSource === item.vportalSource").unsafeCast<Boolean>()
        // Preserve short-circuiting: opaque request serialization runs only when required.
        val requestMatches = if (!urlMatches && hasSource && hasRequest && sourceMatches) js("JSON.stringify(row.request) === JSON.stringify(item.request)").unsafeCast<Boolean>() else false
        if (ClassicDurableState.historyMatch(urlMatches, hasSource, hasRequest, sourceMatches, requestMatches)) { index = i; break }
    }
    val result: dynamic = js("({})")
    val sameUrl = index >= 0 && js("history[index].stream_url === streamUrl").unsafeCast<Boolean>()
    result.skip = ClassicDurableState.historyAlreadyPlaying(index, js("playType === -1e11").unsafeCast<Boolean>(), sameUrl)
    val position: dynamic = if (index >= 0) history[index].current else 0
    result.resume = if (index >= 0) ClassicDurableState.historyResume(if (position == null) 0.0 else js("Number(position)").unsafeCast<Double>()) else 0.0
    result.index = index; result.limit = ClassicDurableState.historyLimit(wire(limitIndex)); return result
}
