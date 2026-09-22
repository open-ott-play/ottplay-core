package play.ott.core

enum class NativeSourceLoadAction {
    READ_FRESH_DISK, FETCH, WRITE_DISK, REPARSE_NETWORK, READ_MEMORY, READ_STALE_DISK,
    USE_FRESH_DISK, USE_NETWORK, USE_MEMORY, USE_STALE_DISK, FAIL,
}

/** Pure transitions: hosts perform one effect and report its outcome, keeping payloads and errors native. */
object NativeSourceLoad {
    fun start(force: Boolean): NativeSourceLoadAction =
        if (force) NativeSourceLoadAction.FETCH else NativeSourceLoadAction.READ_FRESH_DISK

    /** For disk/network, success and a nonempty channel index are required. Memory only needs presence.
     * Swift requires a successful write and reparses the validated XML afterwards. Failure of that second
     * parse terminates directly; Android keeps its first parsed response even when disk writing fails.
     */
    fun next(action: NativeSourceLoadAction, succeeded: Boolean, channels: Int, format: NativeSourceFormat): NativeSourceLoadAction {
        require(format == NativeSourceFormat.SWIFT || format == NativeSourceFormat.ANDROID)
        require(channels >= 0)
        val usable = succeeded && channels > 0
        return when (action) {
            NativeSourceLoadAction.READ_FRESH_DISK -> if (usable) NativeSourceLoadAction.USE_FRESH_DISK else NativeSourceLoadAction.FETCH
            NativeSourceLoadAction.FETCH -> if (usable) NativeSourceLoadAction.WRITE_DISK else NativeSourceLoadAction.READ_MEMORY
            NativeSourceLoadAction.WRITE_DISK -> when {
                format == NativeSourceFormat.ANDROID -> NativeSourceLoadAction.USE_NETWORK
                succeeded -> NativeSourceLoadAction.REPARSE_NETWORK
                else -> NativeSourceLoadAction.READ_MEMORY
            }
            NativeSourceLoadAction.REPARSE_NETWORK -> if (succeeded) NativeSourceLoadAction.USE_NETWORK else NativeSourceLoadAction.FAIL
            NativeSourceLoadAction.READ_MEMORY -> if (succeeded) NativeSourceLoadAction.USE_MEMORY else NativeSourceLoadAction.READ_STALE_DISK
            NativeSourceLoadAction.READ_STALE_DISK -> if (usable) NativeSourceLoadAction.USE_STALE_DISK else NativeSourceLoadAction.FAIL
            else -> error("Native source load already completed")
        }
    }
}

/** Source effects run sequentially. An empty successful source does not hide an earlier failure. */
class NativeSourceBatch(private val count: Int) {
    private var index = 0
    private var firstFailure = -1
    private var populated = false
    init { require(count >= 0) }
    fun next(): Int = if (index < count) index else -1
    fun advance(succeeded: Boolean, channels: Int) {
        check(index < count)
        require(channels >= 0)
        if (succeeded) populated = populated || channels > 0
        else if (firstFailure < 0) firstFailure = index
        index++
    }
    fun failure(): Int {
        check(index == count)
        return if (populated) -1 else firstFailure
    }
}
