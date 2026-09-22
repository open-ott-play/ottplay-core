@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

/** JSON and public model ABI conversion only; all provider decisions live in commonMain. */
internal fun wire(value: dynamic): ProviderValue = when {
    jsTypeOf(value) == "undefined" -> ProviderValue.missing
    value == null -> ProviderValue.nil
    jsTypeOf(value) == "string" -> ProviderValue.text(value.unsafeCast<String>())
    jsTypeOf(value) == "number" -> ProviderValue(ProviderValueKind.NUMBER, js("String(value)").unsafeCast<String>())
    jsTypeOf(value) == "boolean" -> ProviderValue(ProviderValueKind.BOOLEAN, js("String(value)").unsafeCast<String>())
    js("Array.isArray(value)").unsafeCast<Boolean>() -> ProviderValue.array((0 until value.length.unsafeCast<Int>()).map { wire(value[it]) })
    else -> ProviderValue.obj(js("Object.keys(value)").unsafeCast<Array<String>>().associateWith { wire(value[it]) })
}
internal fun unwire(value: ProviderValue): dynamic = when (value.kind) {
    ProviderValueKind.MISSING -> js("undefined")
    ProviderValueKind.NULL -> null
    ProviderValueKind.TEXT -> value.scalar
    ProviderValueKind.NUMBER -> value.scalar.toDouble()
    ProviderValueKind.BOOLEAN -> value.scalar == "true"
    ProviderValueKind.ARRAY -> value.elements.map(::unwire).toTypedArray()
    ProviderValueKind.OBJECT -> {
        // Retain JSON object coercion for host Date/hash primitives. Defining own
        // properties also preserves a literal __proto__ without invoking its setter.
        val result: dynamic = js("({})")
        value.properties.forEach { (key, entry) ->
            val property: dynamic = js("({writable: true, enumerable: true, configurable: true})")
            property.value = unwire(entry)
            js("Object.defineProperty")(result, key, property)
        }
        result
    }
}
internal fun failure(code: String): dynamic { val result: dynamic = js("({})"); result.failure = code; return result }

internal fun legacyChannel(name: ProviderValue, epg: String, category: Int, group: String, logo: ProviderValue,
    url: dynamic, mode: String = "", hours: Double = 0.0): dynamic {
    val row: dynamic=js("({})");row.ca=mode;row.caso="";row.category=js("({})");row.category.`class`=category;row.category.name=group
    row.channel_name=unwire(name);row.epg=epg;row.logo=unwire(logo);row.rec=hours;row.time=0;row.time_to=0;row.tn=unwire(name);row.url=url
    return row
}
internal fun legacyGuide(rows: List<LegacyXtreamProgramme>?): dynamic=rows?.map { value->
    val row: dynamic=js("({})");row.name=unwire(value.name);row.descr=unwire(value.description);row.time=value.start;row.time_to=value.end;row.icon="";row
}?.toTypedArray()
