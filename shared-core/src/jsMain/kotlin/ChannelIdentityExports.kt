@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.*

private fun identityEncode(value: String): String = js("encodeURIComponent(value)").unsafeCast<String>()
private fun identityDecode(value: String): String = js("decodeURIComponent(value)").unsafeCast<String>()
private fun identityJson(left: ProviderValue, right: ProviderValue): Boolean {
    val a = unwire(left); val b = unwire(right)
    return try { js("JSON.stringify(a) === JSON.stringify(b)").unsafeCast<Boolean>() } catch (_: Throwable) { false }
}
private fun identityMetadata(left: ProviderValue, right: ProviderValue): Boolean {
    val a = unwire(left); val b = unwire(right)
    return js("typeof a === typeof b").unsafeCast<Boolean>() && identityJson(left, right)
}
internal fun restoration() = ChannelRestoration(::identityEncode, ::identityDecode, ::identityMetadata)
private fun identityCore(fingerprint: (String) -> String) = ChannelIdentity(restoration(), ::identityEncode, fingerprint, ::identityJson)
@JsExport fun channelReference(channel: dynamic, source: dynamic): dynamic {
    val owner: dynamic = js("source || channel.sourceId")
    val result = unwire(restoration().reference(wire(channel), js("String(owner)").unsafeCast<String>()))
    result.sourceId = owner
    return result
}
@JsExport fun restoreChannelIndex(items: dynamic, reference: dynamic): Int = restoration().restore(wire(items).elements, wire(reference))
@JsExport fun channelDescriptor(item: dynamic, source: String, fingerprint: (String) -> String): dynamic = unwire(identityCore(fingerprint).descriptor(wire(item), source))
@JsExport fun rememberChannelIdentity(state: dynamic, items: dynamic, source: String, fingerprint: (String) -> String): dynamic = unwire(identityCore(fingerprint).remember(wire(state), wire(items).elements, source))
@JsExport fun reconcileChannelIdentity(state: dynamic, items: dynamic, source: String, fingerprint: (String) -> String): dynamic {
    val result = identityCore(fingerprint).reconcile(wire(state), wire(items).elements, source)
    val output: dynamic = js("({})"); output.state = unwire(result.first); output.report = unwire(result.second); return output
}
@JsExport fun channelIdentityPermission(report: dynamic, id: String, protectedIds: Array<String>): String = identityCore { "" }.permission(wire(report), id, protectedIds.toList())
