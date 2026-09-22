@file:OptIn(ExperimentalJsExport::class)

private fun browserRefreshState(value: play.ott.core.BrowserGuideRefreshState): dynamic {
    val result: dynamic = js("({})")
    val info: dynamic = js("({})")
    info.phase = value.info.phase; info.total = value.info.total; info.done = value.info.done
    info.errors = value.info.errors.toTypedArray()
    result.generation = value.generation; result.urls = value.urls.toTypedArray(); result.feeds = value.feeds.toTypedArray()
    result.info = info; result.due = value.due; result.failures = value.failures
    return result
}

private fun browserRefreshChange(value: play.ott.core.BrowserGuideRefreshChange?): dynamic {
    if (value == null) return null
    val result = browserRefreshState(value.state)
    result.merge = value.merge; result.notify = value.notify
    return result
}

@JsExport
class BrowserGuideRefresh {
    private val refresh = play.ott.core.BrowserGuideRefresh()
    /** The boundary filters foreign JS values before common URL normalization. */
    fun normalize(values: dynamic): Array<String> {
        val rows: Array<dynamic> = when (jsTypeOf(values)) {
            "string" -> if (values == "") emptyArray() else arrayOf(values)
            else -> if (values == null) emptyArray() else values.unsafeCast<Array<dynamic>>()
        }
        return refresh.normalize(rows.filter { jsTypeOf(it) == "string" }.map { it.unsafeCast<String>() }).toTypedArray()
    }
    fun begin(urls: Array<String>, automatic: Boolean): dynamic = browserRefreshChange(refresh.begin(urls.toList(), automatic))
    fun accepts(epoch: Double): Boolean = refresh.accepts(epoch)
    fun complete(epoch: Double, index: Int, success: Boolean, error: String?, now: Double): dynamic =
        browserRefreshChange(refresh.complete(epoch, index, success, error, now))
    fun reset(resetStatus: Boolean) = refresh.reset(resetStatus)
    fun destroy() = refresh.destroy()
    fun isDue(now: Double): Boolean = refresh.isDue(now)
    fun snapshot(): dynamic = browserRefreshState(refresh.snapshot())
}
