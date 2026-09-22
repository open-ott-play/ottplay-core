@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.*
@JsExport fun previewLegacySettings(incoming: dynamic, xml: Boolean, defaults: () -> dynamic, validate: (dynamic) -> dynamic, parse: (String) -> dynamic, http: (dynamic) -> dynamic): dynamic = try {
    unwire(LegacySettingsImport.browser(wire(incoming), xml, { wire(defaults()) }, { wire(validate(unwire(it))) }, { wire(parse(it)) }, { value -> val url = http(unwire(value)); if (jsTypeOf(url) == "string") url.unsafeCast<String>() else "" }))
} catch (failure: DurableStateFailure) { val message = failure.message; throw js("new Error(message)") }
