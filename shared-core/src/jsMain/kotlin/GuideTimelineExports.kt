@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.GuideTimeline
import play.ott.core.ProgrammeId

@JsExport
fun guideProgrammeId(sourceId: String, channelId: String, providerId: dynamic, start: Double): String {
    val id = when (jsTypeOf(providerId)) {
        "string" -> providerId.unsafeCast<String>()
        "number" -> providerId.unsafeCast<Double>().takeIf { it.isFinite() }?.let { js("String(providerId)").unsafeCast<String>() }
        else -> null
    }
    return ProgrammeId.of(sourceId, channelId, id, start).key()
}

/** Only numeric epoch seconds enter scheduling. Selected payload references are preserved. */
@JsExport
fun guideScheduleSelection(rows: dynamic, now: Double, nextCount: Double): dynamic {
    require(js("Array.isArray(rows)").unsafeCast<Boolean>()) { "Guide rows must be an array" }
    val values = rows.unsafeCast<Array<dynamic>>()
    fun field(index: Int, name: String): Double {
        val row = values[index]
        val value = if (row == null) null else row[name]
        return if (jsTypeOf(value) == "number") value.unsafeCast<Double>() else Double.NaN
    }
    val selection = GuideTimeline.select(values.size, { field(it, "start") }, { field(it, "end") }, now, nextCount)
    val result: dynamic = js("({})")
    result.current = if (selection.current < 0) null else values[selection.current]
    result.following = selection.following.map { values[it] }.toTypedArray()
    result.retryAt = selection.retryAt
    return result
}
