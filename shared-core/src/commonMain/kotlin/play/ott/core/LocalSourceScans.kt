package play.ott.core

/** A source record and its playable items belong to one catalogue snapshot. */
enum class LocalSourceScanStatus(val wire: String) {
    LEGACY("legacy"), PENDING("pending"), SCANNING("scanning"),
    COMPLETE("complete"), ERROR("error"), INVALID("invalid")
}

/**
 * Only an omitted protocol permits legacy global completion. An advertised
 * protocol without the selected record is pending, never proof of completion.
 * Hosts retain source matching, record objects, current-generation ownership,
 * permission checks, playback admission, polling and error presentation.
 */
object LocalSourceScans {
    const val MAX_GENERATION = 9_007_199_254_740_991.0

    fun classify(advertised: Boolean, array: Boolean, matches: Int,
                 generation: Double?, state: String?): LocalSourceScanStatus {
        if (!advertised) return LocalSourceScanStatus.LEGACY
        if (!array || matches !in 0..1) return LocalSourceScanStatus.INVALID
        if (matches == 0) return LocalSourceScanStatus.PENDING
        if (generation == null || !generation.isFinite() || generation < 1 ||
            generation > MAX_GENERATION || kotlin.math.floor(generation) != generation)
            return LocalSourceScanStatus.INVALID
        return when (state) {
            "pending" -> LocalSourceScanStatus.PENDING
            "scanning" -> LocalSourceScanStatus.SCANNING
            "complete" -> LocalSourceScanStatus.COMPLETE
            "error" -> LocalSourceScanStatus.ERROR
            else -> LocalSourceScanStatus.INVALID
        }
    }
}
