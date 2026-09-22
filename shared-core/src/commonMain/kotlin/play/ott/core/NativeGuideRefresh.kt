package play.ott.core

enum class NativeGuideRefreshFormat { ANDROID, RUST_SERVER }
enum class NativeGuideRefreshAction { FETCH, VALIDATE_SOURCE, OPEN_DATABASE, WRITE_DATABASE, REPLACE, SKIP, FAIL }

/** Refresh policy only. Hosts retain payloads/errors and execute effects under their existing locks.
 * Android validates the current source after all downloads, while holding its refresh lock.
 * The server returns a fresh result even if every feed failed, and ignores persistence errors.
 */
class NativeGuideRefresh(private val count: Int, private val format: NativeGuideRefreshFormat) {
    private var cursor = 0
    private val ownedChannels = mutableSetOf<String>()
    private var pending = if (count > 0) NativeGuideRefreshAction.FETCH else when (format) {
        NativeGuideRefreshFormat.ANDROID -> NativeGuideRefreshAction.SKIP
        NativeGuideRefreshFormat.RUST_SERVER -> NativeGuideRefreshAction.OPEN_DATABASE
    }

    init { require(count >= 0) }

    fun action(): NativeGuideRefreshAction = pending
    fun index(): Int = if (pending == NativeGuideRefreshAction.FETCH) cursor else -1

    /** Metadata belongs to the first successful feed; programme payloads remain in source order. */
    fun unowned(incoming: List<String>): List<String> {
        check(pending == NativeGuideRefreshAction.FETCH)
        require(format == NativeGuideRefreshFormat.RUST_SERVER)
        return NativeGuideSources.claim(ownedChannels, incoming)
    }

    /** For OPEN_DATABASE, available describes an optional pool. VALIDATE_SOURCE reports equality. */
    fun advance(succeeded: Boolean, available: Boolean = true) {
        pending = when (pending) {
            NativeGuideRefreshAction.FETCH -> {
                if (!succeeded && format == NativeGuideRefreshFormat.ANDROID) NativeGuideRefreshAction.FAIL
                else {
                    cursor++
                    if (cursor < count) NativeGuideRefreshAction.FETCH
                    else if (format == NativeGuideRefreshFormat.ANDROID) NativeGuideRefreshAction.VALIDATE_SOURCE
                    else NativeGuideRefreshAction.OPEN_DATABASE
                }
            }
            NativeGuideRefreshAction.VALIDATE_SOURCE ->
                if (succeeded) NativeGuideRefreshAction.WRITE_DATABASE else NativeGuideRefreshAction.SKIP
            NativeGuideRefreshAction.OPEN_DATABASE -> when {
                !succeeded -> NativeGuideRefreshAction.FAIL
                available -> NativeGuideRefreshAction.WRITE_DATABASE
                else -> NativeGuideRefreshAction.REPLACE
            }
            NativeGuideRefreshAction.WRITE_DATABASE ->
                if (succeeded || format == NativeGuideRefreshFormat.RUST_SERVER) NativeGuideRefreshAction.REPLACE
                else NativeGuideRefreshAction.FAIL
            else -> error("Native guide refresh already completed")
        }
    }

    companion object {
        /** The host's interval timer retains its immediate first tick. */
        fun intervalSeconds(format: NativeGuideRefreshFormat): Int {
            require(format == NativeGuideRefreshFormat.RUST_SERVER)
            return 7200
        }
    }
}
