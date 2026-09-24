@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.MediaCollection
import play.ott.core.MediaMutation
import play.ott.core.MediaRecord
import play.ott.core.MediaRef
import play.ott.core.MediaState

private fun mediaRecord(value: dynamic): MediaRecord<Any?> {
    require(value != null && jsTypeOf(value.sourceId) == "string" && jsTypeOf(value.itemId) == "string") { "Media identity is required" }
    val position = if (jsTypeOf(value.position) == "number") value.position.unsafeCast<Double>() else 0.0
    return MediaRecord(MediaRef(value.sourceId.unsafeCast<String>(), value.itemId.unsafeCast<String>()), value.payload.unsafeCast<Any?>(), position)
}
private fun mediaRecords(value: dynamic): List<MediaRecord<Any?>> {
    require(js("Array.isArray(value)").unsafeCast<Boolean>()) { "Media collection must be an array" }
    return value.unsafeCast<Array<dynamic>>().map(::mediaRecord)
}
private fun mediaRecordValue(value: MediaRecord<Any?>): dynamic {
    val result: dynamic = js("({})")
    result.sourceId = value.ref.sourceId; result.itemId = value.ref.itemId
    result.position = value.position; result.payload = value.payload
    return result
}

@JsExport fun mediaResumePosition(position: Double, quantum: Double = 1.0): Double = MediaState.resume(position, quantum)

/** No URLs, sentinel modes, menu indices, clocks or persistence effects enter this reducer. */
@JsExport fun mediaCollectionChange(history: dynamic, favorites: dynamic, operation: String, entry: dynamic, limit: Int): dynamic {
    val action = when (operation) {
        "visit" -> MediaMutation.VISIT
        "position" -> MediaMutation.POSITION
        "favorite" -> MediaMutation.FAVORITE
        "unfavorite" -> MediaMutation.UNFAVORITE
        "remove-history" -> MediaMutation.REMOVE_HISTORY
        else -> error("Unknown media mutation")
    }
    val changed = MediaState.change(MediaCollection(mediaRecords(history), mediaRecords(favorites)), action, mediaRecord(entry), limit)
    val result: dynamic = js("({})")
    result.history = changed.history.map(::mediaRecordValue).toTypedArray()
    result.favorites = changed.favorites.map(::mediaRecordValue).toTypedArray()
    return result
}
