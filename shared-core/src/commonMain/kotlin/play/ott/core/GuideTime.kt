package play.ott.core

/** Input contracts retained during migration; arithmetic has one implementation. */
enum class GuideTimeFormat { XMLTV, BROWSER, ANDROID }

/** XMLTV repeats the same clock fields across channels. Cache only short inputs,
 * with a fixed bound; a large or malicious feed cannot retain arbitrary text.
 * One decoder belongs to one parser/VM, never shared across host threads.
 */
class NativeGuideClock(private val format: NativeGuideFormat, private val capacity: Int = 4096) {
    private val times = mutableMapOf<String, Double>()
    private val keys = arrayOfNulls<String>(maxOf(0, capacity))
    private var cursor = 0
    internal val cachedEntries: Int get() = times.size
    fun seconds(value: String): Double {
        times[value]?.let { return it }
        val result = GuideTime.nativeSeconds(value, format)
        if (capacity > 0 && value.length <= 64) {
            // Do not iterate a JS hash map to evict: deleted slots make repeated
            // first-key scans quadratic on feeds containing only unique dates.
            keys[cursor]?.let { times.remove(it) }
            keys[cursor] = value
            cursor = (cursor + 1) % capacity
            times[value] = result
        }
        return result
    }
}

/** Platform-independent XMLTV time conversion. No clocks, time zones or I/O are implicit. */
object GuideTime {
    private val monthDays = intArrayOf(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

    /** Native hosts historically read exactly fourteen date digits and a five-byte zone.
     * Keep their suffix policy while using the same validated calendar arithmetic.
     * Invalid dates return the native API's sentinel, zero seconds.
     */
    fun parseNative(value: String, format: NativeGuideFormat): Long = nativeSeconds(value, format).toLong()

    fun nativeSeconds(value: String, format: NativeGuideFormat): Double {
        val input = CoreText.trim(value, CoreText::unicodeSpace)
        if (input.length < 14) return 0.0
        var dateEnd = 14
        var date = input.substring(0, 14)
        if (format == NativeGuideFormat.SWIFT) {
            val digits = StringBuilder()
            var index = 0
            repeat(14) {
                if (index >= input.length) return 0.0
                val digit = CoreText.digitAt(input, index) ?: return 0.0
                digits.append('0' + digit.first)
                index += digit.second
            }
            // Full-width/Arabic decimal digits are accepted by the native date input.
            // Supplementary dates have a different suffix boundary and are handled below.
            date = digits.toString()
            dateEnd = index
        }
        if (date.any { it !in '0'..'9' }) return 0.0
        if (format == NativeGuideFormat.RUST && date.endsWith("60")) date = date.dropLast(2) + "59"
        val millis = milliseconds(date) ?: return 0.0
        val zone = CoreText.trim(input.substring(dateEnd), CoreText::unicodeSpace)
        var offset = 0
        if (zone.isNotEmpty() && (zone[0] == '+' || zone[0] == '-') &&
            (if (format == NativeGuideFormat.RUST) zone.encodeToByteArray().size else zone.length) >= 5) {
            if (zone.length < 5) return 0.0
            if (format == NativeGuideFormat.RUST && zone.substring(1, 5).any { it !in '0'..'9' }) return 0.0
            val hours = zone.substring(1, 3).toIntOrNull() ?: 0
            val minutes = zone.substring(3, 5).toIntOrNull() ?: 0
            offset = (hours * 3600 + minutes * 60) * if (zone[0] == '-') -1 else 1
        }
        return millis / 1000 - offset
    }

    /** UTC milliseconds, or null for malformed dates. Missing clock fields mean zero. */
    fun parse(value: String, format: GuideTimeFormat = GuideTimeFormat.XMLTV): Long? = milliseconds(value, format)?.toLong()

    /** Integer arithmetic stays exact below 2^53 for the four-digit XMLTV year range.
     * Doubles avoid boxed 64-bit arithmetic on ES5 interpreters. */
    fun milliseconds(value: String, format: GuideTimeFormat = GuideTimeFormat.XMLTV): Double? {
        val input = CoreText.trim(value, if (format == GuideTimeFormat.ANDROID) CoreText::androidSpace else CoreText::space)
        var length = 0
        while (length < input.length && input[length] in '0'..'9') length++
        if (length != 8 && length != 10 && length != 12 && length != 14) return null
        if (format == GuideTimeFormat.BROWSER && length < 12) return null
        val digits = input.substring(0, length)
        fun field(from: Int, fallback: Int = 0): Int =
            if (digits.length >= from + 2) digits.substring(from, from + 2).toInt() else fallback
        val year = digits.substring(0, 4).toInt()
        val month = field(4)
        val day = field(6)
        val hour = field(8)
        val minute = field(10)
        val second = field(12)
        if (month !in 1..12 || hour > 23 || minute > 59 || second > 59) return null
        val leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        if (day !in 1..(monthDays[month - 1] + if (month == 2 && leap) 1 else 0)) return null

        var zoneStart = length
        while (zoneStart < input.length && if (format == GuideTimeFormat.ANDROID)
            input[zoneStart] == ' ' || input[zoneStart] in '\u0009'..'\u000d'
            else CoreText.space(input[zoneStart])) zoneStart++
        val zone = input.substring(zoneStart)
        if (format == GuideTimeFormat.ANDROID && (zone == "UTC" || zone == "GMT")) return null
        var offset = 0
        if (zone.isNotEmpty() && zone != "Z" && zone != "UTC" && zone != "GMT") {
            if ((zone.length != 5 && zone.length != 6) || (zone[0] != '+' && zone[0] != '-')) return null
            if (format == GuideTimeFormat.BROWSER && zone.length != 5) return null
            val minuteStart = if (zone.length == 6) 4 else 3
            if (zone.length == 6 && zone[3] != ':') return null
            for (index in 1 until zone.length) {
                if (zone.length == 6 && index == 3) continue
                if (zone[index] !in '0'..'9') return null
            }
            val hours = zone.substring(1, 3).toInt()
            val minutes = zone.substring(minuteStart).toInt()
            if (hours > 23 || minutes > 59) return null
            if (format == GuideTimeFormat.ANDROID && (hours > 18 || hours == 18 && minutes != 0)) return null
            offset = (hours * 60 + minutes) * if (zone[0] == '+') 1 else -1
        }
        val previous = (year - 1).toDouble()
        // Floor division also covers the leap year 0000 supported by both clients.
        fun floorDiv(divisor: Int): Double = kotlin.math.floor(previous / divisor)
        var days = previous * 365 + floorDiv(4) - floorDiv(100) + floorDiv(400)
        for (index in 0 until month - 1) days += monthDays[index]
        if (month > 2 && leap) days++
        // Gregorian days before 1970-01-01: 1969*365 + 492 - 19 + 4.
        days += day - 1 - 719162
        return ((days * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1_000
    }
}
