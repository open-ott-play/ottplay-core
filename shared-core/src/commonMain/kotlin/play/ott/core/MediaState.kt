package play.ott.core

/** Provider item identity survives URL renewal and never depends on a displayed row. */
data class MediaRef(val sourceId: String, val itemId: String) {
    init { require(sourceId.isNotBlank() && itemId.isNotBlank()) { "Media identity is required" } }
}

data class MediaRecord<P>(val ref: MediaRef, val payload: P, val position: Double = 0.0)
data class MediaCollection<P>(val history: List<MediaRecord<P>>, val favorites: List<MediaRecord<P>>)
enum class MediaMutation { VISIT, POSITION, FAVORITE, UNFAVORITE, REMOVE_HISTORY }

object MediaState {
    const val MAX_ENTRIES = 1000
    /** A product may retain coarse resume deliberately; storage always retains the actual sample. */
    fun resume(position: Double, quantum: Double = 1.0): Double {
        if (!position.isFinite() || position < 0) return 0.0
        require(quantum.isFinite() && quantum > 0) { "Resume quantum must be positive" }
        return kotlin.math.floor(position / quantum) * quantum
    }

    fun <P> change(state: MediaCollection<P>, operation: MediaMutation, entry: MediaRecord<P>, limit: Int): MediaCollection<P> {
        val source = entry.ref.sourceId
        fun clean(rows: List<MediaRecord<P>>) = rows.filter { it.ref.sourceId == source }.distinctBy { it.ref }.take(MAX_ENTRIES)
        var history = clean(state.history)
        var favorites = clean(state.favorites)
        val previous = history.firstOrNull { it.ref == entry.ref } ?: favorites.firstOrNull { it.ref == entry.ref }
        val sampled = entry.position.takeIf { it.isFinite() && it >= 0 } ?: previous?.position ?: 0.0
        when (operation) {
            MediaMutation.VISIT -> {
                val next = entry.copy(position = previous?.position ?: 0.0)
                history = listOf(next) + history.filterNot { it.ref == entry.ref }
                favorites = favorites.map { if (it.ref == entry.ref) next else it }
            }
            MediaMutation.POSITION -> {
                // Position samples do not resurrect removed history or reorder navigation.
                history = history.map { if (it.ref == entry.ref) it.copy(position = sampled) else it }
                favorites = favorites.map { if (it.ref == entry.ref) it.copy(position = sampled) else it }
            }
            MediaMutation.FAVORITE -> favorites = favorites.filterNot { it.ref == entry.ref } + entry.copy(position = previous?.position ?: sampled)
            MediaMutation.UNFAVORITE -> favorites = favorites.filterNot { it.ref == entry.ref }
            MediaMutation.REMOVE_HISTORY -> history = history.filterNot { it.ref == entry.ref }
        }
        return MediaCollection(history.take(limit.coerceIn(0, MAX_ENTRIES)), favorites.take(MAX_ENTRIES))
    }
}
