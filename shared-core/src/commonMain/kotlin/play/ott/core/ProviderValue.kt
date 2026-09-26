package play.ott.core

/** Decoded wire data, supplied by the host JSON parser. Missing is distinct from JSON null. */
enum class ProviderValueKind { MISSING, NULL, TEXT, NUMBER, BOOLEAN, ARRAY, OBJECT }
class ProviderValue(
    val kind: ProviderValueKind, val scalar: String = "",
    val elements: List<ProviderValue> = emptyList(), val properties: Map<String, ProviderValue> = emptyMap(),
) {
    operator fun get(key: String): ProviderValue = properties[key] ?: missing
    val isArray get() = kind == ProviderValueKind.ARRAY
    val isObject get() = kind == ProviderValueKind.OBJECT
    val present get() = kind != ProviderValueKind.MISSING && kind != ProviderValueKind.NULL
    fun primitive(): String = when (kind) {
        ProviderValueKind.TEXT, ProviderValueKind.NUMBER, ProviderValueKind.BOOLEAN -> scalar
        else -> ""
    }
    fun string(): String = when (kind) {
        ProviderValueKind.MISSING -> "undefined"
        ProviderValueKind.NULL -> "null"
        ProviderValueKind.ARRAY -> elements.joinToString(",") { if (it.present) it.string() else "" }
        ProviderValueKind.OBJECT -> "[object Object]"
        else -> scalar
    }
    fun trimmed(): String = if (present) CoreText.trim(string()) else ""
    fun truthy(): Boolean = when (kind) {
        ProviderValueKind.MISSING, ProviderValueKind.NULL -> false
        ProviderValueKind.TEXT -> scalar.isNotEmpty()
        ProviderValueKind.NUMBER -> scalar.toDoubleOrNull()?.let { it != 0.0 && !it.isNaN() } ?: false
        ProviderValueKind.BOOLEAN -> scalar == "true"
        else -> true
    }
    fun number(): Double = when (kind) {
        ProviderValueKind.MISSING -> Double.NaN
        ProviderValueKind.NULL -> 0.0
        ProviderValueKind.BOOLEAN -> if (scalar == "true") 1.0 else 0.0
        else -> CoreNumber.javascript(string())
    }
    fun positive(): Double = number().takeIf { it.isFinite() && it > 0 } ?: 0.0
    fun numericId(): Boolean = present && string().isNotEmpty() && string().all { it in '0'..'9' }
    fun flag(): Boolean = kind == ProviderValueKind.BOOLEAN && scalar == "true" || string() == "1"
    companion object {
        val missing = ProviderValue(ProviderValueKind.MISSING)
        val nil = ProviderValue(ProviderValueKind.NULL)
        fun text(value: String) = ProviderValue(ProviderValueKind.TEXT, value)
        fun array(values: List<ProviderValue> = emptyList()) = ProviderValue(ProviderValueKind.ARRAY, elements = values)
        fun obj(values: Map<String, ProviderValue> = emptyMap()) = ProviderValue(ProviderValueKind.OBJECT, properties = values)
    }
}

/** ECMAScript numeric conversion, without platform-specific floating point suffixes. */
internal object CoreNumber {
    fun javascript(value: String): Double {
        val input = CoreText.trim(value)
        if (input.isEmpty()) return 0.0
        val radix = when (input.take(2).lowercase()) { "0x" -> 16; "0b" -> 2; "0o" -> 8; else -> 0 }
        if (radix != 0) {
            if (input.length == 2) return Double.NaN
            var number = 0.0
            for (character in input.drop(2)) {
                val digit = when (character) {
                    in '0'..'9' -> character.code - '0'.code
                    in 'a'..'f' -> character.code - 'a'.code + 10
                    in 'A'..'F' -> character.code - 'A'.code + 10
                    else -> return Double.NaN
                }
                if (digit >= radix) return Double.NaN
                number = number * radix + digit
            }
            return number
        }
        if (input == "Infinity" || input == "+Infinity") return Double.POSITIVE_INFINITY
        if (input == "-Infinity") return Double.NEGATIVE_INFINITY
        return decimal(input, prefix = false)
    }

    /** Decimal grammar shared by strict Number coercion and parseFloat prefixes. */
    fun decimal(input: String, prefix: Boolean): Double {
        var at = if (input.isNotEmpty() && (input[0] == '+' || input[0] == '-')) 1 else 0
        var digits = 0
        while (at < input.length && input[at] in '0'..'9') { at++; digits++ }
        if (at < input.length && input[at] == '.') {
            at++
            while (at < input.length && input[at] in '0'..'9') { at++; digits++ }
        }
        if (digits == 0) return Double.NaN
        if (at < input.length && (input[at] == 'e' || input[at] == 'E')) {
            val exponent = at
            at++
            if (at < input.length && (input[at] == '+' || input[at] == '-')) at++
            val start = at
            while (at < input.length && input[at] in '0'..'9') at++
            if (start == at) at = exponent
        }
        if (at == input.length) return input.toDoubleOrNull() ?: Double.NaN
        return if (prefix) input.substring(0, at).toDoubleOrNull() ?: Double.NaN else Double.NaN
    }
}
