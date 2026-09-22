package play.ott.core

/** One provider operation, including synchronous completion and late transport-handle attachment. */
class OperatorRequestLifetime {
    private class Request(var settled: Boolean = false, var attached: Boolean = false, var aborted: Boolean = false)
    private val requests = mutableListOf<Request>()
    var active = true; private set
    fun begin(): Int {
        if (!active) return -1
        requests.add(Request())
        return requests.lastIndex
    }
    fun accept(id: Int): Boolean {
        val request = requests.getOrNull(id) ?: return false
        if (!active || request.settled) return false
        request.settled = true
        return true
    }
    fun failed(id: Int) { requests.getOrNull(id)?.settled = true }
    fun attach(id: Int): String {
        val request = requests.getOrNull(id) ?: return "IGNORE"
        if (request.settled || request.aborted) return "IGNORE"
        request.attached = true
        if (!active) { request.aborted = true; return "ABORT" }
        return "KEEP"
    }
    /** Null means already cancelled/completed; otherwise return only still outstanding handles. */
    fun end(): List<Int>? {
        if (!active) return null
        active = false
        return requests.mapIndexedNotNull { index, request ->
            if (!request.settled && !request.aborted && request.attached) { request.aborted = true; index } else null
        }
    }
}

/** Session and normalized catalog ownership, with exactly one retained Xtream series response. */
class OperatorLifetime<S, C, D> {
    private val sessions = mutableMapOf<String, S>()
    private val catalogs = mutableMapOf<String, C>()
    private var seriesKey: String? = null
    private var seriesData: D? = null
    private var generation = 0
    fun nextGeneration(): Int = ++generation
    fun session(source: String): S? = sessions[source]
    fun catalog(source: String): C? = catalogs[source]
    fun setSession(source: String, session: S) { sessions[source] = session }
    fun setCatalog(source: String, catalog: C) { catalogs[source] = catalog }
    fun series(api: String, id: String): D? = if (seriesKey == key(api, id)) seriesData else null
    fun setSeries(api: String, id: String, value: D) { seriesKey = key(api, id); seriesData = value }
    fun close(source: String) { sessions.remove(source); catalogs.remove(source); seriesKey = null; seriesData = null }
    private fun key(api: String, id: String) = "$api\n$id"
    companion object {
        fun libraryIndices(kinds: List<String>): List<Int> = kinds.indices.filter { kinds[it] != "live" }
        fun seriesSection(folderType: String, seasonNumber: String): String? = if (folderType == "season") "$$seasonNumber" else null
    }
}
