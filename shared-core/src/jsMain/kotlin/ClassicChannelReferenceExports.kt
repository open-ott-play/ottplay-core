@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

/** Only scalar type/coercion at this boundary; no traversal of untrusted arbitrary row objects. */
private fun classicReferenceValue(value: dynamic): ProviderValue = when (jsTypeOf(value)) {
    "string" -> ProviderValue.text(value.unsafeCast<String>())
    "number" -> ProviderValue(ProviderValueKind.NUMBER, js("String(value)").unsafeCast<String>())
    "undefined" -> ProviderValue.missing
    else -> ProviderValue.nil
}

private fun classicReferenceNumberString(decimal: String): String? {
    val number: dynamic = js("Number(decimal)")
    return if (js("isFinite(number)").unsafeCast<Boolean>()) js("String(number)").unsafeCast<String>() else null
}

/** Stable classic ABI: create(channels, aliases).resolve(value, origin) / .project(reference). */
@JsExport fun createClassicChannelReferences(channels: dynamic, aliases: dynamic): dynamic {
    val rows = js("Object.keys(channels || {})").unsafeCast<Array<String>>().mapNotNull { key ->
        val row = channels[key]
        val number = classicChannelReferenceNumberKey(ProviderValue.text(key), ::classicReferenceNumberString)
        if (!js("Boolean(row)").unsafeCast<Boolean>() || number == null) null
        else {
            val item = row.itemId
            val itemId = if (js("Boolean(item)").unsafeCast<Boolean>()) js("String(item)").unsafeCast<String>() else null
            val firstLegacy = row.legacyChannelId
            val legacy = if (jsTypeOf(firstLegacy) == "undefined") ProviderValue.missing else classicReferenceValue(row.legacyChannelId)
            ClassicChannelReferenceRow(key, itemId, legacy)
        }
    }
    val links = js("Object.keys(aliases || {})").unsafeCast<Array<String>>().map { key -> key to classicReferenceValue(aliases[key]) }
    val graph = ClassicChannelReferences(rows, links, ::classicReferenceNumberString)
    val result: dynamic = js("({})")
    result.resolve = { value: dynamic, origin: dynamic ->
        val resolved = graph.resolve(classicReferenceValue(value), if (js("origin === 'canonical'").unsafeCast<Boolean>()) "canonical" else "raw")
        val reference: dynamic = js("({})")
        if (resolved.itemId != null) reference.itemId = resolved.itemId else {
            reference.legacyId = value
            reference.origin = origin
            if (resolved.ambiguous) reference.ambiguous = true
        }
        reference
    }
    result.project = { reference: dynamic ->
        if (reference != null && jsTypeOf(reference.itemId) == "string") graph.project(ClassicChannelReference(itemId = reference.itemId.unsafeCast<String>())) else null
    }
    return result
}
