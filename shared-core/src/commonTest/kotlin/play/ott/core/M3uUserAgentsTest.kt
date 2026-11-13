package play.ott.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class M3uUserAgentsTest {
    @Test fun emptyDefaultsAndCustomBytes() {
        assertEquals("OTT-play-FOSS/1.0", M3uUserAgents.resolve(null))
        assertEquals(M3uUserAgents.default, M3uUserAgents.resolve(""))
        for (custom in listOf(" ", " webos ", "Custom/1.0 (Test)", "__proto__", "constructor", "CUSTOM/Ä", "KODI", "TİZEN", "WEBOſ", "ẞ")) {
            assertEquals(custom, M3uUserAgents.resolve(custom))
        }
    }

    @Test fun canonicalPresetsIgnoreCaseAndCannotBeMutatedGlobally() {
        val presets = M3uUserAgents.presets()
        assertEquals(listOf("dune", "mag", "tizen", "viera", "webos"), presets.keys.toList())
        presets.forEach { (id, agent) ->
            assertTrue(agent.startsWith("Mozilla/5.0"))
            assertEquals(agent, M3uUserAgents.resolve(id))
            assertEquals(agent, M3uUserAgents.resolve(id.uppercase()))
        }
        (presets as MutableMap)["webos"] = "changed"
        assertTrue(M3uUserAgents.resolve("WebOS").contains("LG Browser/9.00.00"))
    }
}
