package play.ott.core

import kotlin.test.*

class OperatorSourcesTest {
    @Test fun browserAndNativeCredentialWhitespaceContractsRemainDistinct() {
        assertEquals("", OperatorSources.credentials("xtream", " ", "p", "", false))
        assertEquals("SOURCE_CREDENTIALS", OperatorSources.credentials("xtream", " ", "p", "", true))
        assertEquals("STALKER_MAC", OperatorSources.credentials("stalker", "", "", "bad", true))
        assertEquals("", OperatorSources.credentials("stalker", "", "", "00:1A:79:01:02:03", true))
    }
    @Test fun sourceOwnershipPrecedesPlayableKindAndEpisodeChecksRemainJoint() {
        assertEquals("SOURCE_MISMATCH", OperatorSources.relationship("android-resolve", "m3u", "a", "series", "b"))
        assertEquals("FOLDER_REQUIRED", OperatorSources.relationship("android-resolve", "xtream", "a", "series", "a"))
        assertEquals("EPISODES", OperatorSources.relationship("android-episodes", "m3u", "a", "series", "a"))
        assertEquals("", OperatorSources.relationship("android-episodes", "xtream", "a", "series", "a"))
        assertEquals("SOURCE_MISMATCH", OperatorSources.relationship("browser-browse", "xtream", "a", "live", "b"))
    }
    @Test fun configKeepsRawPersistentIdAndNormalizesProtocolDefaults() {
        val source = ProviderValue.obj(mapOf("id" to ProviderValue.text(" a "), "type" to ProviderValue.text(" XTREAM "),
            "username" to ProviderValue.text("u"), "password" to ProviderValue.text("p")))
        assertEquals("a", OperatorSources.namespace(source["id"]))
        val result = OperatorSources.browser(source, "https://host")
        assertEquals(" a ", result["id"].string())
        assertEquals("xtream", result["type"].string())
        assertEquals("UTC", result["timezone"].string())
        assertEquals("m3u8", result["output"].string())
        assertEquals("SOURCE_URL", assertFailsWith<OperatorSourceFailure> { OperatorSources.browser(source, "") }.code)
    }
}
