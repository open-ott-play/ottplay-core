@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

@JsExport
fun browserStateDefaults(security: dynamic): dynamic = unwire(BrowserDurableState.defaults(wire(security)))

@JsExport
fun browserStateFonts(): Array<String> = BrowserDurableState.fonts.toTypedArray()

@JsExport
fun validateBrowserState(value: dynamic, securityDefault: () -> dynamic, securityValidate: (dynamic) -> dynamic): dynamic = try {
    unwire(BrowserDurableState.validate(wire(value), { wire(securityDefault()) }, { wire(securityValidate(unwire(it))) },
        { value -> try { js("decodeURIComponent(value)").unsafeCast<String>() } catch (_: Throwable) { value } },
        { value -> val raw = unwire(value); js("String(raw)").unsafeCast<String>() }))
} catch (failure: DurableStateFailure) {
    val message = failure.message
    throw js("new Error(message)")
}


@JsExport
fun pruneBrowserSources(previous: dynamic, next: dynamic): dynamic =
    unwire(BrowserDurableState.removeSources(wire(previous), wire(next)) { value -> js("encodeURIComponent(value)").unsafeCast<String>() })

@JsExport
fun exportBrowserState(value: dynamic, includeCredentials: Boolean): dynamic = unwire(BrowserDurableState.export(wire(value), includeCredentials))

@JsExport
fun recordBrowserHistory(history: dynamic, id: String, name: dynamic, time: Double): dynamic =
    unwire(BrowserDurableState.recordHistory(wire(history), id, wire(name), time))

@JsExport
fun removeBrowserHistory(history: dynamic, id: String): dynamic = unwire(BrowserDurableState.removeHistory(wire(history), id))
