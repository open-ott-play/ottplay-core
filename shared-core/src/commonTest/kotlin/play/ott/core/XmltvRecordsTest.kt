package play.ott.core

import kotlin.test.*

class XmltvRecordsTest {
    private fun XmltvRecords.field(name: String, value: String) { start(name, emptyMap()); text(value); end(name) }
    private fun XmltvRecords.programme(id: String? = "a", title: String = "Title") {
        start("programme", if (id == null) emptyMap() else mapOf("channel" to id))
        field("title", title); end("programme")
    }

    @Test fun firstNativeChannelNameAndAccumulatedAliasesSurviveDrains() {
        val records = XmltvRecords(XmltvRecordFormat.SWIFT)
        records.start("channel", mapOf("id" to "a")); records.field("display-name", " First ")
        assertEquals(listOf(listOf("name", "a", "First"), listOf("channel", "a", "First")), records.drain())
        records.field("display-name", "Second"); records.start("icon", mapOf("src" to "one")); records.end("channel")
        records.start("channel", mapOf("id" to "a")); records.field("display-name", "First"); records.start("icon", emptyMap()); records.end("channel")
        assertEquals(listOf(listOf("name", "a", "Second"), listOf("icon", "a", "one"), listOf("name", "a", "First"), listOf("icon", "a", "")), records.drain())
    }
    @Test fun channelFallbackAndHostCanonicalIdentityRetainNativeSpelling() {
        val records = XmltvRecords(XmltvRecordFormat.SWIFT, identity = { if (it == "e\u0301") "é" else it })
        records.start("channel", mapOf("id" to "é")); records.end("channel")
        records.start("channel", mapOf("id" to "e\u0301")); records.field("display-name", "Later"); records.end("channel")
        assertEquals(listOf(listOf("channel", "é", "é"), listOf("name", "e\u0301", "Later")), records.drain())
    }
    @Test fun rustReplacesCompleteChannelsAndKeepsEmptyAliases() {
        val records = XmltvRecords(XmltvRecordFormat.RUST)
        records.start("channel", mapOf("id" to "a")); records.field("display-name", "First"); records.field("display-name", " ")
        records.start("icon", mapOf("src" to "one")); records.start("icon", emptyMap()); records.end("channel")
        assertEquals(listOf(listOf("replace-channel", "a", "a", "one", "First", "")), records.drain())
        records.start("channel", mapOf("id" to "a")); records.field("display-name", "Last"); records.end("channel")
        assertEquals(listOf(listOf("replace-channel", "a", "Last", "", "Last")), records.drain())
    }
    @Test fun concatenationAndLastFieldPoliciesRemainDifferent() {
        for (format in listOf(XmltvRecordFormat.SWIFT, XmltvRecordFormat.ARCHIVED_ANDROID, XmltvRecordFormat.RUST)) {
            val records = XmltvRecords(format)
            records.start("programme", mapOf("channel" to "a")); records.field("title", " One "); records.field("title", "Two")
            records.field("desc", "A"); records.field("desc", "B"); records.end("programme")
            val row = records.drain().single()
            assertEquals(if (format == XmltvRecordFormat.RUST) "Two" else " One Two", row[4])
            assertEquals(if (format == XmltvRecordFormat.RUST) "B" else "AB", row[5])
        }
    }
    @Test fun titlePresenceAndBlankPoliciesAreExplicit() {
        for (format in listOf(XmltvRecordFormat.SWIFT, XmltvRecordFormat.ARCHIVED_ANDROID, XmltvRecordFormat.RUST)) {
            val records = XmltvRecords(format)
            records.programme(title = ""); records.programme(title = " ")
            assertEquals(if (format == XmltvRecordFormat.SWIFT) 1 else 0, records.drain().size)
        }
    }
    @Test fun absentAndEmptyIdsStayDistinctExceptRust() {
        for (format in listOf(XmltvRecordFormat.SWIFT, XmltvRecordFormat.ARCHIVED_ANDROID, XmltvRecordFormat.RUST)) {
            val records = XmltvRecords(format)
            records.programme(null); records.programme("")
            assertEquals(if (format == XmltvRecordFormat.RUST) 2 else 1, records.drain().size)
        }
    }
    @Test fun nestedUnknownEndClearsOnlyRustTextScope() {
        for (format in listOf(XmltvRecordFormat.SWIFT, XmltvRecordFormat.ARCHIVED_ANDROID, XmltvRecordFormat.RUST)) {
            val records = XmltvRecords(format)
            records.start("programme", mapOf("channel" to "a")); records.start("title", emptyMap()); records.text("A")
            records.start("unknown", emptyMap()); records.text("B"); records.end("unknown"); records.text("C"); records.end("title"); records.end("programme")
            val rows = records.drain()
            if (format == XmltvRecordFormat.RUST) assertTrue(rows.isEmpty()) else assertEquals("ABC", rows.single()[4])
        }
    }
    @Test fun inactiveDecodingErrorsAreIgnoredAndActiveErrorStopsLaterEffects() {
        val records = XmltvRecords(XmltvRecordFormat.RUST)
        records.textError("outside"); records.programme(title = "Before")
        records.start("programme", mapOf("channel" to "a")); records.start("title", emptyMap()); records.textError("original")
        records.end("title"); records.end("programme"); records.programme(title = "After")
        assertEquals(listOf("programme", "error"), records.drain().map { it[0] })
        assertTrue(records.drain().isEmpty())
    }
    @Test fun activeAndroidTrimsIdsSelectsFirstFieldsAndSuppliesDefaultTitle() {
        val records = XmltvRecords(XmltvRecordFormat.ANDROID)
        val attrs = mapOf("channel" to " a ", "start" to "20260914110000 +0000", "stop" to "20260914120000 +0000")
        records.start("programme", attrs); records.field("title", " "); records.field("title", "First"); records.field("title", "Second")
        records.field("desc", " One "); records.field("desc", "Two"); records.end("programme")
        var row = records.drain().single(); assertEquals("a", row[1]); assertEquals("First", row[4]); assertEquals("One", row[5])
        records.start("programme", attrs); records.end("programme"); row = records.drain().single(); assertEquals("Untitled programme", row[4])
        records.programme(); assertTrue(records.drain().isEmpty())
    }
    @Test fun sameFeedCanBeDrainedAtEveryEventWithoutChangingEffects() {
        fun run(drainOften: Boolean): List<List<String>> {
            val records = XmltvRecords(XmltvRecordFormat.SWIFT)
            val result = mutableListOf<List<String>>()
            repeat(600) {
                records.start("programme", mapOf("channel" to "a")); if (drainOften) result.addAll(records.drain())
                records.start("title", emptyMap()); records.text("x".repeat(257)); if (drainOften) result.addAll(records.drain())
                records.end("title"); records.end("programme"); if (drainOften) result.addAll(records.drain())
            }
            result.addAll(records.drain()); return result
        }
        assertEquals(run(false), run(true))
    }
    @Test fun stableOrderingReturnsPayloadIndicesAndLeavesBrowserOrderAlone() {
        val starts = listOf(3.0, 1.0, 3.0, -1.0)
        assertEquals(listOf(0, 1, 2, 3), NativeRecordRules.order(starts, XmltvRecordFormat.RUST))
        for (format in listOf(XmltvRecordFormat.SWIFT, XmltvRecordFormat.ARCHIVED_ANDROID, XmltvRecordFormat.RUST_NATIVE))
            assertEquals(listOf(3, 1, 0, 2), NativeRecordRules.order(starts, format))
    }
}
