@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

@JsExport
fun streamingGuideIdentities(rows: dynamic): dynamic = StreamingGuide.identities(rows.unsafeCast<Array<dynamic>>().map { row ->
    StreamingGuideIdentity((row.tvgId ?: "").unsafeCast<String>(), (row.tvgName ?: "").unsafeCast<String>(),
        (row.name ?: "").unsafeCast<String>(), (row.archiveDays ?: 0.0).unsafeCast<Double>())
}).map { arrayOf(it.id, it.tvgName, it.name, it.days) }.toTypedArray()

@JsExport
class StreamingGuideFilter(requested: dynamic, clock: Double, programmeLimit: Double, perChannel: Double) {
    private val guide = StreamingGuide<Any>(requested.unsafeCast<Array<dynamic>>().map { row ->
        StreamingGuideIdentity(row[0].unsafeCast<String>(), row[1].unsafeCast<String>(), row[2].unsafeCast<String>(), row[3].unsafeCast<Double>())
    }, clock, programmeLimit, perChannel)

    fun channel(id: String, names: Array<String>, icon: String): Boolean = guide.channel(id, names.toList(), icon)
    fun accepts(id: String, start: Double?, end: Double?): Boolean = guide.accepts(id, start, end)
    fun programme(id: String, start: Double, end: Double?, payload: dynamic) = guide.programme(id, start, end, payload.unsafeCast<Any>())
    fun output(limit: Double, channel: (String, Array<String>, String) -> String, programme: (String, dynamic) -> String,
        bytes: (String) -> Int, emit: (String) -> Unit): dynamic {
        val coverage = guide.output(limit, { channel(it.id, it.names.toTypedArray(), it.logo) }, programme, bytes, emit) ?: return null
        val result: dynamic = js("({})")
        result.start = coverage.start; result.end = coverage.end; result.programmeLimit = coverage.programmeLimit
        result.truncatedChannels = coverage.truncatedChannels
        return result
    }
}
