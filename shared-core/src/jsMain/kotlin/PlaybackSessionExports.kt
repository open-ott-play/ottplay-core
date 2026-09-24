@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.PlaybackKind
import play.ott.core.PlaybackOvershoot
import play.ott.core.PlaybackPositionEffect
import play.ott.core.PlaybackSeekAction
import play.ott.core.PlaybackSeekIntent
import play.ott.core.PlaybackSeekRequest
import play.ott.core.PlaybackSeeking
import play.ott.core.PlaybackSessions
import play.ott.core.PlaybackTarget
import play.ott.core.PlaybackVisit

private fun sessionNumber(value: dynamic): Double? = if (jsTypeOf(value) == "number") value.unsafeCast<Double>() else null
private fun sessionTarget(value: dynamic): PlaybackTarget {
    require(value != null && jsTypeOf(value.sourceId) == "string" && jsTypeOf(value.channelId) == "string") { "Playback identity is required" }
    val kind = when (value.kind) {
        "live" -> PlaybackKind.LIVE
        "archive" -> PlaybackKind.ARCHIVE
        "vod" -> PlaybackKind.VOD
        else -> error("Unknown playback kind")
    }
    return PlaybackTarget(value.sourceId.unsafeCast<String>(), value.channelId.unsafeCast<String>(), kind, sessionNumber(value.archiveStart))
}
private fun sessionVisit(value: dynamic): PlaybackVisit<Any?>? = if (value == null) null
    else PlaybackVisit(sessionTarget(value), value.payload.unsafeCast<Any?>())
private fun sessionVisitValue(visit: PlaybackVisit<Any?>?): dynamic {
    if (visit == null) return null
    val result: dynamic = js("({})")
    result.sourceId = visit.target.sourceId
    result.channelId = visit.target.channelId
    result.kind = visit.target.kind.name.lowercase()
    if (visit.target.archiveStart != null) result.archiveStart = visit.target.archiveStart
    result.payload = visit.payload
    return result
}

/** Payloads are opaque host values, retained by identity rather than JSON round-tripped. */
@JsExport
fun playbackSessionTransition(current: dynamic, target: dynamic, history: dynamic, observedPosition: dynamic, limit: Int, historyKinds: dynamic = null): dynamic {
    require(js("Array.isArray(history)").unsafeCast<Boolean>()) { "Playback history must be an array" }
    val kinds = if (historyKinds == null) PlaybackKind.entries.toSet() else {
        require(js("Array.isArray(historyKinds)").unsafeCast<Boolean>()) { "Recorded playback kinds must be an array" }
        historyKinds.unsafeCast<Array<dynamic>>().map { kind -> when (kind) {
            "live" -> PlaybackKind.LIVE
            "archive" -> PlaybackKind.ARCHIVE
            "vod" -> PlaybackKind.VOD
            else -> error("Unknown recorded playback kind")
        } }.toSet()
    }
    val change = PlaybackSessions.transition(sessionVisit(current), sessionVisit(target),
        history.unsafeCast<Array<dynamic>>().map { sessionVisit(it) ?: error("Playback history contains an empty visit") },
        sessionNumber(observedPosition), limit, kinds)
    val result: dynamic = js("({})")
    result.current = sessionVisitValue(change.current)
    result.history = change.history.map(::sessionVisitValue).toTypedArray()
    result.effects = change.effects.map { effect ->
        val value: dynamic = js("({})")
        value.type = if (effect.type == PlaybackPositionEffect.SAVE_POSITION) "save-position" else "restore-position"
        value.target = sessionVisitValue(effect.target)
        if (effect.position != null) value.position = effect.position
        value
    }.toTypedArray()
    return result
}

@JsExport
fun playbackSeekPlan(target: dynamic, request: dynamic): dynamic {
    require(request != null) { "Playback seek request is required" }
    val intent = when (request.intent) {
        "offset" -> PlaybackSeekIntent.OFFSET
        "absolute" -> PlaybackSeekIntent.ABSOLUTE
        "begin" -> PlaybackSeekIntent.BEGIN
        "restart" -> PlaybackSeekIntent.RESTART
        "go-live" -> PlaybackSeekIntent.GO_LIVE
        else -> error("Unknown playback seek intent")
    }
    val plan = PlaybackSeeking.plan(if (target == null) null else sessionTarget(target), PlaybackSeekRequest(
        intent, sessionNumber(request.value), sessionNumber(request.position), sessionNumber(request.duration),
        sessionNumber(request.now), request.archiveAvailable == true, sessionNumber(request.archiveEarliest),
        sessionNumber(request.liveEdgeTolerance) ?: 0.0, request.restartAllowed != false,
        if (request.overshoot == "clamp") PlaybackOvershoot.CLAMP else PlaybackOvershoot.NOOP))
    val result: dynamic = js("({})")
    result.action = when (plan.action) {
        PlaybackSeekAction.OPEN_ARCHIVE -> "open-archive"
        PlaybackSeekAction.GO_LIVE -> "go-live"
        else -> plan.action.name.lowercase()
    }
    if (plan.position != null) result.position = plan.position
    if (plan.archiveStart != null) result.archiveStart = plan.archiveStart
    return result
}

@JsExport
class PlaybackSessionOwnership {
    private val policy = play.ott.core.PlaybackSessionOwnership()
    fun begin(): dynamic = policy.begin()
    fun cancel() = policy.cancel()
    fun accepts(ticket: dynamic): Boolean = policy.accepts(ticket.unsafeCast<Any?>())
}
