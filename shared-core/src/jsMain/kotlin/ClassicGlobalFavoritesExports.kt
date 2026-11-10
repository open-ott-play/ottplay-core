@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

private val classicFavoritesInvalid: dynamic = js("({})")

/** Inspect descriptors before copying: wire(original) would invoke hostile getters. */
private fun classicFavoritesSnapshot(value: dynamic, depth: Int = 0): dynamic {
    if (value == null || jsTypeOf(value) in listOf("undefined", "string", "number", "boolean")) return value
    if (jsTypeOf(value) != "object" || depth > 6) return classicFavoritesInvalid
    if (js("Array.isArray(value)").unsafeCast<Boolean>()) {
        val lengthDescriptor: dynamic = js("Object.getOwnPropertyDescriptor(value, 'length')")
        if (lengthDescriptor == null || !js("'value' in lengthDescriptor").unsafeCast<Boolean>()) return classicFavoritesInvalid
        val length = lengthDescriptor.value.unsafeCast<Double>()
        if (!length.isFinite() || length < 0 || kotlin.math.floor(length) != length || length > 1000) return classicFavoritesInvalid
        val result: dynamic = js("[]")
        for (at in 0 until length.toInt()) {
            val key = at.toString()
            val descriptor: dynamic = js("Object.getOwnPropertyDescriptor(value, key)")
            if (descriptor != null && !js("'value' in descriptor").unsafeCast<Boolean>()) return classicFavoritesInvalid
            val child = classicFavoritesSnapshot(if (descriptor == null) js("undefined") else descriptor.value, depth + 1)
            if (child === classicFavoritesInvalid) return classicFavoritesInvalid
            val property: dynamic = js("({writable: true, enumerable: true, configurable: true})")
            property.value = child
            js("Object.defineProperty")(result, key, property)
        }
        return result
    }
    val keys = js("Object.getOwnPropertyNames(value)").unsafeCast<Array<String>>()
    if (keys.size > 6) return classicFavoritesInvalid
    val symbols: dynamic = js("Object.getOwnPropertySymbols")
    if (jsTypeOf(symbols) == "function" && symbols(value).length.unsafeCast<Int>() != 0) return classicFavoritesInvalid
    val result: dynamic = js("Object.create(null)")
    for (key in keys) {
        val descriptor: dynamic = js("Object.getOwnPropertyDescriptor(value, key)")
        if (descriptor == null || descriptor.enumerable != true || !js("'value' in descriptor").unsafeCast<Boolean>()) return classicFavoritesInvalid
        val child = classicFavoritesSnapshot(descriptor.value, depth + 1)
        if (child === classicFavoritesInvalid) return classicFavoritesInvalid
        result[key] = child
    }
    return result
}

private fun classicFavoritesWire(value: dynamic): ProviderValue {
    val snapshot = classicFavoritesSnapshot(value)
    return if (snapshot === classicFavoritesInvalid) ProviderValue.missing else wire(snapshot)
}
private fun classicFavoritesNormalize(value: dynamic): dynamic = try {
    ClassicGlobalFavorites.normalize(classicFavoritesWire(value))?.let(::unwire)
} catch (_: dynamic) { null }
private fun classicFavoritesDocument(value: dynamic): dynamic = try {
    ClassicGlobalFavorites.document(classicFavoritesWire(value))?.let(::unwire)
} catch (_: dynamic) { null }
private fun classicFavoritesStatus(status: String): dynamic {
    val result: dynamic = js("({})"); result.status = status; return result
}

/** Opaque candidates stay in JS. Read inherited data properties without invoking accessors. */
private fun classicFavoritesData(value: dynamic, key: String): dynamic {
    if (value == null) throw js("new Error('Invalid favorite candidate')")
    if (jsTypeOf(value) != "object" && jsTypeOf(value) != "function") return js("undefined")
    var at = value
    val seen: dynamic = js("[]")
    while (at != null) {
        if (seen.length.unsafeCast<Int>() >= 256 || seen.indexOf(at).unsafeCast<Int>() >= 0) throw js("new Error('Invalid favorite candidate prototype')")
        seen.push(at)
        val descriptor: dynamic = js("Object.getOwnPropertyDescriptor(at, key)")
        if (descriptor != null) {
            if (!js("'value' in descriptor").unsafeCast<Boolean>()) throw js("new Error('Favorite accessors are not data')")
            return descriptor.value
        }
        at = js("Object.getPrototypeOf(at)")
    }
    return js("undefined")
}

private fun classicFavoritesMatch(value: dynamic, candidates: dynamic, verify: dynamic, current: dynamic): dynamic {
    val row = classicFavoritesNormalize(value)
    if (row == null || !js("Array.isArray(candidates)").unsafeCast<Boolean>()) return classicFavoritesStatus("invalid")
    try {
        val freshness: dynamic = current()
        if (!js("Boolean(freshness)").unsafeCast<Boolean>()) return classicFavoritesStatus("stale")
        val length = classicFavoritesData(candidates, "length").unsafeCast<Double>()
        if (!length.isFinite() || length < 0 || kotlin.math.floor(length) != length || length > 2147483647.0) return classicFavoritesStatus("unresolved")
        val opaque = mutableListOf<dynamic>()
        val origins = mutableListOf<ProviderValue>()
        for (at in 0 until length.toInt()) {
            val key = at.toString()
            // Array.filter skips absent slots but observes inherited data slots.
            if (!js("key in candidates").unsafeCast<Boolean>()) continue
            val candidate = classicFavoritesData(candidates, key)
            val origin = classicFavoritesData(candidate, "origin")
            opaque.add(candidate)
            origins += classicFavoritesWire(origin)
        }
        val selected = ClassicGlobalFavorites.matchOrigin(wire(row), origins)
        if (selected.status != "selected") return classicFavoritesStatus(selected.status)
        val candidate = opaque[selected.index]
        val verified: dynamic = verify(candidate, row.locator)
        val stillCurrent: dynamic = current()
        if (!js("Boolean(stillCurrent)").unsafeCast<Boolean>()) return classicFavoritesStatus("stale")
        if (verified !== true) return classicFavoritesStatus("unresolved")
        val result: dynamic = js("({})")
        result.candidate = candidate; result.entry = row; result.status = "matched"
        return result
    } catch (_: dynamic) { return classicFavoritesStatus("unresolved") }
}

/** Same seven-method plain-object API as the classic portable v1 codec. */
@JsExport
fun createClassicGlobalFavoritesPortableCodec(): dynamic {
    val result: dynamic = js("({})")
    result.normalize = { value: dynamic -> classicFavoritesNormalize(value) }
    result.document = { value: dynamic -> classicFavoritesDocument(value) }
    result.identity = { value: dynamic -> try { ClassicGlobalFavorites.identity(classicFavoritesWire(value)) } catch (_: dynamic) { "" } }
    result.providerId = { value: dynamic ->
        if (jsTypeOf(value) in listOf("string", "number")) ClassicGlobalFavorites.providerId(wire(value)) else null
    }
    result.requiredLocatorKinds = { value: dynamic ->
        try { ClassicGlobalFavorites.requiredLocatorKinds(classicFavoritesWire(value))?.toTypedArray() } catch (_: dynamic) { null }
    }
    result.supports = { value: dynamic, kinds: dynamic ->
        try { ClassicGlobalFavorites.supports(classicFavoritesWire(value), classicFavoritesWire(kinds)) } catch (_: dynamic) { false }
    }
    result.match = { value: dynamic, candidates: dynamic, verify: dynamic, current: dynamic -> classicFavoritesMatch(value, candidates, verify, current) }
    return result
}
