@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.*
@JsExport fun libraryEdit(id: dynamic, values: dynamic): dynamic = try { unwire(LibraryState.edit(wire(id), wire(values)) { value -> val raw = unwire(value); js("String(raw)").unsafeCast<String>() }) }
catch (failure: DurableStateFailure) { val message = failure.message; throw js("new Error(message)") }
@JsExport fun libraryDecorate(items: dynamic, overrides: dynamic, includeHidden: Boolean): dynamic =
    LibraryState.decorated(wire(items).elements, wire(overrides), includeHidden).map { value ->
        val index = value["originalIndex"].number().toInt(); val item = items[index]; val result: dynamic = js("({})")
        js("Object.keys(item)").unsafeCast<Array<String>>().forEach { key -> result[key] = item[key] }
        listOf("name", "group", "hidden", "order", "originalIndex").forEach { key -> result[key] = unwire(value[key]) }
        result
    }.toTypedArray()
@JsExport fun libraryReminderId(channel: dynamic, start: dynamic): String = LibraryState.reminderId(js("String(channel)").unsafeCast<String>(), js("String(start)").unsafeCast<String>())
@JsExport fun libraryToggleReminder(reminders: dynamic, channel: dynamic, programme: dynamic): dynamic = unwire(LibraryState.toggleReminder(wire(reminders), wire(channel), wire(programme)))
@JsExport fun libraryPreferenceIndex(entries: dynamic, channel: dynamic, active: dynamic, items: dynamic): Int = LibraryState.preferenceIndex(wire(entries).elements, wire(channel), wire(active), wire(items).elements, restoration())
@JsExport fun libraryPreferenceEntry(active: dynamic, preferred: dynamic, field: String, value: dynamic): dynamic = unwire(LibraryState.preferenceEntry(wire(active), wire(preferred), field, wire(value)))
@JsExport fun librarySavePreference(entries: dynamic, entry: dynamic, previous: dynamic): dynamic = unwire(LibraryState.savePreference(wire(entries), wire(entry), wire(previous)))
