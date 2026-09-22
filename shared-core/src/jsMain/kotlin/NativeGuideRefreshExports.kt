@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.NativeGuideRefreshFormat

private fun refreshFormat(format: String): NativeGuideRefreshFormat = when (format) {
    "android" -> NativeGuideRefreshFormat.ANDROID
    "rust-server" -> NativeGuideRefreshFormat.RUST_SERVER
    else -> error("Unknown native guide refresh format")
}

@JsExport
class NativeGuideRefresh(count: Int, format: String) {
    private val refresh = play.ott.core.NativeGuideRefresh(count, refreshFormat(format))
    fun action(): String = refresh.action().name
    fun index(): Int = refresh.index()
    fun advance(succeeded: Boolean, available: Boolean = true) = refresh.advance(succeeded, available)
    fun unowned(incoming: Array<String>): Array<String> = refresh.unowned(incoming.toList()).toTypedArray()
}

@JsExport
fun nativeGuideRefreshInterval(format: String = "rust-server"): Int =
    play.ott.core.NativeGuideRefresh.intervalSeconds(refreshFormat(format))
