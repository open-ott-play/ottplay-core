package play.ott.core

/** Explicit character set; no runtime-specific regex or Unicode flag dependency. */
internal object CoreText {
    // Kotlin/JS's string replaceFirst constructs a RegExp with the ES2015 u flag.
    fun replaceLiteralFirst(value: String, search: String, replacement: String): String {
        val index = value.indexOf(search)
        return if (index < 0) value else value.substring(0, index) + replacement + value.substring(index + search.length)
    }
    // Unicode 16.0.0 Nd zero scalars, generated from Python unicodedata.
    // Scalar scanning also handles supplementary digits, unlike Char.isDigit().
    private val decimalZeros = intArrayOf(0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x10d40, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650, 0x116c0, 0x116d0, 0x116da, 0x11730, 0x118e0, 0x11950, 0x11bf0, 0x11c50, 0x11d50, 0x11da0, 0x11f50, 0x16130, 0x16a60, 0x16ac0, 0x16b50, 0x16d70, 0x1ccf0, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140, 0x1e2f0, 0x1e4f0, 0x1e5f1, 0x1e950, 0x1fbf0)
    fun digitAt(value: String, index: Int): Pair<Int, Int>? {
        val first = value[index].code
        val width = if (first in 0xd800..0xdbff && index + 1 < value.length && value[index + 1].code in 0xdc00..0xdfff) 2 else 1
        val scalar = if (width == 2) 0x10000 + (first - 0xd800) * 1024 + value[index + 1].code - 0xdc00 else first
        for (zero in decimalZeros) {
            if (scalar < zero) return null
            if (scalar < zero + 10) return Pair(scalar - zero, width)
        }
        return null
    }

    fun space(value: Char): Boolean = value in '\u0009'..'\u000d' || value in '\u2000'..'\u200a' ||
        value == ' ' || value == '\u00a0' || value == '\u1680' ||
        value == '\u2028' || value == '\u2029' || value == '\u202f' || value == '\u205f' ||
        value == '\u3000' || value == '\ufeff'

    fun androidSpace(value: Char): Boolean = (space(value) && value != '\ufeff') || value in '\u001c'..'\u001f'

    fun unicodeSpace(value: Char): Boolean = (space(value) && value != '\ufeff') || value == '\u0085'
    fun asciiSpace(value: Char): Boolean = value == ' ' || value in '\u0009'..'\u000d'

    fun trim(value: String, whitespace: (Char) -> Boolean = ::space): String {
        var start = 0
        var end = value.length
        while (start < end && whitespace(value[start])) start++
        while (end > start && whitespace(value[end - 1])) end--
        return value.substring(start, end)
    }

    fun normalizedSpaces(value: String, whitespace: (Char) -> Boolean = ::space): String {
        val result = StringBuilder()
        var pendingSpace = false
        for (character in value) {
            if (whitespace(character)) pendingSpace = result.isNotEmpty()
            else {
                if (pendingSpace) result.append(' ')
                result.append(character)
                pendingSpace = false
            }
        }
        return result.toString()
    }
}
