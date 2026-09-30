package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals

class CoreTextTest {
    @Test fun whitespacePredicatesKeepTheExactUtf16Membership() {
        val spaces = setOf(0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
            0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
            0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff)
        for (unit in 0..0xffff) {
            val character = unit.toChar()
            val expected = unit in spaces
            assertEquals(expected, CoreText.space(character), "space/$unit")
            assertEquals((expected && unit != 0xfeff) || unit == 0x0085,
                CoreText.unicodeSpace(character), "unicode/$unit")
            assertEquals((expected && unit != 0xfeff) || unit in 0x001c..0x001f,
                CoreText.androidSpace(character), "android/$unit")
            assertEquals(unit == 0x0020 || unit in 0x0009..0x000d,
                CoreText.asciiSpace(character), "ascii/$unit")
        }
    }
}
