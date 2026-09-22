package play.ott.core

import java.time.LocalDate
import java.time.ZoneOffset
import java.time.LocalDateTime
import kotlin.test.Test
import kotlin.test.assertEquals

class CalendarOracleTest {
    @Test fun matchesTheJdkCalendarAcrossFourCenturies() {
        var date = LocalDate.of(1800, 1, 1)
        val end = LocalDate.of(2200, 1, 1)
        while (date < end) {
            val input = date.toString().replace("-", "") + "123456 +0530"
            assertEquals(date.atTime(12, 34, 56).toInstant(ZoneOffset.ofHoursMinutes(5, 30)).toEpochMilli(),
                GuideTime.parse(input), input)
            date = date.plusDays(7)
        }
    }

    @Test fun androidFormatAgreesWithPreviousJdkContract() {
        val expression = Regex("^(\\d{8}(?:\\d{2}){0,3})(?:\\s*(Z|[+-]\\d{2}:?\\d{2}))?$")
        fun oracle(value: String): Long? {
            val match = expression.matchEntire(value.trim()) ?: return null
            val date = match.groupValues[1]
            return try {
                LocalDateTime.of(date.take(4).toInt(), date.substring(4, 6).toInt(), date.substring(6, 8).toInt(),
                    date.drop(8).take(2).ifBlank { "0" }.toInt(), date.drop(10).take(2).ifBlank { "0" }.toInt(),
                    date.drop(12).take(2).ifBlank { "0" }.toInt())
                    .toInstant(ZoneOffset.of(match.groupValues[2].ifBlank { "Z" })).toEpochMilli()
            } catch (_: Exception) { null }
        }
        val dates = listOf("00000229010203", "00010101000000", "19000229000000", "20000229000000", "19700101053000", "20260101240000", "99991231235959")
        val zones = listOf("", "Z", " +0530", " -03:30", " +1800", " +1801", " +2359", " UTC", "\u00a0Z", "\tZ", "\u0085Z")
        for (date in dates) for (length in listOf(8, 10, 12, 14)) for (zone in zones) {
            val input = date.take(length) + zone
            assertEquals(oracle(input), GuideTime.parse(input, GuideTimeFormat.ANDROID), input)
        }
        for (character in Char.MIN_VALUE..Char.MAX_VALUE) {
            val input = "$character" + "19700101" + character
            assertEquals(oracle(input), GuideTime.parse(input, GuideTimeFormat.ANDROID), "Whitespace U+${character.code.toString(16)}")
        }
    }
}
