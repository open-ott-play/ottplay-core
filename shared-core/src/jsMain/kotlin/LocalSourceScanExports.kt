@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.LocalSourceScans
import play.ott.core.LocalSourceScanStatus

/** Scalar bridge: no catalogue, item payload or opaque host object is converted. */
@JsExport fun localSourceScanStatus(advertised: dynamic, array: dynamic, matches: dynamic,
                                   generation: dynamic, state: dynamic): String {
    if (jsTypeOf(advertised) != "boolean" || jsTypeOf(array) != "boolean")
        return LocalSourceScanStatus.INVALID.wire
    // Keep JS wire types strict; Number("1") and Number(null) cannot authorize a record.
    val count = if (jsTypeOf(matches) == "number" && (matches == 0 || matches == 1))
        matches.unsafeCast<Int>() else -1
    val number = if (jsTypeOf(generation) == "number") generation.unsafeCast<Double>() else null
    val label = if (jsTypeOf(state) == "string") state.unsafeCast<String>() else null
    return LocalSourceScans.classify(advertised.unsafeCast<Boolean>(), array.unsafeCast<Boolean>(), count, number, label).wire
}
