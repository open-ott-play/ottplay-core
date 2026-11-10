package play.ott.core

import kotlin.test.*

class CloudStorageFramingTest {
    private fun document(vararg rows: Pair<String, String>) = CloudStorageFraming.header + "\n" + rows.joinToString("\n") { CloudStorageFraming.entry(it.first, it.second) } + "\n</properties>"
    private fun raw(value: String, key: String = "&quot;key&quot;") = CloudStorageFraming.header + "\n<entry key=\"$key\">$value</entry>\n</properties>"
    private fun invalid(value: String) { assertFailsWith<CloudStorageFailure> { CloudStorageFraming.read(value) } }

    @Test fun versionedFramingMatchesClassicWriterBytes() {
        assertEquals("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE properties SYSTEM \"http://java.sun.com/dtd/properties.dtd\">\n<!--ottplay-storage-v2-->\n<properties>\n<comment>OTT-Play Preferences</comment>", CloudStorageFraming.header)
        assertEquals("<entry key=\"&quot;k&amp;&lt;&gt;&apos;\\&quot;&quot;\">&quot;v\\n\\t\\\\&quot;</entry>", CloudStorageFraming.entry("k&<>'\"", "v\n\t\\"))
        assertEquals(listOf("one" to "1", "" to ""), CloudStorageFraming.read(document("one" to "1", "" to "")))
        assertEquals(listOf("one" to "1"), CloudStorageFraming.read("\ufeff \n" + document("one" to "1") + "\r\n", true))
    }

    @Test fun allUtf16UnitsRoundtripIncludingCompressedRawStorage() {
        val units = CharArray(65536) { it.toChar() }.concatToString()
        val key = charArrayOf(0xd800.toChar(), 0xffff.toChar()).concatToString()
        val value = "\u0001LZ\u0001" + units
        assertEquals(listOf(key to value), CloudStorageFraming.read(document(key to value), true))
        assertTrue(CloudStorageFraming.quoted(key).contains("\\ud800\\uffff"))
    }

    @Test fun legacyProfileKeepsEntitiesAndMarkupLiteral() {
        val value = "&amp; &lt; &#0; &unknown; <b>hello</b> \" >"
        val xml = "<properties><comment>OTT-Play Preferences</comment><entry key=\"literal\">$value</entry></properties>"
        assertEquals(listOf("literal" to value), CloudStorageFraming.read(xml))
        assertNull(CloudStorageFraming.read(xml, true))
        assertEquals(listOf("key" to "&quot;"), CloudStorageFraming.read(raw("&quot;&amp;quot;&quot;")))
    }

    @Test fun quotedStringsRejectInvalidJsonAndRawXmlUnits() {
        val high = charArrayOf(0xd800.toChar()).concatToString()
        for (value in listOf("null", "1", "true", "[]", "{}", "&quot;x&quot;trailing", "\u00a0&quot;x&quot;", "\ufeff&quot;x&quot;", "\t&quot;x&quot;", "&quot;unclosed", "&quot;\\x20&quot;", "&quot;\\u12zz&quot;", "&quot;\\u１２３４&quot;", "&quot;<x&quot;", "&quot;&unknown;&quot;", "&quot;&#65;&quot;", "&quot;x\n&quot;", "&quot;" + high + "&quot;", "&quot;\ufffe&quot;", "&quot;\uffff&quot;")) invalid(raw(value))
        assertEquals(listOf("key" to "x"), CloudStorageFraming.read(raw(" &quot;x&quot; ")))
        assertEquals(listOf("key" to "\u0000\b\t\n\u000c\r/\\\""), CloudStorageFraming.read(raw("&quot;\\u0000\\b\\t\\n\\f\\r\\/\\\\\\&quot;&quot;")))
    }

    @Test fun structuralDuplicatesAndUnsafeKeysAreRejectedBeforeAnyResult() {
        for (key in listOf("__proto__", "constructor", "prototype")) {
            assertFailsWith<CloudStorageFailure> { CloudStorageFraming.entry(key, "x") }
            invalid(raw("&quot;x&quot;", "&quot;$key&quot;"))
            invalid("<properties><comment>OTT-Play Preferences</comment><entry key=\"$key\">x</entry></properties>")
        }
        invalid(document("same" to "one", "same" to "two"))
        invalid(document("x" to "one") + "<properties></properties>")
        invalid(document("x" to "one").replace("<properties>", "<!ENTITY x 'bad'><properties>"))
        invalid(document("x" to "one").replace(CloudStorageFraming.doctype, "<!DOCTYPE properties SYSTEM \"https://unexpected.test/dtd\">"))
        for (value in listOf("<entry key=\"x\">", "</entry >", "<properties>", "</properties\t>", "<!bad>", "<?bad?>")) {
            invalid("<properties><comment>OTT-Play Preferences</comment><entry key=\"x\">$value</entry></properties>")
        }
        assertFailsWith<CloudStorageFailure> { CloudStorageFraming.read(document("a" to "x", "b" to "y"), true, 1) }
        assertEquals(emptyList(), CloudStorageFraming.read(document(), true, 0))
    }

    @Test fun versionedDetectionOnlyUsesItsFramingPosition() {
        assertNull(CloudStorageFraming.read("<properties><comment>OTT-Play Preferences</comment></properties>", true))
        assertNull(CloudStorageFraming.read("<properties><comment>OTT-Play Preferences</comment><entry key=\"x\">" + CloudStorageFraming.marker + "</entry></properties>", true))
        assertNull(CloudStorageFraming.read("<!--else-->" + document("x" to "y"), true))
        invalid("<!--else-->" + document("x" to "y"))
        assertEquals(listOf("x" to "y"), CloudStorageFraming.read(document("x" to "y"), true))
    }

    @Test fun nativeStringPrimitiveCannotBypassCommonFramingOrKeyPolicy() {
        var calls = 0
        assertFailsWith<CloudStorageFailure> {
            CloudStorageFraming.entry("__proto__", "x") { calls++; it }
        }
        assertEquals(0, calls, "unsafe key fails before the encoding primitive")
        assertFailsWith<CloudStorageFailure> {
            CloudStorageFraming.read(document("one" to "1"), true, 10000) { "__proto__" }
        }
        assertFailsWith<CloudStorageFailure> {
            CloudStorageFraming.read(document("one" to "1", "two" to "2"), true, 10000) { "same" }
        }
        assertNull(CloudStorageFraming.read("<properties><comment>OTT-Play Preferences</comment></properties>", true, 10000) { calls++; it })
        assertEquals(0, calls, "legacy detection never decodes marker-looking data")
        assertFailsWith<CloudStorageFailure> {
            CloudStorageFraming.read(document("one" to "1") + "trailing", true, 10000) { it }
        }
    }
}
