package play.ott.core

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow

/** Pure parental configuration and authorization. Hashing, clock reads and persistence remain host effects. */
object ParentalState {
    val scopes = listOf("settings", "source", "import", "restore", "export", "proxy", "remote")
    private val playback = listOf("playback", "play", "archive", "vod", "history", "bookmark", "preview", "pip")
    private fun n(v: Number) = ProviderValue(ProviderValueKind.NUMBER, v.toString())
    private fun b(v: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, v.toString())
    private fun t(v: String) = ProviderValue.text(v)
    fun defaults(): ProviderValue = ProviderValue.obj(linkedMapOf("schema" to n(1), "enabled" to b(false), "salt" to t(""), "hash" to t(""),
        "iterations" to n(2048), "protectedIds" to ProviderValue.array(), "scopes" to ProviderValue.obj(scopes.associateWith { b(true) }),
        "sessionMinutes" to n(5), "failures" to n(0), "blockedUntil" to n(0)))
    private fun text(v: ProviderValue) = v.kind == ProviderValueKind.TEXT
    private fun number(v: ProviderValue) = v.kind == ProviderValueKind.NUMBER
    private fun finite(v: ProviderValue) = number(v) && v.number().isFinite()
    private fun fail(message: String): Nothing = throw DurableStateFailure(message)
    private fun strictFalse(v: ProviderValue) = v.kind == ProviderValueKind.BOOLEAN && v.scalar == "false"
    fun validate(value: ProviderValue): ProviderValue {
        val result = LinkedHashMap(defaults().properties)
        if (!value.present) return ProviderValue.obj(result)
        if (!value.isObject || !number(value["schema"]) || value["schema"].number() != 1.0 || value["enabled"].kind != ProviderValueKind.BOOLEAN) fail("Unsupported parental-control format")
        result["enabled"] = value["enabled"]
        if (value["enabled"].truthy()) {
            val salt = value["salt"]; val hash = value["hash"]
            if (!text(salt) || salt.scalar.length !in 16..160 || !salt.scalar.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in ":.-" } ||
                !text(hash) || hash.scalar.length != 64 || !hash.scalar.all { it in 'a'..'f' || it in 'A'..'F' || it in '0'..'9' }) fail("Invalid parental-control hash")
            val work = value["iterations"]
            val remainder = work.number() % 1
            // The browser API historically treats a NaN remainder as falsy.
            if (!number(work) || !remainder.isNaN() && remainder != 0.0 || work.number() < 1024 || work.number() > 8192) fail("Invalid parental-control work factor")
            result["salt"] = salt; result["hash"] = t(hash.scalar.lowercase()); result["iterations"] = work
        }
        val ids = value["protectedIds"]
        if (ids.kind != ProviderValueKind.MISSING && (!ids.isArray || ids.elements.size > 50000)) fail("Invalid protected channels")
        val seen = mutableSetOf<String>()
        result["protectedIds"] = ProviderValue.array(ids.elements.filter {
            if (!text(it) || it.scalar.isEmpty() || it.scalar.length > 4096) fail("Invalid protected channel ID")
            seen.add(it.scalar)
        })
        val scope = value["scopes"]
        if (scope.kind != ProviderValueKind.MISSING && !scope.isObject) fail("Invalid protection scopes")
        result["scopes"] = ProviderValue.obj(scopes.associateWith { b(!strictFalse(scope[it])) })
        val session = value["sessionMinutes"]; val failures = value["failures"]; val blocked = value["blockedUntil"]
        result["sessionMinutes"] = n(if (number(session) && session.number() in 1.0..30.0) floor(session.number()) else 5.0)
        result["failures"] = n(if (finite(failures)) floor(failures.number()).coerceIn(0.0, 30.0) else 0.0)
        result["blockedUntil"] = n(if (finite(blocked)) blocked.number().coerceAtLeast(0.0) else 0.0)
        return ProviderValue.obj(result)
    }
    fun validPin(value: ProviderValue): Boolean = text(value) && value.scalar.length in 4..12 && value.scalar.all { it in '0'..'9' }
    fun channelId(value: ProviderValue): Boolean = text(value) && value.scalar.isNotEmpty() && value.scalar.length <= 4096
    fun blockedUntil(blocked: Double, now: Double): Double = blocked.coerceAtMost(now + 300000)
    fun retryAfter(blocked: Double, now: Double): Double = ceil((blocked - now) / 1000).coerceAtLeast(0.0)
    fun failedCount(failures: Double): Double = (failures + 1).coerceAtMost(30.0)
    fun failedBlock(failures: Double, blocked: Double, now: Double): Double = if (failures < 5) blocked else now + (30000 * 2.0.pow((failures - 5).coerceAtMost(4.0))).coerceAtMost(300000.0)
    fun protected(config: ProviderValue, id: ProviderValue, action: ProviderValue): Boolean {
        if (!config["enabled"].truthy()) return false
        val operation = if (action.truthy()) action.string() else "playback"
        return if (operation in playback) !id.truthy() || config["protectedIds"].elements.any { it.kind == id.kind && it.scalar == id.scalar }
        else !config["scopes"].properties.containsKey(operation) || config["scopes"][operation].truthy()
    }
}

class ParentalSession {
    private var grantUntil = 0.0
    private var lastClock = 0.0
    private var identity = ""
    private var source: String? = null
    fun lock() { grantUntil = 0.0 }
    fun observe(identity: String, source: String?) {
        if (this.identity != identity || this.source != null && source != this.source) lock()
        this.identity = identity; this.source = source
    }
    fun clock(value: Double): Double {
        if (!value.isFinite() || value < 0) { lock(); return lastClock }
        if (value < lastClock) lock()
        lastClock = value; return value
    }
    fun grant(now: Double, minutes: Double): Double { grantUntil = now + minutes * 60000; return grantUntil }
    fun expires(now: Double): Double = if (grantUntil > now) grantUntil else 0.0
}
