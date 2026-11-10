@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.CloudStorageFailure
import play.ott.core.CloudStorageFraming

private fun cloudStorageRegex(pattern: String, flags: String = "g"): dynamic = js("new RegExp(pattern, flags)")
private val cloudStorageEscapedUnits: dynamic = cloudStorageRegex(CloudStorageFraming.escapedUnitsPattern)
private val cloudStorageForbiddenRaw: dynamic = cloudStorageRegex(CloudStorageFraming.forbiddenQuotedRawPattern, "")
private val cloudStorageEntities: dynamic = cloudStorageRegex(CloudStorageFraming.entityTokensPattern)
private val cloudStorageXmlEscapes: List<Pair<dynamic, String>> = CloudStorageFraming.xmlEscapes.map { (token, text) -> Pair<dynamic, String>(cloudStorageRegex(token), text) }
private fun cloudStorageMakeEntities(): dynamic {
    val result: dynamic = js("Object.create(null)")
    CloudStorageFraming.xmlEscapes.forEach { (token, text) -> result[text] = token }
    return result
}
private val cloudStorageEntityMap: dynamic = cloudStorageMakeEntities()

/** Native string primitives use common-owned patterns/entities and preserve JSON engine grammar. */
private fun cloudStorageQuoted(value: String): String {
    var result: dynamic = js("JSON.stringify")(value)
    result = result.replace(cloudStorageEscapedUnits, { unit: String -> CloudStorageFraming.unicodeEscape(unit[0].code) })
    cloudStorageXmlEscapes.forEach { (pattern, text) -> result = result.replace(pattern, text) }
    return result.unsafeCast<String>()
}
private fun cloudStorageDecoded(value: String): String {
    if (cloudStorageForbiddenRaw.test(value).unsafeCast<Boolean>()) throw CloudStorageFailure()
    val entities = cloudStorageEntityMap
    val json: dynamic = value.asDynamic().replace(cloudStorageEntities, { token: String ->
        val decoded: dynamic = entities[token]
        if (jsTypeOf(decoded) != "string") throw CloudStorageFailure()
        decoded
    })
    val decoded: dynamic = js("JSON.parse")(json)
    if (jsTypeOf(decoded) != "string") throw CloudStorageFailure()
    return decoded.unsafeCast<String>()
}

private fun cloudStorageRead(value: dynamic, versionedOnly: Boolean): dynamic {
    try {
        if (jsTypeOf(value) != "string") throw CloudStorageFailure()
        val rows = CloudStorageFraming.read(value.unsafeCast<String>(), versionedOnly, if (versionedOnly) 10000 else Int.MAX_VALUE, ::cloudStorageDecoded) ?: return null
        val result: dynamic = js("Object.create(null)")
        rows.forEach { (key, text) -> result[key] = text }
        return result
    } catch (_: CloudStorageFailure) { throw js("new Error('Invalid cloud settings document')") }
}

/** Pure raw-string transport. Filtering, PIN preparation and durable writes stay in the host. */
@JsExport fun readClassicCloudStorage(value: dynamic): dynamic = cloudStorageRead(value, false)
@JsExport fun readVersionedCloudStorage(value: dynamic): dynamic = cloudStorageRead(value, true)
@JsExport fun cloudStorageHeader(): String = CloudStorageFraming.header
@JsExport fun cloudStorageEntry(key: dynamic, value: dynamic): String {
    try {
        if (jsTypeOf(key) != "string" || jsTypeOf(value) != "string") throw CloudStorageFailure()
        return CloudStorageFraming.entry(key.unsafeCast<String>(), value.unsafeCast<String>(), ::cloudStorageQuoted)
    } catch (_: CloudStorageFailure) { throw js("new Error('Invalid cloud settings document')") }
}
