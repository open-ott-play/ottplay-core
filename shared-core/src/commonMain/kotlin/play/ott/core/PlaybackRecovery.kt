package play.ott.core

/** Decoder recovery decisions; the host performs detach, seek, load and timer effects. */
class PlaybackRecovery(private val networkLimit: Int = 2) {
    private var recovered = false
    private var networkAttempts = 0
    fun reset() { recovered = false; networkAttempts = 0 }
    fun media(available: Boolean = true): Boolean {
        if (recovered || !available) return false
        recovered = true
        return true
    }
    fun network(details: String): Boolean {
        if (parsingFailure(details) || networkAttempts >= networkLimit) return false
        networkAttempts++
        return true
    }
    companion object {
        fun parsingFailure(details: String) = details.contains("Parsing") || details.contains("parsing")
    }
}

class PlaybackRestart {
    private var used = false
    var pending = false
        private set
    fun reset() { used = false; pending = false }
    fun finish() { pending = false }
    fun admit(parseFailure: Boolean, archive: Boolean, playing: Boolean): String {
        if (!parseFailure || archive || used || !playing) return "stop"
        if (pending) return "pending"
        used = true
        pending = true
        return "restart"
    }
}

class PlaybackEngineSequence {
    private var plan = emptyList<String>()
    private var index = 0
    var fallbacks = 0
        private set
    fun reset() { plan = emptyList(); index = 0; fallbacks = 0 }
    fun empty() = plan.isEmpty()
    fun set(value: List<String>) { plan = value; index = 0 }
    fun current(): String? = plan.getOrNull(index)
    fun canAdvance(automatic: Boolean) = automatic && index + 1 < plan.size
    fun advance() { index++; fallbacks++ }
}
