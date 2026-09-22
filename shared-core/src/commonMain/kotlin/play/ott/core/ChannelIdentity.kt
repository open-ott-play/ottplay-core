package play.ott.core

class ChannelIdentity(private val restoration: ChannelRestoration, private val encode: (String) -> String,
                      private val fingerprint: (String) -> String, private val sameJson: (ProviderValue, ProviderValue) -> Boolean) {
    private fun str(value: String) = ProviderValue.text(value)
    private fun array(value: List<ProviderValue>) = ProviderValue.array(value)
    private fun obj(value: Map<String, ProviderValue>) = ProviderValue.obj(value)
    private fun id(value: ProviderValue) = value["id"].string()
    private fun text(value: ProviderValue) = restoration.text(value)
    private fun normalized(value: ProviderValue) = restoration.normalized(value)
    private fun belongs(id: String, source: String): Boolean = try { id.startsWith(encode(source) + ":") } catch (_: Throwable) { false }
    fun descriptor(item: ProviderValue, source: String): ProviderValue {
        val result = LinkedHashMap(restoration.reference(item, source).properties)
        result["kind"] = item["kind"].takeIf { it.truthy() } ?: str("live")
        if (item["url"].kind == ProviderValueKind.TEXT && item["url"].truthy()) result["stream"] = str(fingerprint(item["url"].scalar))
        return obj(result)
    }
    private fun used(state: ProviderValue): Set<String> {
        val result = linkedSetOf<String>()
        fun add(value: ProviderValue) { if (value.kind == ProviderValueKind.TEXT && value.scalar.isNotEmpty() && value.scalar.length <= 4096) result += value.scalar }
        state["favorites"].properties.values.forEach { it.elements.forEach(::add) }
        listOf("channelOverrides", "bookmarks").forEach { state[it].properties.keys.forEach { add(str(it)) } }
        state["favoriteItems"].properties.forEach { (key, value) -> add(str(key)); value["parents"].elements.forEach(::add) }
        state["history"].elements.forEach { add(it["id"]) }; state["reminders"].elements.forEach { add(it["channelId"]) }
        state["security"]["protectedIds"].elements.forEach(::add)
        add(state["lastChannel"]["id"]); add(state["previousChannel"]["id"])
        state["playbackPreferences"].elements.forEach { add(it["reference"]["id"]) }
        return result
    }
    fun remember(state: ProviderValue, items: List<ProviderValue>, source: String): ProviderValue {
        val needed = used(state); val records = mutableListOf<ProviderValue>(); val known = mutableSetOf<String>(); val available = linkedMapOf<String, ProviderValue>()
        items.filter { it.truthy() && (!it["sourceId"].truthy() || it["sourceId"].scalar == source) }.forEach { available[id(it)] = it }
        state["channelReferences"].elements.forEach { original ->
            if (id(original) !in needed) return@forEach
            val ref = if (original["sourceId"].scalar == source && id(original) in available) descriptor(available.getValue(id(original)), source) else original
            if (known.add(id(ref))) records += ref
        }
        needed.forEach { if (it !in known && it in available) { known += it; records += descriptor(available.getValue(it), source) } }
        val protected = state["security"]["protectedIds"].elements.map { it.string() }.toSet()
        return array((records.filter { id(it) in protected } + records.filter { id(it) !in protected }).take(50000))
    }
    private fun move(state: ProviderValue, mapping: Map<String, String>, rows: Map<String, ProviderValue>): ProviderValue {
        fun mapped(value: ProviderValue): ProviderValue = mapping[value.string()]?.let(::str) ?: value
        fun ids(values: ProviderValue) = array(values.elements.map(::mapped).distinctBy { it.string() })
        val result = LinkedHashMap(state.properties)
        result["favorites"] = obj(state["favorites"].properties.mapValues { ids(it.value) })
        result["security"] = obj(state["security"].properties + ("protectedIds" to ids(state["security"]["protectedIds"])))
        listOf("channelOverrides", "bookmarks", "favoriteItems").forEach { field ->
            val target = LinkedHashMap(state[field].properties)
            mapping.forEach { (old, next) ->
                val value = target[old] ?: return@forEach
                if (old == next) return@forEach
                if (next !in target) target[next] = value
                else if (field == "channelOverrides") {
                    val merged = LinkedHashMap(target.getValue(next).properties)
                    if (value["hidden"].truthy()) merged["hidden"] = ProviderValue(ProviderValueKind.BOOLEAN, "true")
                    listOf("name", "group", "order").forEach { if (it !in merged && it in value.properties) merged[it] = value[it] }
                    target[next] = obj(merged)
                }
                target.remove(old)
            }
            result[field] = obj(target)
        }
        result["favoriteItems"] = obj(result.getValue("favoriteItems").properties.mapValues { (_, value) -> obj(value.properties + ("parents" to array(value["parents"].elements.map(::mapped)))) })
        result["history"] = array(state["history"].elements.map { obj(it.properties + ("id" to mapped(it["id"]))) }.distinctBy(::id))
        result["reminders"] = array(state["reminders"].elements.map { val channel = mapped(it["channelId"]); obj(it.properties + mapOf("channelId" to channel, "id" to str(channel.string() + "@" + it["start"].string()))) }.distinctBy(::id))
        fun reference(ref: ProviderValue): ProviderValue = if (ref.truthy() && mapping[id(ref)] != null) restoration.reference(rows.getValue(mapping.getValue(id(ref))), ref["sourceId"].string()) else ref
        result["lastChannel"] = reference(state["lastChannel"]); result["previousChannel"] = reference(state["previousChannel"])
        result["playbackPreferences"] = array(state["playbackPreferences"].elements.map { obj(it.properties + ("reference" to reference(it["reference"]))) }.distinctBy { it["reference"]["sourceId"].string() + "\n" + it["reference"]["id"].string() })
        result["channelReferences"] = array(state["channelReferences"].elements.map { ref -> mapping[id(ref)]?.let { descriptor(rows.getValue(it), ref["sourceId"].string()) } ?: ref })
        return obj(result)
    }
    fun reconcile(state: ProviderValue, items: List<ProviderValue>, source: String): Pair<ProviderValue, ProviderValue> {
        val available = items.filter { it.truthy() && (!it["sourceId"].truthy() || it["sourceId"].scalar == source) }
        val byId = available.groupBy(::id)
        val needed = used(state); val refs = linkedMapOf<String, ProviderValue>(); val mapping = linkedMapOf<String, String>(); val rows = linkedMapOf<String, ProviderValue>()
        val aliases = linkedMapOf<String, MutableList<String>>(); val blocked = mutableListOf<ProviderValue>(); var unresolved = 0
        val protected = state["security"]["protectedIds"].elements.map { it.string() }.toSet()
        state["channelReferences"].elements.forEach { if (it["sourceId"].scalar == source) refs[id(it)] = it }
        (listOf(state["lastChannel"], state["previousChannel"]) + state["playbackPreferences"].elements.map { it["reference"] }).forEach { if (it.truthy() && it["sourceId"].scalar == source && id(it) !in refs) refs[id(it)] = it }
        needed.forEach { id -> if (id !in refs && belongs(id, source)) {
            val ref = linkedMapOf("sourceId" to str(source), "id" to str(id)); val history = state["history"].elements.firstOrNull { this.id(it) == id }
            if (history != null) { val custom = state["channelOverrides"][id]["name"]; if (!custom.truthy() || normalized(custom) != normalized(history["name"])) ref["name"] = history["name"] }
            refs[id] = obj(ref)
        } }
        fun kind(item: ProviderValue, ref: ProviderValue) = !ref["kind"].truthy() || (item["kind"].takeIf { it.truthy() } ?: str("live")).scalar == ref["kind"].scalar
        fun candidates(ref: ProviderValue): List<ProviderValue> {
            val tvg = text(ref["tvgId"]).ifEmpty { restoration.legacy(ref) }
            var candidates = if (tvg.isNotEmpty()) available.filter { text(it["tvgId"]) == tvg } else emptyList()
            if (candidates.isEmpty()) { val name = normalized(ref["name"]); val tvgName = normalized(ref["tvgName"]); candidates = if (name.isNotEmpty()) available.filter { normalized(it["name"]) == name } else emptyList(); if (candidates.isEmpty() && tvgName.isNotEmpty()) candidates = available.filter { normalized(it["tvgName"]) == tvgName } }
            return candidates.filter { kind(it, ref) }
        }
        fun resolve(ref: ProviderValue): ProviderValue? {
            byId[id(ref)]?.singleOrNull()?.let { return it }
            if (ref["kind"].scalar == "folder") return null
            if (ref["stream"].truthy()) available.filter { it["url"].kind == ProviderValueKind.TEXT && it["url"].truthy() && fingerprint(it["url"].scalar) == ref["stream"].scalar && kind(it, ref) }.singleOrNull()?.let { return it }
            val rows = candidates(ref); val selected = restoration.restore(rows.map { obj(it.properties + ("kind" to str("live"))) }, ref)
            return if (selected < 0) null else byId[id(rows[selected])]?.singleOrNull()
        }
        refs.forEach { (id, ref) ->
            if (id !in needed) return@forEach
            val matched = resolve(ref)
            if (matched != null) { if (this.id(matched) != id) { mapping[id] = this.id(matched); rows[this.id(matched)] = matched }; return@forEach }
            if (id in byId) return@forEach
            unresolved++
            if (id !in protected) return@forEach
            val plausible = candidates(ref).toMutableList(); val name = normalized(ref["name"]); val tvgName = normalized(ref["tvgName"])
            val possible = available.filter { name.isNotEmpty() && normalized(it["name"]) == name } + available.filter { tvgName.isNotEmpty() && normalized(it["tvgName"]) == tvgName }
            possible.forEach { if (it !in plausible && kind(it, ref)) plausible += it }
            if (plausible.isEmpty()) blocked += str(id)
            plausible.forEach { aliases.getOrPut(this.id(it)) { mutableListOf() } += id }
        }
        val moved = if (mapping.isEmpty()) state else move(state, mapping, rows)
        val remembered = remember(moved, items, source)
        val changed = mapping.isNotEmpty() || !sameJson(moved["channelReferences"].takeIf { it.truthy() } ?: array(emptyList()), remembered)
        val report = obj(linkedMapOf("changed" to ProviderValue(ProviderValueKind.BOOLEAN, changed.toString()), "aliases" to obj(aliases.mapValues { array(it.value.map(::str)) }), "blocked" to array(blocked), "unresolved" to ProviderValue(ProviderValueKind.NUMBER, unresolved.toString())))
        return obj(moved.properties + ("channelReferences" to remembered)) to report
    }
    fun permission(report: ProviderValue, id: String, protected: List<String>): String =
        if (!report.truthy()) id else (report["aliases"][id].elements + report["blocked"].elements).firstOrNull { it.string() in protected }?.string() ?: id
}
