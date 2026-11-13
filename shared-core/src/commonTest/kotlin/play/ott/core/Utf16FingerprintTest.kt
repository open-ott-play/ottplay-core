package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals

class Utf16FingerprintTest {
    @Test fun frozenThreeHostLoopVectorsKeepUnsignedHexAndUtf16Units() {
        // Values captured from all three pre-extraction loops; no code-point normalization.
        // Build isolated UTF-16 units at runtime; JS test literal emission can replace them.
        val high = charArrayOf(0xd800.toChar()).concatToString()
        val low = charArrayOf(0xdc00.toChar()).concatToString()
        val split = charArrayOf(0xd800.toChar(), 0x0041.toChar(), 0xdc00.toChar()).concatToString()
        assertEquals(1, high.length)
        assertEquals(0xd800, high[0].code)
        assertEquals(1, low.length)
        assertEquals(0xdc00, low[0].code)
        assertEquals(listOf(0xd800, 0x0041, 0xdc00), split.map { it.code })
        val vectors = listOf(
            "" to "811c9dc5-1505",
            "\u0061" to "e40c292c-2b5c4",
            "\u0068\u0065\u006c\u006c\u006f" to "4f9f2cab-a9cede7",
            "\u0068\u0074\u0074\u0070\u0073\u003a\u002f\u002f\u0065\u0078\u0061\u006d\u0070\u006c\u0065\u002e\u0074\u0065\u0073\u0074\u002f\u006c\u0069\u0076\u0065\u003f\u0069\u0064\u003d\u0031\u0026\u0074\u006f\u006b\u0065\u006e\u003d\u0073\u0079\u006e\u0074\u0068\u0065\u0074\u0069\u0063" to "f6bfb720-f28a1f20",
            "\u0061\u007c\u0062\u0000\u0063\u000a" to "16b9275b-4f686ad3",
            "\u0420\u043e\u0441\u0441\u0438\u044f\u0020\u002b\u0032" to "e1e1df21-6de67c15",
            "\ud83d\ude03" to "ce31c971-50fe9b",
            high to "481d51f-26da5",
            low to "47b891f-269a5",
            split to "56a9238e-a54be84",
            "\uffff\u0000\ufeff" to "61c33c6f-9beb625",
            "\u0061".repeat(4096) to "d400edc5-f891505",
            "\uffff".repeat(512) to "a5be3c5-c7357505",
            "\u0000".repeat(1024) to "1f116dc5-605a9505",
        )
        for ((value, expected) in vectors) {
            assertEquals(expected, Utf16Fingerprint.dual32(value, "-"))
            assertEquals(expected.replace('-', '.'), Utf16Fingerprint.dual32(value, "."))
        }
    }

    @Test fun callerOwnsTheSeparatorAndInputFraming() {
        assertEquals("4f9f2cab::a9cede7", Utf16Fingerprint.dual32("hello", "::"))
        assertEquals("4f9f2caba9cede7", Utf16Fingerprint.dual32("hello", ""))
        assertEquals("811c9dc5-1505", Utf16Fingerprint.dual32("", "-"))
    }
}
