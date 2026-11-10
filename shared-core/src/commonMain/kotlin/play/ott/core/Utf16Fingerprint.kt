package play.ott.core

/**
 * Existing dual-32 namespace fingerprint over UTF-16 code units, including lone surrogates.
 * This is not a cryptographic hash, authentication mechanism or credential protection.
 * Hosts keep input framing, identity prefixes and the explicit output separator.
 */
object Utf16Fingerprint {
    fun dual32(value: String, separator: String): String {
        var first = 0x811c9dc5.toInt()
        var second = 5381
        for (unit in value) {
            first = (first xor unit.code) * 16777619
            second = ((second shl 5) + second) xor unit.code
        }
        return first.toUInt().toString(16) + separator + second.toUInt().toString(16)
    }
}
