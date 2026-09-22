@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.XmltvRecordFormat
import play.ott.core.NativeRecordRules

private fun recordFormat(value: String): XmltvRecordFormat = when (value) {
    "swift" -> XmltvRecordFormat.SWIFT
    "android" -> XmltvRecordFormat.ARCHIVED_ANDROID
    "active-android" -> XmltvRecordFormat.ANDROID
    "rust" -> XmltvRecordFormat.RUST
    "rust-native" -> XmltvRecordFormat.RUST_NATIVE
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
