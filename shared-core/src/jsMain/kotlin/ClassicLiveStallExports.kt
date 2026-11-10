@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.ClassicLiveStallPolicy

@JsExport fun classicLiveStallLimits(attempts: dynamic, timeout: dynamic): dynamic {
    val limits = ClassicLiveStallPolicy.limits(wire(attempts), wire(timeout))
    val result: dynamic = js("({})")
    result.attempts = limits.attempts
    result.timeout = limits.timeout
    return result
}

@JsExport fun classicLiveStallResetWindow(time: Double, lastTick: Double, lastProgress: Double, handleChanged: Boolean, activityChanged: Boolean): Boolean =
    ClassicLiveStallPolicy.resetWindow(time, lastTick, lastProgress, handleChanged, activityChanged)

@JsExport fun classicLiveStallValidPosition(position: Double): Boolean = ClassicLiveStallPolicy.validPosition(position)
@JsExport fun classicLiveStallProgress(position: Double, previous: Double?): Boolean = ClassicLiveStallPolicy.progress(position, previous)
@JsExport fun classicLiveStallHealthyAttempts(attempts: Int, since: Double, time: Double): Int = ClassicLiveStallPolicy.healthyAttempts(attempts, since, time)
@JsExport fun classicLiveStallBlockedPhase(terminal: Boolean, blocked: Boolean, armed: Boolean, attempts: Int, limit: Int, restarting: Boolean): String =
    ClassicLiveStallPolicy.blockedPhase(terminal, blocked, armed, attempts, limit, restarting)

@JsExport fun classicLiveStallPlan(armed: Boolean, attempts: Int, age: Double, limit: Int, timeout: Double, restarting: Boolean, progressing: Boolean): dynamic {
    val plan = ClassicLiveStallPolicy.plan(armed, attempts, age, ClassicLiveStallPolicy.Limits(limit, timeout), restarting, progressing)
    val result: dynamic = js("({})")
    result.phase = plan.phase
    result.remaining = plan.remaining
    result.restart = plan.restart
    return result
}
