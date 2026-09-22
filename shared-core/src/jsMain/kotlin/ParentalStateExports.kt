@file:OptIn(ExperimentalJsExport::class)
import play.ott.core.*

@JsExport fun parentalDefaults(): dynamic = unwire(ParentalState.defaults())
@JsExport fun parentalValidate(value: dynamic): dynamic = try { unwire(ParentalState.validate(wire(value))) }
catch (failure: DurableStateFailure) { val message = failure.message; throw js("new Error(message)") }
@JsExport fun parentalValidPin(value: dynamic): Boolean = ParentalState.validPin(wire(value))
@JsExport fun parentalChannelId(value: dynamic): Boolean = ParentalState.channelId(wire(value))
@JsExport fun parentalProtected(config: dynamic, id: dynamic, action: dynamic): Boolean = ParentalState.protected(wire(config), wire(id), wire(action))
@JsExport fun parentalBlock(blocked: Double, now: Double): Double = ParentalState.blockedUntil(blocked, now)
@JsExport fun parentalRetry(blocked: Double, now: Double): Double = ParentalState.retryAfter(blocked, now)
@JsExport fun parentalFailedCount(failures: Double): Double = ParentalState.failedCount(failures)
@JsExport fun parentalFailedBlock(failures: Double, blocked: Double, now: Double): Double = ParentalState.failedBlock(failures, blocked, now)
@JsExport class BrowserParentalSession {
    private val session = ParentalSession()
    fun lock() = session.lock()
    fun observe(identity: String, source: String?) = session.observe(identity, source)
    fun clock(value: dynamic): Double = session.clock(if (jsTypeOf(value) == "number") value.unsafeCast<Double>() else Double.NaN)
    fun grant(now: Double, minutes: Double): Double = session.grant(now, minutes)
    fun expires(now: Double): Double = session.expires(now)
}
