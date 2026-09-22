@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.XmltvRecordFormat
import play.ott.core.NativeRecordRules
import play.ott.core.XmltvRecordError

private fun recordFormat(value: String): XmltvRecordFormat = when (value) {
    "swift" -> XmltvRecordFormat.SWIFT
    "android" -> XmltvRecordFormat.ARCHIVED_ANDROID
    "active-android" -> XmltvRecordFormat.ANDROID
    "rust" -> XmltvRecordFormat.RUST
    "rust-native" -> XmltvRecordFormat.RUST_NATIVE
    "browser" -> XmltvRecordFormat.BROWSER
    "node-streaming" -> XmltvRecordFormat.NODE_STREAMING
    else -> error("Unknown XMLTV record format")
}

@JsExport
class XmltvRecords(format: String, trim: (String) -> String, identity: ((String) -> String)? = null) {
    private val records = play.ott.core.XmltvRecords(recordFormat(format), trim, identity ?: { it })
    fun accept(rows: Array<Array<String>>): Array<Array<String>> {
        for (row in rows) when (row[0]) {
            "start" -> {
                require(row.size >= 2 && row.size % 2 == 0)
                var id: String? = null
                var channel: String? = null
                var start: String? = null
                var stop: String? = null
                var icon: String? = null
                var index = 2
                while (index < row.size) {
                    when (row[index]) {
                        "id" -> id = row[index + 1]
                        "channel" -> channel = row[index + 1]
                        "start" -> start = row[index + 1]
                        "stop" -> stop = row[index + 1]
                        "src" -> icon = row[index + 1]
                    }
                    index += 2
                }
                records.startDecoded(row[1], id, channel, start, stop, icon)
            }
            "text" -> records.text(row[1])
            "end" -> records.end(row[1])
            "text-error" -> records.textError(row[1])
            else -> error("Unknown XMLTV event")
        }
        return records.drain().map { it.toTypedArray() }.toTypedArray()
    }
}

@JsExport
fun nativeXmltvOrder(starts: Array<Double>, format: String): Array<Int> =
    NativeRecordRules.order(starts.toList(), recordFormat(format)).toTypedArray()

private fun xmltvAttribute(attributes: dynamic, name: String): String? =
    if (attributes[name] == null) null else attributes[name].unsafeCast<String>()

private inline fun <T> webXmltvOperation(action: () -> T): T = try { action() } catch (error: XmltvRecordError) {
    val code = error.code
    val mapped: dynamic = js("new Error(code)")
    mapped.code = code
    throw mapped.unsafeCast<Throwable>()
}

/** Typed JS/DOM/SAX boundary; the existing common record interpreter owns field state. */
@JsExport
class WebXmltvRecords(format: String, admission: ((String, Double?, Double?) -> Boolean)? = null, icon: ((String) -> String)? = null) {
    private val streaming = format == "node-streaming"
    private val records = play.ott.core.XmltvRecords(recordFormat(format),
        trim = { value -> value.asDynamic().trim().unsafeCast<String>() },
        admission = admission ?: { _, _, _ -> true }, resolveIcon = icon ?: { it })

    fun start(name: String, attributes: dynamic) = webXmltvOperation {
        records.startDecoded(name, xmltvAttribute(attributes, "id"), xmltvAttribute(attributes, "channel"),
            xmltvAttribute(attributes, "start"), xmltvAttribute(attributes, "stop"), xmltvAttribute(attributes, "src"),
            xmltvAttribute(attributes, "catchup-id"))
    }
    fun wantsText(): Boolean = records.wantsText()
    fun text(value: String) = webXmltvOperation { records.text(value) }
    fun end(name: String): dynamic = webXmltvOperation {
        records.end(name)
        val row = records.takeWebRecord() ?: return@webXmltvOperation null
        val result: dynamic = js("({})")
        result.kind = row.kind
        val value: dynamic = js("({})")
        if (row.kind == "channel") {
            value.id = row.id; value.names = row.names.toTypedArray()
            if (streaming) value.icon = row.icon else value.icons = row.icons.toTypedArray()
        } else if (streaming) {
            value.kind = row.kind; value.id = row.id; value.start = row.start; value.stop = row.stop
            value.begin = row.begin; value.end = row.end; value.title = row.title; value.desc = row.description
            value.catchupId = row.catchupAttribute?.takeIf { it.isNotEmpty() } ?: row.catchupElement
        } else {
            value.channel = row.id; value.start = row.start; value.stop = row.stop
            value.title = row.title; value.description = row.description
            value.catchupAttribute = row.catchupAttribute; value.catchupElement = row.catchupElement
        }
        result.value = value
        result
    }
}
