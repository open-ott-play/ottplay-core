package play.ott.core

enum class PlaybackKind { LIVE, ARCHIVE, VOD }

/** Domain identity never contains a category position or a persisted host key. */
data class PlaybackTarget(
    val sourceId: String,
    val channelId: String,
    val kind: PlaybackKind,
    val archiveStart: Double? = null,
) {
    init {
        require(sourceId.isNotBlank() && channelId.isNotBlank()) { "Playback identity is required" }
        require(if (kind == PlaybackKind.ARCHIVE) archiveStart != null && archiveStart.isFinite() && archiveStart >= 0
            else archiveStart == null) { "Only archive playback has an absolute start time" }
    }
    internal fun identity() = PlaybackIdentity(sourceId, channelId, kind)
}

internal data class PlaybackIdentity(val sourceId: String, val channelId: String, val kind: PlaybackKind)

/** Presentation data belongs to the caller; policy does not inspect or copy it. */
data class PlaybackVisit<Payload>(val target: PlaybackTarget, val payload: Payload)
enum class PlaybackPositionEffect { SAVE_POSITION, RESTORE_POSITION }
data class PlaybackSessionEffect<Payload>(val type: PlaybackPositionEffect, val target: PlaybackVisit<Payload>, val position: Double? = null)
data class PlaybackSessionChange<Payload>(
    val current: PlaybackVisit<Payload>?,
    val history: List<PlaybackVisit<Payload>>,
    val effects: List<PlaybackSessionEffect<Payload>>,
)

object PlaybackSessions {
    const val MAX_HISTORY = 1000

    /** History contains departures, newest first. The destination is never its own previous visit.
     * Observed position is media seconds, including for an archive stream whose origin is an epoch.
     * A null destination means departure only; storage and media effects are performed by the host.
     */
    fun <Payload> transition(
        current: PlaybackVisit<Payload>?, target: PlaybackVisit<Payload>?,
        history: List<PlaybackVisit<Payload>>, observedPosition: Double?, limit: Int,
        historyKinds: Set<PlaybackKind> = PlaybackKind.entries.toSet(),
    ): PlaybackSessionChange<Payload> {
        val position = observedPosition?.takeIf { it.isFinite() && it >= 0 }
        val leaving = current != null && current.target != target?.target
        val effects = mutableListOf<PlaybackSessionEffect<Payload>>()
        if (leaving && current.target.kind == PlaybackKind.VOD && position != null)
            effects += PlaybackSessionEffect(PlaybackPositionEffect.SAVE_POSITION, current, position)
        if (target?.target?.kind == PlaybackKind.VOD && current?.target != target.target)
            effects += PlaybackSessionEffect(PlaybackPositionEffect.RESTORE_POSITION, target)

        val destination = target?.target?.identity()
        val candidates = mutableListOf<PlaybackVisit<Payload>>()
        if (current != null && current.target.identity() != destination) {
            val epoch = if (current.target.kind == PlaybackKind.ARCHIVE && position != null)
                current.target.archiveStart!! + position else null
            candidates += if (epoch != null && epoch.isFinite()) current.copy(target = current.target.copy(archiveStart = epoch)) else current
        }
        candidates.addAll(history)
        val seen = mutableSetOf<PlaybackIdentity>()
        val retained = candidates.filter { it.target.kind in historyKinds && it.target.identity() != destination && seen.add(it.target.identity()) }
            .take(limit.coerceIn(0, MAX_HISTORY))
        return PlaybackSessionChange(target, retained, effects)
    }
}

/** Opaque tickets bind asynchronous completion to one owner and one request, even on target reuse. */
class PlaybackSessionOwnership {
    private var current: Any? = null
    fun begin(): Any = Any().also { current = it }
    fun cancel() { current = null }
    fun accepts(ticket: Any?): Boolean = ticket != null && ticket === current
}

enum class PlaybackSeekIntent { OFFSET, ABSOLUTE, BEGIN, RESTART, GO_LIVE }
enum class PlaybackOvershoot { NOOP, CLAMP }
data class PlaybackSeekRequest(
    val intent: PlaybackSeekIntent,
    val value: Double? = null,
    val position: Double? = null,
    val duration: Double? = null,
    val now: Double? = null,
    val archiveAvailable: Boolean = false,
    val archiveEarliest: Double? = null,
    val liveEdgeTolerance: Double = 0.0,
    val restartAllowed: Boolean = true,
    val overshoot: PlaybackOvershoot = PlaybackOvershoot.NOOP,
)
enum class PlaybackSeekAction { SEEK, OPEN_ARCHIVE, GO_LIVE, RESTART, NOOP }
data class PlaybackSeekPlan(val action: PlaybackSeekAction, val position: Double? = null, val archiveStart: Double? = null)

object PlaybackSeeking {
    private val noop = PlaybackSeekPlan(PlaybackSeekAction.NOOP)
    private fun nonnegative(value: Double?) = value?.takeIf { it.isFinite() && it >= 0 }

    /** VOD absolute values are media seconds. Live/archive absolute values are epoch seconds;
     * their observed position is still a media offset from the explicit archiveStart.
     */
    fun plan(target: PlaybackTarget?, request: PlaybackSeekRequest): PlaybackSeekPlan {
        if (target == null) return noop
        if (request.intent == PlaybackSeekIntent.RESTART)
            return if (request.restartAllowed) PlaybackSeekPlan(PlaybackSeekAction.RESTART) else noop
        if (request.intent == PlaybackSeekIntent.GO_LIVE)
            return if (target.kind == PlaybackKind.ARCHIVE) PlaybackSeekPlan(PlaybackSeekAction.GO_LIVE) else noop
        val value = request.value?.takeIf { it.isFinite() }
        if (request.intent == PlaybackSeekIntent.OFFSET && (value == null || value == 0.0)) return noop
        if (request.intent == PlaybackSeekIntent.ABSOLUTE && value == null) return noop
        if (target.kind == PlaybackKind.VOD) {
            val requested = when (request.intent) {
                PlaybackSeekIntent.BEGIN -> 0.0
                PlaybackSeekIntent.ABSOLUTE -> value!!
                PlaybackSeekIntent.OFFSET -> (nonnegative(request.position) ?: return noop) + value!!
            }
            if (!requested.isFinite()) return noop
            var position = maxOf(0.0, requested)
            val duration = nonnegative(request.duration)?.takeIf { it > 0 }
            if (duration != null && position > duration) {
                if (request.overshoot == PlaybackOvershoot.NOOP) return noop
                position = duration
            }
            return PlaybackSeekPlan(PlaybackSeekAction.SEEK, position = position)
        }
        if (target.kind == PlaybackKind.LIVE && request.intent == PlaybackSeekIntent.OFFSET && value!! > 0)
            return if (request.restartAllowed) PlaybackSeekPlan(PlaybackSeekAction.RESTART) else noop
        val now = nonnegative(request.now) ?: return noop
        val earliest = nonnegative(request.archiveEarliest)
        val requested = when (request.intent) {
            PlaybackSeekIntent.BEGIN -> earliest ?: return noop
            PlaybackSeekIntent.ABSOLUTE -> value!!
            PlaybackSeekIntent.OFFSET -> (if (target.kind == PlaybackKind.LIVE) now
                else target.archiveStart!! + (nonnegative(request.position) ?: return noop)) + value!!
        }
        if (!requested.isFinite()) return noop
        val tolerance = nonnegative(request.liveEdgeTolerance) ?: 0.0
        if (requested >= now - tolerance)
            return if (target.kind == PlaybackKind.ARCHIVE) PlaybackSeekPlan(PlaybackSeekAction.GO_LIVE) else noop
        if (!request.archiveAvailable) return noop
        val epoch = maxOf(0.0, earliest ?: 0.0, requested)
        if (epoch >= now - tolerance) return noop
        return PlaybackSeekPlan(PlaybackSeekAction.OPEN_ARCHIVE, archiveStart = epoch)
    }
}
