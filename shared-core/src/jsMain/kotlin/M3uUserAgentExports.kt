@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.M3uUserAgents

@JsExport fun m3uDefaultUserAgent(): String = M3uUserAgents.default
@JsExport fun m3uUserAgentPresets(): dynamic {
    val result: dynamic = js("({})")
    M3uUserAgents.presets().forEach { (name, value) -> result[name] = value }
    return result
}
@JsExport fun resolveM3uUserAgent(input: String?): String = M3uUserAgents.resolve(input)
