@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

private fun classicLibraryStrings(value: dynamic): List<String> {
    val decoded = wire(value)
    require(decoded.isArray && decoded.elements.all { it.kind == ProviderValueKind.TEXT }) { "Invalid classic library string list" }
    return decoded.elements.map { it.scalar }
}
private fun classicLibraryProvider(value: dynamic): List<ProviderValue> {
    val decoded = wire(value)
    require(decoded.isArray) { "Invalid classic library provider list" }
    return decoded.elements
}
@JsExport fun classicChannelLibraryApiVersion(): Int = ClassicChannelLibrary.API_VERSION
@JsExport fun classicChannelLibraryNeedsProviderContext(request: dynamic): Boolean =
    ClassicChannelLibrary.needsProviderContext(wire(request))
@JsExport fun classicChannelLibraryEmpty(sourceId: String, catalogLocks: dynamic): dynamic =
    unwire(ClassicChannelLibrary.empty(sourceId, classicLibraryStrings(catalogLocks)))
@JsExport fun classicChannelLibraryDecode(value: dynamic, sourceId: String, catalogLocks: dynamic): dynamic {
    val decoded = ClassicChannelLibrary.decode(wire(value), sourceId, classicLibraryStrings(catalogLocks)) ?: return null
    val result = unwire(decoded)
    // The classic decoder uses null-prototype preference dictionaries until the
    // first JSON-cloned host commit. Preserve that ABI, including absent keys
    // named constructor, __proto__ and toString; this is container conversion.
    for (kind in listOf("aspect", "audio", "subtitle", "zoom")) {
        val previous = result.preferences[kind]
        val dictionary: dynamic = js("Object.create(null)")
        js("Object.keys(previous)").unsafeCast<Array<String>>().forEach { key -> dictionary[key] = previous[key] }
        result.preferences[kind] = dictionary
    }
    return result
}
@JsExport fun classicChannelLibraryGroups(state: dynamic, provider: dynamic, resolve: (String) -> String): dynamic =
    unwire(ClassicChannelLibrary.groups(wire(state), classicLibraryProvider(provider), resolve))
@JsExport fun classicChannelLibraryDecision(state: dynamic, provider: dynamic, request: dynamic, resolve: (String) -> String): dynamic {
    val value = ClassicChannelLibrary.decision(wire(state), classicLibraryProvider(provider), wire(request), resolve) { item ->
        val raw = unwire(item); js("String(raw)").unsafeCast<String>()
    }
    val result: dynamic = js("({version: 1})")
    result.accepted = value.accepted; result.commit = value.commit; result.result = unwire(value.result)
    return result
}
@JsExport fun classicChannelLibraryReduce(state: dynamic, provider: dynamic, request: dynamic,
    resolve: (String) -> String, random: () -> Double): dynamic =
    unwire(ClassicChannelLibrary.reduce(wire(state), classicLibraryProvider(provider), wire(request), resolve, random) { item ->
        val raw = unwire(item); js("String(raw)").unsafeCast<String>()
    })
@JsExport fun classicChannelLibraryAddedLocks(locks: dynamic, added: dynamic, unlocks: dynamic): dynamic =
    unwire(ClassicChannelLibrary.addedLocks(wire(locks), wire(added), wire(unlocks)))
