package play.ott.core

import kotlin.test.*

class XmltvWebRecordsTest {
    private val times = mapOf("channel" to "a", "start" to "20260914110000 +0000", "stop" to "20260914130000 +0000")
    private fun records(format: XmltvRecordFormat) = XmltvRecords(format).apply { start("tv", emptyMap()) }
    private fun XmltvRecords.field(name: String, value: String) { start(name, emptyMap()); text(value); end(name) }
    private fun XmltvRecords.finish(name: String): XmltvWebRecord { end(name); return assertNotNull(takeWebRecord()) }

    @Test fun browserFirstEmptyFieldsAndNullableAttributesArePreserved() {
        val r = records(XmltvRecordFormat.BROWSER)
        r.start("programme", mapOf("channel" to "", "stop" to ""))
        for (name in listOf("title", "desc", "catchup-id")) { r.field(name, ""); r.field(name, "Later") }
        val row = r.finish("programme")
        assertEquals("", row.id); assertNull(row.start); assertEquals("", row.stop)
        assertEquals("", row.title); assertEquals("", row.description); assertNull(row.catchupAttribute); assertEquals("", row.catchupElement)
        assertNull(r.takeWebRecord())
    }

    @Test fun onlyBrowserCanSkipReadingLaterUnusedFields() {
        for (format in listOf(XmltvRecordFormat.BROWSER, XmltvRecordFormat.NODE_STREAMING)) {
            val r = records(format); r.start("programme", times)
            r.start("unknown", emptyMap()); assertFalse(r.wantsText()); r.end("unknown")
            r.field("title", "First"); r.start("title", emptyMap())
            assertEquals(format == XmltvRecordFormat.NODE_STREAMING, r.wantsText())
            r.end("title"); assertEquals("First", r.finish("programme").title)
        }
    }

    @Test fun streamingSelectsFirstNonemptyFieldsAndRetainsRawCatchupAttribute() {
        val r = records(XmltvRecordFormat.NODE_STREAMING)
        r.start("programme", times + ("catchup-id" to " "))
        for (name in listOf("title", "desc", "catchup-id")) { r.field(name, " "); r.field(name, " First "); r.field(name, "Later") }
        val row = r.finish("programme")
        assertEquals("First", row.title); assertEquals("First", row.description)
        assertEquals(" ", row.catchupAttribute); assertEquals("", row.catchupElement)
        r.start("programme", times + ("catchup-id" to "")); r.field("catchup-id", " "); r.field("catchup-id", " ID "); r.field("catchup-id", "Later")
        assertEquals("ID", r.finish("programme").catchupElement)
    }

    @Test fun onlyDirectFieldsSelectButDescendantTextStaysInTheOuterField() {
        for (format in listOf(XmltvRecordFormat.BROWSER, XmltvRecordFormat.NODE_STREAMING)) {
            val r = records(format); r.start("programme", times)
            r.start("unknown", emptyMap()); r.field("title", "Ignored"); r.end("unknown")
            r.start("title", emptyMap()); r.text("A"); r.field("title", "B"); r.start("x", emptyMap()); r.text("C"); r.end("x"); r.text("D"); r.end("title")
            assertEquals("ABCD", r.finish("programme").title)
        }
    }

    @Test fun recordsUnderUnknownRootChildrenAreNotAdmitted() {
        val r = records(XmltvRecordFormat.BROWSER)
        r.start("wrapper", emptyMap()); r.start("programme", times); r.field("title", "Ignored"); r.end("programme"); r.end("wrapper")
        assertNull(r.takeWebRecord())
        r.start("programme", times); r.field("title", "Direct")
        assertEquals("Direct", r.finish("programme").title)
    }

    @Test fun browserKeepsEveryAliasAndIconBeforeExistingGuideNormalization() {
        val r = records(XmltvRecordFormat.BROWSER)
        r.start("channel", emptyMap()); r.field("display-name", " "); r.field("display-name", " Alias "); r.field("display-name", " Alias ")
        r.start("icon", emptyMap()); r.end("icon"); r.start("icon", mapOf("src" to "")); r.end("icon"); r.start("icon", mapOf("src" to "/logo")); r.end("icon")
        val row = r.finish("channel")
        assertNull(row.id); assertEquals(listOf(" ", " Alias ", " Alias "), row.names); assertEquals(listOf(null, "", "/logo"), row.icons)
    }

    @Test fun streamingAdmissionPrecedesIdAndFieldLimits() {
        val calls = mutableListOf<List<Any?>>()
        val r = XmltvRecords(XmltvRecordFormat.NODE_STREAMING, admission = { id, begin, end -> calls.add(listOf(id, begin, end)); false })
        r.start("tv", emptyMap()); r.start("programme", times + ("channel" to "x".repeat(513)))
        r.field("title", "a".repeat(16385)); r.end("programme")
        assertNull(r.takeWebRecord()); assertEquals(1, calls.size); assertNotNull(calls[0][1]); assertNotNull(calls[0][2])
        assertEquals("EPG_FIELD_TOO_LARGE", assertFailsWith<XmltvRecordError> { r.start("channel", mapOf("id" to "x".repeat(513))) }.code)
    }

    @Test fun textLimitCountsUtf16AcrossDecodedChunksEvenAfterAWinningField() {
        val r = records(XmltvRecordFormat.NODE_STREAMING)
        r.start("programme", times); r.field("title", "First"); r.start("title", emptyMap())
        r.text("\uD83D\uDE80".repeat(8192))
        assertEquals("EPG_FIELD_TOO_LARGE", assertFailsWith<XmltvRecordError> { r.text("x") }.code)
        val exact = records(XmltvRecordFormat.NODE_STREAMING)
        exact.start("programme", times); exact.field("title", "\uD83D\uDE80".repeat(8192))
        assertEquals(16384, exact.finish("programme").title.length)
    }

    @Test fun aliasesCountBlankAndDuplicateElementsTowardTheLimit() {
        val r = records(XmltvRecordFormat.NODE_STREAMING)
        r.start("channel", mapOf("id" to "a")); repeat(64) { r.field("display-name", " ") }
        r.start("display-name", emptyMap())
        assertEquals("EPG_FIELD_TOO_LARGE", assertFailsWith<XmltvRecordError> { r.end("display-name") }.code)
        val exact = records(XmltvRecordFormat.NODE_STREAMING)
        exact.start("channel", mapOf("id" to "a")); repeat(64) { exact.field("display-name", " ") }
        assertEquals(List(64) { "" }, exact.finish("channel").names)
    }

    @Test fun iconPrecedenceUsesHostResolutionButLaterIconsStillEnforceLimits() {
        val calls = mutableListOf<String>()
        val r = XmltvRecords(XmltvRecordFormat.NODE_STREAMING, resolveIcon = { calls.add(it); if (it == "good") "resolved" else "" })
        r.start("tv", emptyMap()); r.start("channel", mapOf("id" to "a"))
        for (src in listOf("bad", "good", "later")) { r.start("icon", mapOf("src" to src)); r.end("icon") }
        assertEquals(listOf("bad", "good"), calls)
        assertEquals("EPG_FIELD_TOO_LARGE", assertFailsWith<XmltvRecordError> { r.start("icon", mapOf("src" to "x".repeat(8193))) }.code)
    }

    @Test fun irrelevantFieldsAndNestedIconsDoNotAcquireFieldLimits() {
        val r = records(XmltvRecordFormat.NODE_STREAMING)
        r.start("channel", mapOf("id" to "a")); r.start("unknown", emptyMap()); r.start("icon", mapOf("src" to "x".repeat(8193))); r.end("icon"); r.end("unknown")
        assertEquals("", r.finish("channel").icon)
        r.start("programme", times); r.field("unknown", "x".repeat(16385)); r.start("icon", mapOf("src" to "x".repeat(8193))); r.end("icon"); r.field("title", "Known")
        assertEquals("Known", r.finish("programme").title)
    }
}
