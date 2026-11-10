package play.ott.core

import kotlin.math.ceil
import kotlin.math.floor

/** Classic watchdog v1: a distinct profile from PlaybackRetries (0..5 attempts, 10s healthy reset). */
object ClassicLiveStallPolicy {
    data class Limits(val attempts: Int, val timeout: Double)
    data class Plan(val phase: String, val remaining: Double = 0.0, val restart: Boolean = false)

    fun limits(attempts: ProviderValue, timeout: ProviderValue): Limits {
        val count = attempts.number()
        val seconds = timeout.number()
        return Limits(
            if (attempts.kind == ProviderValueKind.NUMBER && count.isFinite() && floor(count) == count && count in 0.0..5.0) count.toInt() else 0,
            if (timeout.kind == ProviderValueKind.NUMBER && seconds in listOf(10.0, 15.0, 20.0, 30.0)) seconds * 1000 else 15000.0,
        )
    }

    fun resetWindow(time: Double, lastTick: Double, lastProgress: Double, handleChanged: Boolean, activityChanged: Boolean): Boolean =
        time - lastTick > 5000 || time < lastProgress || handleChanged || activityChanged

    fun validPosition(position: Double): Boolean = position.isFinite() && position >= 0
    fun progress(position: Double, previous: Double?): Boolean = validPosition(position) && previous != null && position - previous > 0.05
    fun healthyAttempts(attempts: Int, since: Double, time: Double): Int = if (time - since >= 10000) 0 else attempts

    fun blockedPhase(terminal: Boolean, blocked: Boolean, armed: Boolean, attempts: Int, limit: Int, restarting: Boolean): String =
        if (blocked || terminal || !restarting) {
            if (terminal && !blocked && armed && attempts >= limit) "exhausted" else "hidden"
        } else "restarting"

    /** Restart is only an eligibility result; the host must still recheck source/decoder ownership before consuming an attempt. */
    fun plan(armed: Boolean, attempts: Int, age: Double, limits: Limits, restarting: Boolean, progressing: Boolean): Plan {
        val phase = when {
            progressing -> "hidden"
            !armed -> "hidden"
            attempts >= limits.attempts && age >= limits.timeout -> "exhausted"
            restarting -> "restarting"
            age >= 3000 && attempts < limits.attempts -> "countdown"
            else -> "hidden"
        }
        val remaining = if (phase == "countdown") maxOf(0.0, ceil((limits.timeout - age) / 1000)) else 0.0
        // Express the original refusal predicates directly, preserving NaN comparison behavior.
        val restart = !(!armed || attempts >= limits.attempts || age < limits.timeout)
        return Plan(phase, remaining, restart)
    }
}
