@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.Utf16Fingerprint

/** A string-only ABI: no generic object-tree conversion on playlist/identity hot paths. */
@JsExport fun utf16Dual32Fingerprint(value: String, separator: String): String =
    Utf16Fingerprint.dual32(value, separator)
