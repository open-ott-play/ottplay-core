package play.ott.core

class OperatorCatalogFailure(val code: String, val isNull: Boolean = false) : Exception(code)
enum class OperatorSourceAction { API, PLAYLIST, CONFIGURE }

/** Combined-account operator policy. HTTP, native failures, name hashing and UI stay with the host. */
class OperatorSession(private val base: String, private val addresses: XtreamAddresses, hash: (ProviderValue) -> Double) {
    private val catalog = LegacyXtreamCatalogBuilder(addresses, hash, true)
    private var action = OperatorSourceAction.API
    private var networkFailure = false
    fun action() = action
    fun request() = if (action == OperatorSourceAction.PLAYLIST) addresses.legacyPlaylist(base, networkFailure) else addresses.api(XtreamRequest(""))
    fun reject() { networkFailure = true; action = OperatorSourceAction.PLAYLIST }
    fun accept(response: ProviderValue) {
        if (!response.truthy() || !response["live_streams"].truthy()) { action = OperatorSourceAction.PLAYLIST; return }
        val categories = response["categories"]
        if (categories.truthy()) {
            if (!categories.isArray) throw OperatorCatalogFailure("CATEGORIES")
            categories.elements.forEach(catalog::category)
        }
        val streams = response["live_streams"]
        if (!streams.isArray) throw OperatorCatalogFailure("STREAMS")
        streams.elements.forEach(catalog::stream)
    }
    fun catalog() = catalog.catalog()

    companion object {
        fun source(config: ProviderValue) = when {
            config["server"].truthy() && config["user"].truthy() && config["pass"].truthy() -> OperatorSourceAction.API
            config["m3u"].truthy() -> OperatorSourceAction.PLAYLIST
            else -> OperatorSourceAction.CONFIGURE
        }
    }
}
