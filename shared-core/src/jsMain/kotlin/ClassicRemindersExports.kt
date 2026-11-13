@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.ClassicReminders

// Snapshot only contract fields: presentation/legacy extensions remain opaque to the kernel.
private fun classicReminderRecord(value: dynamic, source: String): dynamic {
    if (!value) return null
    val record: dynamic = js("({})")
    // Never recursively wire malformed object-valued fields; validation used to reject them by type.
    arrayOf("sourceId", "id", "channelId", "programmeId", "title").forEach {
        val field = value[it]
        if (jsTypeOf(field) != "string") return null
        if (it == "sourceId" && field != source) return null
        record[it] = field
    }
    arrayOf("start", "end").forEach {
        val field = value[it]
        if (jsTypeOf(field) != "number") return null
        record[it] = field
    }
    return record
}

@JsExport fun classicReminderValid(record: dynamic, source: String): Boolean =
    ClassicReminders.valid(wire(classicReminderRecord(record, source)), source)

@JsExport fun classicReminderNormalize(records: dynamic, source: String): dynamic {
    val values = (0 until (records.length as Int)).map { wire(classicReminderRecord(records[it], source)) }
    return ClassicReminders.normalizedIndices(values, source).map { index ->
        val record = records[index]
        js("JSON.parse(JSON.stringify(record))")
    }.toTypedArray()
}

@JsExport fun classicReminderNext(start: Double, end: Double, now: Double, lead: Double, prompted: Boolean, notified: Boolean): Double =
    ClassicReminders.next(start, end, now, lead, prompted, notified)

@JsExport fun classicReminderAction(start: Double, end: Double, now: Double, lead: Double, prompted: Boolean, notified: Boolean): String =
    ClassicReminders.action(start, end, now, lead, prompted, notified)

@JsExport fun classicReminderMinutes(start: Double, now: Double): Double = ClassicReminders.minutes(start, now)
