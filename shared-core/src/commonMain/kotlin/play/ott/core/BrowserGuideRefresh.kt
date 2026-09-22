package play.ott.core

data class BrowserGuideRefreshInfo(val phase: String, val total: Int, val done: Int, val errors: List<String>)
data class BrowserGuideRefreshState(
    val generation: Double, val urls: List<String>, val feeds: List<String>,
    val info: BrowserGuideRefreshInfo, val due: Double, val failures: Int,
)
data class BrowserGuideRefreshChange(
    val state: BrowserGuideRefreshState, val merge: Boolean = false, val notify: Boolean = false,
)

/** Keeps refresh policy independent of network requests, parsed guide payloads and UI effects.
 * Feed keys tell the host which payloads to retain and merge, in configured source order.
 */
class BrowserGuideRefresh {
    private var generation = 0.0
    private var urls = emptyList<String>()
    private val feeds = mutableSetOf<String>()
    private var phase = "idle"
    private var total = 0
    private var done = 0
    private val errors = mutableListOf<String>()
    private var due = 0.0
    private var failures = 0
    private var successful = mutableListOf<Boolean>()
    private var pending = 0
    private var automatic = false
    private var hasGuide = false
    private var destroyed = false

    fun normalize(values: List<String>): List<String> = values.map {
        if (it == "http://epg.it999.ru/epg2.xml.gz") "https://cdn.epg.one/epg2.xml.gz" else it
    }.distinct().take(10)

    fun snapshot() = BrowserGuideRefreshState(generation, urls.toList(), urls.filter { it in feeds },
        BrowserGuideRefreshInfo(phase, total, done, errors.toList()), due, failures)

    fun accepts(epoch: Double): Boolean = !destroyed && epoch == generation
    fun isDue(now: Double): Boolean = !destroyed && due != 0.0 && now >= due && phase != "loading"

    fun begin(values: List<String>, automatic: Boolean): BrowserGuideRefreshChange? {
        if (destroyed) return null
        val next = normalize(values)
        if (next.isEmpty()) return null
        generation++
        feeds.retainAll(next.toSet())
        val changed = urls.joinToString("\n") != next.joinToString("\n")
        urls = next
        if (changed) { hasGuide = feeds.isNotEmpty(); failures = 0 }
        this.automatic = automatic
        total = urls.size; pending = total; done = 0; phase = "loading"; errors.clear()
        successful = MutableList(total) { false }
        return BrowserGuideRefreshChange(snapshot(), merge = changed)
    }

    /** A null error means XML parsing returned normally; an empty guide is still a success.
     * Repeated callbacks retain the original request-slot semantics, including a prior success
     * followed by an error. Cancellation/admission belongs to the generation, not individual slots.
     */
    fun complete(epoch: Double, index: Int, success: Boolean, error: String?, now: Double): BrowserGuideRefreshChange? {
        if (!accepts(epoch) || index !in urls.indices) return null
        if (error == null) {
            successful[index] = success
            if (success) feeds.add(urls[index]) else feeds.remove(urls[index])
        } else errors.add(error.ifEmpty { "NETWORK" })
        pending--; done++
        val merge = successful[index] && feeds.isNotEmpty()
        if (merge) hasGuide = true
        if (pending == 0) {
            phase = if (successful.any { it }) "ready" else "error"
            failures = if (errors.isNotEmpty()) failures + 1 else 0
            val delay = if (failures == 0) 1800000 else minOf(1800000, 60000 * (1 shl minOf(failures - 1, 5)))
            due = now + delay
        }
        return BrowserGuideRefreshChange(snapshot(), merge,
            pending == 0 && errors.isNotEmpty() && (!automatic || !hasGuide))
    }

    /** Deleting/importing a playlist historically retains its last visible status, while loading
     * another playlist resets status too. Both paths clear guide payload ownership and retry state.
     */
    fun reset(resetStatus: Boolean) {
        generation++; urls = emptyList(); feeds.clear(); due = 0.0; failures = 0; hasGuide = false
        if (resetStatus) { phase = "idle"; total = 0; done = 0; errors.clear() }
    }

    fun destroy() { if (!destroyed) { destroyed = true; generation++ } }
}
