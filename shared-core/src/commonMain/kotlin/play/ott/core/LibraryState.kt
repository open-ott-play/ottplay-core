package play.ott.core

/** User library edits, reminder retention and durable per-channel choices. */
object LibraryState {
    private fun text(value: String) = ProviderValue.text(value)
    private fun number(value: Number) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    private fun bool(value: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, value.toString())
    private fun obj(value: Map<String, ProviderValue>) = ProviderValue.obj(value)
    private fun array(value: List<ProviderValue>) = ProviderValue.array(value)
    private fun strictTrue(value: ProviderValue) = value.kind == ProviderValueKind.BOOLEAN && value.scalar == "true"
    fun edit(id: ProviderValue, values: ProviderValue, stringify: (ProviderValue) -> String): ProviderValue {
        if (!BrowserDurableState.channelKey(id)) throw DurableStateFailure("Invalid channel ID")
        fun field(key: String) = stringify(values[key].takeIf { it.truthy() } ?: text("")).take(160)
        val order = values["order"].number().takeIf { !it.isNaN() && it != 0.0 } ?: 0.0
        return obj(linkedMapOf("name" to text(field("name")), "group" to text(field("group")), "hidden" to bool(strictTrue(values["hidden"])), "order" to number(order.coerceIn(0.0, 50000.0))))
    }
    fun decorated(items: List<ProviderValue>, overrides: ProviderValue, includeHidden: Boolean): List<ProviderValue> = items.mapIndexed { index, item ->
        val change = overrides[item["id"].string()]
        obj(item.properties + mapOf("name" to (change["name"].takeIf { it.truthy() } ?: item["name"]), "group" to (change["group"].takeIf { it.kind == ProviderValueKind.TEXT } ?: item["group"]),
            "hidden" to bool(strictTrue(change["hidden"])), "order" to (change["order"].takeIf { it.kind == ProviderValueKind.NUMBER } ?: number(index)), "originalIndex" to number(index)))
    }.filter { includeHidden || !it["hidden"].truthy() }.sortedWith { left, right ->
        val difference = left["order"].number() - right["order"].number()
        if (!difference.isNaN() && difference != 0.0) if (difference < 0) -1 else 1 else left["originalIndex"].number().compareTo(right["originalIndex"].number())
    }
    fun reminderId(channel: String, start: String): String = "$channel@$start"
    fun toggleReminder(reminders: ProviderValue, channel: ProviderValue, programme: ProviderValue): ProviderValue {
        val id = reminderId(channel["id"].string(), programme["start"].string()); var removed = false
        val values = reminders.elements.filter { if (it["id"].kind == ProviderValueKind.TEXT && it["id"].scalar == id) { removed = true; false } else true }.toMutableList()
        if (!removed) values += obj(linkedMapOf("id" to text(id), "channelId" to channel["id"], "title" to programme["title"], "start" to programme["start"], "end" to programme["end"]))
        return array(values.takeLast(500))
    }
    fun preferenceIndex(entries: List<ProviderValue>, channel: ProviderValue, active: ProviderValue, items: List<ProviderValue>, restoration: ChannelRestoration): Int {
        val candidates = mutableListOf<Int>()
        entries.forEachIndexed { index, entry ->
            val ref = entry["reference"]
            if (ref["sourceId"].scalar != active["sourceId"].scalar || ref["sourceId"].kind != active["sourceId"].kind) return@forEachIndexed
            if (ref["id"].scalar == active["id"].scalar && ref["id"].kind == active["id"].kind) return index
            if (channel["kind"].scalar != "vod") { val selected = restoration.restore(items, ref); if (selected >= 0 && items[selected]["id"].scalar == channel["id"].scalar) candidates += index }
        }
        return candidates.singleOrNull() ?: -1
    }
    fun preferenceEntry(active: ProviderValue, preferred: ProviderValue, field: String, value: ProviderValue): ProviderValue {
        val result = linkedMapOf("reference" to active)
        listOf("audio", "subtitle", "aspect", "zoom").forEach { if (preferred[it].kind != ProviderValueKind.MISSING) result[it] = preferred[it] }
        result[field] = value; return obj(result)
    }
    fun savePreference(entries: ProviderValue, entry: ProviderValue, previous: ProviderValue): ProviderValue {
        val active = entry["reference"]
        return array((listOf(entry) + entries.elements.filter { row -> val ref = row["reference"]; !(ref["sourceId"].scalar == active["sourceId"].scalar && ref["sourceId"].kind == active["sourceId"].kind && (ref["id"].scalar == active["id"].scalar && ref["id"].kind == active["id"].kind || previous.truthy() && ref["id"].scalar == previous["id"].scalar && ref["id"].kind == previous["id"].kind)) }).take(200))
    }
}
