package play.ott.core

/**
 * Version 1 classic channel-library policy. This is the existing classic document,
 * not the FOSS2 settings format. Hosts retain storage, readback/rollback, source
 * ownership, legacy numeric projection and provider-index construction.
 *
 * [decision] never draws randomness or changes data. A host calls [reduce] only
 * inside its existing admitted commit; shuffle's random primitive therefore is
 * never invoked by a refused/read-only write. Neither result authorizes I/O.
 */
object ClassicChannelLibrary {
    const val API_VERSION = 1
    data class Decision(val accepted: Boolean = false, val commit: Boolean = false,
                        val result: ProviderValue = ProviderValue(ProviderValueKind.BOOLEAN, "false"))

    private fun text(value: String) = ProviderValue.text(value)
    private fun bool(value: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, value.toString())
    private fun number(value: Double) = ProviderValue(ProviderValueKind.NUMBER, value.toString())
    private fun obj(values: Map<String, ProviderValue>) = ProviderValue.obj(LinkedHashMap(values))
    private fun array(values: List<ProviderValue>) = ProviderValue.array(values.toList())
    private fun strings(values: List<String>) = array(values.map(::text))
    private fun isText(value: ProviderValue) = value.kind == ProviderValueKind.TEXT
    private fun isStrings(value: ProviderValue) = value.isArray && value.elements.all(::isText)
    private fun trueValue(value: ProviderValue) = value.kind == ProviderValueKind.BOOLEAN && value.scalar == "true"
    private fun unique(value: ProviderValue, excluded: List<String> = emptyList()): List<String> {
        val seen = excluded.toMutableSet()
        return if (value.isArray) value.elements.mapNotNull { if (isText(it) && seen.add(it.scalar)) it.scalar else null } else emptyList()
    }
    private fun fields(value: ProviderValue) = LinkedHashMap(value.properties)
    private fun objectFields(value: ProviderValue) = if (value.isArray)
        value.elements.mapIndexed { index, item -> index.toString() to item }.toMap() else value.properties
    private fun group(values: List<ProviderValue>, id: String) = values.firstOrNull { it["id"].scalar == id }
    // Match firstOrNull even for duplicate IDs supplied directly to the common API.
    private fun firstGroups(values: List<ProviderValue>): Map<String, ProviderValue> =
        linkedMapOf<String, ProviderValue>().apply {
            values.forEach { row -> val id = row["id"].scalar; if (!containsKey(id)) put(id, row) }
        }
    private fun live(provider: List<ProviderValue>, id: String) = group(provider, id)
    private fun list(value: ProviderValue) = value.elements.map { it.scalar }
    private fun positiveInteger(value: ProviderValue): Boolean = value.kind == ProviderValueKind.NUMBER &&
        value.number().let { it.isFinite() && it > 0 && kotlin.math.floor(it) == it }
    private fun validGroup(value: ProviderValue): Boolean = value.isObject && isText(value["id"]) &&
        isText(value["label"]) && isStrings(value["members"]) &&
        listOf("known", "shuffleBefore").all { value[it].kind == ProviderValueKind.MISSING || isStrings(value[it]) } &&
        (value["inheritsMembers"].kind == ProviderValueKind.MISSING || value["inheritsMembers"].kind == ProviderValueKind.BOOLEAN)
    private fun validProvider(provider: List<ProviderValue>) = provider.all { it.isObject && isText(it["id"]) && isText(it["label"]) && isStrings(it["members"]) }
    private fun validState(state: ProviderValue): Boolean = state.isObject && state["version"].kind == ProviderValueKind.NUMBER &&
        state["version"].number() == 1.0 && isText(state["sourceId"]) && state["groups"].isArray &&
        state["groups"].elements.all(::validGroup) && listOf("hidden", "locks", "unlocks").all { isStrings(state[it]) } &&
        positiveInteger(state["nextGroup"]) && state["preferences"].isObject &&
        state["preferences"].properties.values.all { it.isObject && it.properties.values.all { v -> v.kind == ProviderValueKind.NUMBER && v.number().isFinite() } } &&
        (state["selected"].kind == ProviderValueKind.NULL || state["selected"].isObject && isText(state["selected"]["groupId"]) && isText(state["selected"]["itemId"])) &&
        (state["browsedGroup"].kind == ProviderValueKind.MISSING || isText(state["browsedGroup"]))

    /** Preserve the classic field order and the catalogue's original lock order. */
    fun empty(sourceId: String, catalogLocks: List<String>): ProviderValue = obj(linkedMapOf(
        "groups" to array(emptyList()), "hidden" to strings(emptyList()), "locks" to strings(catalogLocks),
        "nextGroup" to ProviderValue(ProviderValueKind.NUMBER, "1"), "preferences" to obj(emptyMap()),
        "selected" to ProviderValue.nil, "sourceId" to text(sourceId), "unlocks" to strings(emptyList()),
        "version" to ProviderValue(ProviderValueKind.NUMBER, "1")))

    /** Null rejects the persisted document; the host keeps its existing read-only fallback. */
    fun decode(value: ProviderValue, sourceId: String, catalogLocks: List<String>): ProviderValue? {
        if (!value.truthy() || value["version"].kind != ProviderValueKind.NUMBER || value["version"].number() != 1.0 ||
            !isText(value["sourceId"]) || value["sourceId"].scalar != sourceId || !value["groups"].isArray ||
            !value["hidden"].isArray || !value["locks"].isArray || !(value["preferences"].isObject || value["preferences"].isArray)) return null
        val result = fields(empty(sourceId, catalogLocks))
        if (isText(value["browsedGroup"]) && value["browsedGroup"].scalar.isNotEmpty()) result["browsedGroup"] = value["browsedGroup"]
        val seen = mutableSetOf<String>()
        result["groups"] = array(value["groups"].elements.mapNotNull { row ->
            if (!row.truthy() || !isText(row["id"]) || !isText(row["label"]) || !seen.add(row["id"].scalar)) null
            else obj(linkedMapOf("id" to row["id"], "inheritsMembers" to bool(trueValue(row["inheritsMembers"])),
                "known" to strings(unique(row["known"])), "label" to row["label"], "members" to strings(unique(row["members"])),
                "shuffleBefore" to if (row["shuffleBefore"].isArray) strings(unique(row["shuffleBefore"])) else ProviderValue.missing))
        })
        result["hidden"] = strings(unique(value["hidden"]))
        val unlocked = unique(value["unlocks"])
        result["unlocks"] = strings(unlocked)
        result["locks"] = strings(unique(array(value["locks"].elements + catalogLocks.map(::text)), unlocked))
        result["preferences"] = obj(listOf("aspect", "audio", "subtitle", "zoom").associateWith { kind ->
            obj(objectFields(value["preferences"][kind]).filterValues { it.kind == ProviderValueKind.NUMBER && it.number().isFinite() })
        })
        if (isText(value["selected"]["groupId"]) && isText(value["selected"]["itemId"])) result["selected"] = value["selected"]
        if (positiveInteger(value["nextGroup"])) result["nextGroup"] = value["nextGroup"]
        return obj(result)
    }

    /** Only the host's existing pure unresolved-ID mapping is called here. */
    fun groups(state: ProviderValue, provider: List<ProviderValue>, resolve: (String) -> String = { it }): ProviderValue {
        require(validState(state) && validProvider(provider)) { "Invalid classic channel library model" }
        val providerById = firstGroups(provider)
        val seen = mutableSetOf<String>(); val hidden = list(state["hidden"]).toSet()
        val result = state["groups"].elements.map { stored ->
            val id = stored["id"].scalar; seen += id
            val current = providerById[id]
            var members = stored["members"].elements
            if (current != null && trueValue(stored["inheritsMembers"])) members = current["members"].elements
            else if (current != null && stored["known"].kind != ProviderValueKind.MISSING) {
                val known = (list(stored["known"]) + members.map { it.scalar }).toSet()
                members += current["members"].elements.filter { it.scalar !in known }
            }
            obj(linkedMapOf("id" to stored["id"], "label" to if (current != null && stored["label"].scalar.isEmpty()) current["label"] else stored["label"],
                "members" to strings(members.map { resolve(it.scalar) })))
        }.toMutableList()
        provider.forEach { current ->
            val id = current["id"].scalar
            if (id !in hidden && seen.add(id)) result += obj(linkedMapOf("id" to current["id"], "label" to current["label"], "members" to current["members"]))
        }
        return array(result.filter { it["id"].scalar !in hidden })
    }

    /** Same exclusion/uniqueness rule used after progressive catalogue append. */
    fun addedLocks(locks: ProviderValue, added: ProviderValue, unlocks: ProviderValue): ProviderValue =
        strings(unique(array(locks.elements + added.elements), list(unlocks)))

    private fun validRequest(request: ProviderValue) = request.isObject && request["version"].kind == ProviderValueKind.NUMBER && request["version"].number() == API_VERSION.toDouble() && isText(request["action"])
    private fun label(request: ProviderValue) = CoreText.trim(request["label"].scalar)
    private fun nonempty(value: ProviderValue) = isText(value) && value.scalar.isNotEmpty()
    private fun numericDelta(request: ProviderValue) = request["delta"].kind == ProviderValueKind.MISSING || request["delta"].kind == ProviderValueKind.NUMBER
    private fun accepted(commit: Boolean = true, result: ProviderValue = bool(true)) = Decision(true, commit, result)

    /**
     * Whether this request needs the provider catalogue for admission or reduction.
     * A host may pass an empty provider list only when this returns false. The
     * remaining state, request and supplied provider are still strictly validated;
     * this query never authorizes a write. Unknown/future requests are conservative.
     * Keeping this policy here avoids re-encoding action dependencies in adapters.
     */
    fun needsProviderContext(request: ProviderValue): Boolean = !validRequest(request) ||
        request["action"].scalar !in listOf("lock", "select", "preference", "remove")

    /** The host supplies primitive String coercion, as for existing libraryEdit. */
    fun decision(state: ProviderValue, provider: List<ProviderValue>, request: ProviderValue,
                 resolve: (String) -> String = { it }, stringify: (ProviderValue) -> String): Decision =
        decide(state, provider, request, { groups(state, provider, resolve).elements }, stringify)

    private fun decide(state: ProviderValue, provider: List<ProviderValue>, request: ProviderValue,
                       visible: () -> List<ProviderValue>, stringify: (ProviderValue) -> String): Decision {
        val create = request["action"].scalar == "create"
        val refused = Decision(result = if (create) ProviderValue.nil else bool(false))
        if (!validState(state) || !validProvider(provider) || !validRequest(request)) return refused
        val action = request["action"].scalar; val id = request["groupId"].scalar
        return when (action) {
            "member" -> if (nonempty(request["itemId"]) && isText(request["groupId"]) && numericDelta(request) && request["memberAction"].scalar in listOf("add", "remove", "move")) accepted() else refused
            "create" -> if (!isText(request["label"]) || label(request).isEmpty() || visible().any { it["label"].scalar == label(request) }) refused
                else accepted(result = text("user:" + stringify(state["nextGroup"])))
            "lock" -> if (nonempty(request["itemId"])) accepted() else refused
            "move" -> if (!isText(request["groupId"]) || id.startsWith("system:") || !numericDelta(request) || visible().none { !it["id"].scalar.startsWith("system:") && it["id"].scalar == id }) refused else accepted()
            "remove" -> if (!isText(request["groupId"]) || id.startsWith("system:")) refused else accepted()
            "rename" -> if (!isText(request["groupId"]) || id.startsWith("system:") || !isText(request["label"]) || label(request).isEmpty() || visible().any { it["id"].scalar != id && it["label"].scalar == label(request) }) refused else accepted()
            "resetShuffle" -> if (!isText(request["groupId"]) || group(state["groups"].elements, id)?.get("shuffleBefore")?.isArray != true || group(visible(), id) == null) refused else accepted()
            "shuffle" -> if (!isText(request["groupId"]) || (group(visible(), id)?.get("members")?.elements?.size ?: 0) < 2) refused else accepted()
            "select" -> if (!isText(request["groupId"]) || !nonempty(request["itemId"])) refused else accepted(
                commit = state["selected"]["groupId"].scalar != id || state["selected"]["itemId"].scalar != request["itemId"].scalar)
            "browse" -> if (!isText(request["groupId"]) || id != "system:favorites" && group(visible(), id) == null) refused
                else accepted(commit = !isText(state["browsedGroup"]) || state["browsedGroup"].scalar != id || trueValue(request["durable"]))
            "preference" -> if (!nonempty(request["itemId"]) || request["kind"].scalar !in listOf("aspect", "audio", "subtitle", "zoom") ||
                request["value"].kind !in listOf(ProviderValueKind.MISSING, ProviderValueKind.NULL) && (request["value"].kind != ProviderValueKind.NUMBER || !request["value"].number().isFinite())) refused else accepted()
            "adoptOrder" -> {
                val all = live(provider, "system:all")?.get("members")?.elements ?: emptyList()
                if (!request["order"].isArray || request["order"].elements.size != all.size || request["order"].elements.indices.any { request["order"].elements[it].kind != all[it].kind || request["order"].elements[it].scalar != all[it].scalar }) refused else accepted()
            }
            else -> refused
        }
    }

    /** ECMAScript splice's finite/infinite/negative start conversion, after JS remainder. */
    private fun spliceIndex(value: Double, length: Int): Int {
        if (value.isNaN()) return 0
        if (value == Double.POSITIVE_INFINITY) return length
        if (value == Double.NEGATIVE_INFINITY) return 0
        val integer = if (value < 0) kotlin.math.ceil(value) else kotlin.math.floor(value)
        return if (integer < 0) (length + integer).coerceIn(0.0, length.toDouble()).toInt() else integer.coerceIn(0.0, length.toDouble()).toInt()
    }

    /** Returns a detached value graph at the JS ABI; input ProviderValue objects are never mutated. */
    fun reduce(state: ProviderValue, provider: List<ProviderValue>, request: ProviderValue,
               resolve: (String) -> String = { it }, random: () -> Double = { error("Shuffle requires the host random primitive") },
               stringify: (ProviderValue) -> String): ProviderValue {
        // One request-local projection is shared by admission and reduction. No
        // provider/state identity cache is retained across calls or source changes.
        val visible by lazy(LazyThreadSafetyMode.NONE) { groups(state, provider, resolve).elements }
        val decision = decide(state, provider, request, { visible }, stringify)
        require(decision.accepted) { "Rejected classic channel library action" }
        if (!decision.commit) return state
        val result = fields(state); var stored = state["groups"].elements.toMutableList()
        val id = request["groupId"].scalar
        fun edit(): LinkedHashMap<String, ProviderValue>? {
            val existing = group(stored, id)
            if (existing != null) return fields(existing)
            val current = group(visible, id) ?: return null
            val value = fields(current)
            if (live(provider, id) != null) value["label"] = text("")
            value["inheritsMembers"] = bool(live(provider, id) != null)
            return value
        }
        fun replaceGroup(value: Map<String, ProviderValue>) {
            val index = stored.indexOfFirst { it["id"].scalar == id }
            if (index < 0) stored += obj(value) else stored[index] = obj(value)
        }
        fun known(value: MutableMap<String, ProviderValue>) {
            value["known"] = strings(unique(array((value["known"]?.elements ?: emptyList()) + (live(provider, id)?.get("members")?.elements ?: emptyList()))))
        }
        when (request["action"].scalar) {
            "member" -> edit()?.let { value ->
                val members = (group(visible, id)?.get("members")?.elements ?: value.getValue("members").elements).toMutableList()
                value["inheritsMembers"] = bool(false); known(value)
                val item = request["itemId"]; val at = members.indexOfFirst { it.scalar == item.scalar }
                when (request["memberAction"].scalar) {
                    "add" -> if (at < 0) members += item
                    "remove" -> if (at >= 0) members.removeAt(at)
                    "move" -> if (at >= 0) {
                        members.removeAt(at)
                        val delta = request["delta"].takeIf { it.truthy() }?.number() ?: 0.0
                        val start = (at + delta + members.size + 1) % (members.size + 1)
                        members.add(spliceIndex(start, members.size), item)
                    }
                }
                value["members"] = array(members); replaceGroup(value)
            }
            "create" -> {
                val copied = if (isText(request["copyId"])) group(visible, request["copyId"].scalar)?.get("members") ?: strings(emptyList()) else strings(emptyList())
                stored += obj(linkedMapOf("id" to decision.result, "label" to text(label(request)), "members" to copied))
                result["nextGroup"] = number(state["nextGroup"].number() + 1)
            }
            "lock" -> {
                val item = request["itemId"].scalar
                val locks = list(state["locks"]).filter { it != item }.toMutableList()
                val unlocks = list(state["unlocks"]).filter { it != item }.toMutableList()
                if (request["locked"].truthy()) locks += item else unlocks += item
                result["locks"] = strings(locks); result["unlocks"] = strings(unlocks)
            }
            "move" -> {
                val ordered = visible.filter { !it["id"].scalar.startsWith("system:") }.toMutableList()
                val at = ordered.indexOfFirst { it["id"].scalar == id }; val moved = ordered.removeAt(at)
                val start = (at + request["delta"].number() + ordered.size + 1) % (ordered.size + 1)
                ordered.add(spliceIndex(start, ordered.size), moved)
                val storedById = firstGroups(stored)
                stored = ordered.map { row ->
                    val previous = storedById[row["id"].scalar]
                    obj(linkedMapOf("id" to row["id"], "inheritsMembers" to (previous?.get("inheritsMembers") ?: bool(true)),
                        "known" to (previous?.get("known") ?: ProviderValue.missing), "label" to (previous?.get("label") ?: text("")), "members" to row["members"]))
                }.toMutableList()
            }
            "remove" -> { stored = stored.filter { it["id"].scalar != id }.toMutableList(); result["hidden"] = strings(list(state["hidden"]) + id) }
            "rename" -> edit()?.let { value -> value["label"] = text(label(request)); replaceGroup(value) }
            "resetShuffle" -> {
                val previous = group(stored, id)!!
                val current = unique(group(visible, id)!!["members"])
                val currentIds = current.toSet()
                val restored = unique(strings(previous["shuffleBefore"].elements.map { resolve(it.scalar) })).filter { it in currentIds }
                val restoredIds = restored.toSet()
                val value = edit()!!; value["members"] = strings(restored + current.filter { it !in restoredIds })
                value.remove("shuffleBefore"); value["inheritsMembers"] = bool(false); known(value); replaceGroup(value)
            }
            "shuffle" -> {
                val members = group(visible, id)!!["members"].elements.toMutableList(); val value = edit()!!
                if (!value.containsKey("shuffleBefore") || value["shuffleBefore"]?.kind == ProviderValueKind.MISSING) value["shuffleBefore"] = array(members)
                for (index in members.lastIndex downTo 1) {
                    val sample = random(); require(sample.isFinite() && sample >= 0 && sample < 1) { "Invalid shuffle primitive" }
                    val selected = kotlin.math.floor(sample * (index + 1)).toInt(); val item = members[index]
                    members[index] = members[selected]; members[selected] = item
                }
                value["members"] = array(members); value["inheritsMembers"] = bool(false); known(value); replaceGroup(value)
            }
            "select" -> result["selected"] = obj(linkedMapOf("groupId" to request["groupId"], "itemId" to request["itemId"]))
            "browse" -> result["browsedGroup"] = request["groupId"]
            "preference" -> {
                val preferences = fields(state["preferences"]); val kind = request["kind"].scalar
                val values = fields(preferences[kind] ?: ProviderValue.missing)
                if (request["value"].kind in listOf(ProviderValueKind.MISSING, ProviderValueKind.NULL)) values.remove(request["itemId"].scalar)
                // The host commits a JSON-cloned classic document. Assignment of
                // a finite number to its inherited __proto__ accessor is ignored;
                // an own persisted field of that name remains an ordinary field.
                // Preserve this existing classic payload behavior rather than
                // changing it as an accidental consequence of a Map conversion.
                else if (request["itemId"].scalar != "__proto__" || values.containsKey("__proto__")) values[request["itemId"].scalar] = request["value"]
                preferences[kind] = obj(values); result["preferences"] = obj(preferences)
            }
            "adoptOrder" -> {
                val providerIds = provider.map { it["id"].scalar }.toSet()
                stored = stored.map { current ->
                    if (current["id"].scalar !in providerIds) current else {
                        val value = fields(current); value["inheritsMembers"] = bool(true); value["members"] = strings(emptyList())
                        value.remove("known"); value.remove("shuffleBefore"); obj(value)
                    }
                }.toMutableList()
                val all = live(provider, "system:all")?.get("members")?.elements ?: emptyList()
                result["selected"] = if (all.isEmpty()) ProviderValue.nil else obj(linkedMapOf("groupId" to text("system:all"), "itemId" to all[0]))
            }
        }
        result["groups"] = array(stored)
        return obj(result)
    }
}
