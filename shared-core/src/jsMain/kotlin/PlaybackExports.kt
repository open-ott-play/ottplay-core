@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.PlaybackCapabilities
import play.ott.core.PlaybackRange
import play.ott.core.PlaybackRules
import play.ott.core.PlaybackTrack

@JsExport
fun playbackEngineValid(value: String): Boolean = PlaybackRules.validEngine(value)
@JsExport
fun playbackFormatValid(value: String): Boolean = PlaybackRules.validFormat(value)
@JsExport
fun playbackFormat(value: String): String = PlaybackRules.format(value)
@JsExport
fun playbackEngines(format: String, preferred: String, cap: dynamic): Array<String> =
    PlaybackRules.engines(format, preferred, PlaybackCapabilities(cap.nativeHls == true, cap.hlsJs == true,
        cap.nativeDash == true, cap.shaka == true, cap.mpegts == true, cap.nativeTransport == true,
        cap.lg == true, cap.chromium == true)).toTypedArray()
@JsExport
fun classicPlaybackAutoMode(url: String, nativeHls: () -> Boolean, testWebView: () -> Boolean, hls: () -> Boolean): Int =
    PlaybackRules.classicAutoMode(url, nativeHls, testWebView, hls)
@JsExport
fun classicPlaybackDefaultMode(webOs: Boolean, desktop: Boolean, testWebView: () -> Boolean): Int =
    PlaybackRules.classicDefaultMode(webOs, desktop, testWebView)
@JsExport
fun classicPlaybackMode(mode: Double, webOs: Boolean, autoAvailable: () -> Boolean, nativeHls: () -> Boolean, hls: () -> Boolean): Double =
    PlaybackRules.classicMode(mode, webOs, autoAvailable, nativeHls, hls)
@JsExport
fun playbackSeek(position: Double, start: Double, end: Double, ranges: dynamic, restoreLive: Boolean = false): Double =
    PlaybackRules.seek(position, start, end, ranges.unsafeCast<Array<dynamic>>().map {
        PlaybackRange(it.start.unsafeCast<Double>(), it.end.unsafeCast<Double>()) }, restoreLive)
private fun playbackText(value: dynamic): String = js("String(value || '')").unsafeCast<String>()
@JsExport
fun playbackTrack(tracks: dynamic, choice: dynamic, backend: String): Int =
    PlaybackRules.track(tracks.unsafeCast<Array<dynamic>>().map { row ->
        PlaybackTrack(playbackText(row.language), playbackText(row.label), js("row.id === choice.id").unsafeCast<Boolean>())
    }, playbackText(choice.language), playbackText(choice.label), js("choice.backend === backend").unsafeCast<Boolean>())
@JsExport
class PlaybackRetries(limit: dynamic, delay: Double) {
    private val policy = play.ott.core.PlaybackRetries(PlaybackRules.retryLimit(
        if (kotlin.js.jsTypeOf(limit) == "number") limit.unsafeCast<Double>() else null), delay)
    fun attempts(): Int = policy.attempts
    fun reset() = policy.reset()
    fun delay(): Double = policy.delay()
    fun admit(live: Boolean): Boolean = policy.admit(live)
}

@JsExport
fun playbackChannelIndex(current: Double, count: Int, direction: Int, format: String): Double =
    play.ott.core.ChannelMovement.index(current, count, direction, when (format) {
        "browser" -> play.ott.core.ChannelMovementFormat.BROWSER
        "classic" -> play.ott.core.ChannelMovementFormat.CLASSIC
        "native" -> play.ott.core.ChannelMovementFormat.NATIVE
        else -> error("Unknown channel movement profile")
    })

@JsExport
class PlaybackRecovery(networkLimit: Int = 2) {
    private val policy = play.ott.core.PlaybackRecovery(networkLimit)
    fun reset() = policy.reset()
    fun media(available: Boolean = true) = policy.media(available)
    fun network(details: String) = policy.network(details)
}
@JsExport
class PlaybackRestart {
    private val policy = play.ott.core.PlaybackRestart()
    fun reset() = policy.reset()
    fun finish() = policy.finish()
    fun pending() = policy.pending
    fun admit(parseFailure: Boolean, archive: Boolean, playing: Boolean) = policy.admit(parseFailure, archive, playing)
}
@JsExport
class PlaybackEngineSequence {
    private val policy = play.ott.core.PlaybackEngineSequence()
    fun reset() = policy.reset()
    fun empty() = policy.empty()
    fun set(value: Array<String>) = policy.set(value.toList())
    fun current() = policy.current()
    fun canAdvance(automatic: Boolean) = policy.canAdvance(automatic)
    fun advance() = policy.advance()
    fun fallbacks() = policy.fallbacks
}
@JsExport
fun playbackParsingFailure(details: String) = play.ott.core.PlaybackRecovery.parsingFailure(details)
@JsExport
fun playbackDeclaredFormat(mime: String, format: String, type: String, hint: String, url: String): dynamic {
    val value = play.ott.core.PlaybackDetectionRules.declared(mime, format, type, hint, url)
    val result: dynamic = js("({})")
    result.format = value.format
    result.reason = value.reason
    return result
}
@JsExport
fun playbackBodyFormat(text: String): String = play.ott.core.PlaybackDetectionRules.body(text)
