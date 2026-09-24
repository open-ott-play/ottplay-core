package play.ott.core

/** Combined-account transport policy with provider-owned channel references. */
class OperatorChannelSession(private val base: String, private val addresses: XtreamAddresses) {
    private var action = OperatorSourceAction.API
    private var networkFailure = false
    private val categories = mutableListOf<ProviderValue>()
    private val streams = mutableListOf<ProviderValue>()

    fun action() = action
    fun request() = if (action == OperatorSourceAction.PLAYLIST) addresses.legacyPlaylist(base, networkFailure)
        else addresses.api(XtreamRequest(""))
    fun reject() { networkFailure = true; action = OperatorSourceAction.PLAYLIST }

    fun accept(response: ProviderValue) {
        if (!response.truthy() || !response["live_streams"].truthy()) {
            action = OperatorSourceAction.PLAYLIST
            return
        }
        val groups = response["categories"]
        if (groups.truthy()) append(groups, categories, "CATEGORIES", "CATEGORY_ROW")
        append(response["live_streams"], streams, "STREAMS", "STREAM_ROW")
    }

    private fun append(input: ProviderValue, target: MutableList<ProviderValue>, collection: String, row: String) {
        if (!input.isArray) throw OperatorCatalogFailure(collection)
        input.elements.forEach {
            if (!it.present) throw OperatorCatalogFailure(row, it.kind == ProviderValueKind.NULL)
            target.add(it)
        }
    }

    fun catalog(): List<CatalogChannel> = ChannelCatalog.xtream(mapOf(
        "get_live_categories" to ProviderValue.array(categories),
        "get_live_streams" to ProviderValue.array(streams)
    ), addresses)
}
