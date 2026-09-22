@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

private fun durableText(value: dynamic): String = js("String(value)").unsafeCast<String>()
private fun durableTruthy(value: dynamic): Boolean = js("Boolean(value)").unsafeCast<Boolean>()
private fun durableOwn(value: dynamic, key: dynamic): Boolean = js("Object.prototype.hasOwnProperty.call(value,key)").unsafeCast<Boolean>()
private fun durableKeys(value: dynamic): Array<String> = js("Object.keys(value)").unsafeCast<Array<String>>()
private fun durableTrim(value: dynamic): String = js("(value || '').trim()").unsafeCast<String>()

@JsExport
fun favoriteListName(value: dynamic): String {
    val name = js("String(value || '').replace(/^\\s+|\\s+$/g, '')").unsafeCast<String>()
    if (!DurableSelections.safeListName(name)) throw js("new Error('Invalid name')")
    return name
}

@JsExport
fun favoriteListChange(state: dynamic, profile: String, operation: String, inputName: dynamic, inputReplacement: dynamic): dynamic {
    val browser = profile == "browser"
    val lists = if (browser) state.favorites else state.lists
    val order: dynamic = if (browser) js("[]") else state.order
    val name = if (operation == "add") durableTrim(inputName) else durableText(inputName)
    val replacement = if (operation == "rename") {
        if (browser) js("String(inputReplacement || '').replace(/^\\s+|\\s+$/g, '')").unsafeCast<String>() else durableTrim(inputReplacement)
    } else ""
    val sourceExists = if (browser) durableOwn(lists, inputName) else durableTruthy(lists[name])
    val targetExists = if (browser) durableOwn(lists, replacement) else durableTruthy(lists[replacement])
    val orderValues = order.unsafeCast<Array<dynamic>>()
    val currentActive: dynamic = if (browser) state.activeFavorites else state.active
    val activeMatches = js("currentActive === inputName").unsafeCast<Boolean>()
    val orderName: dynamic = if (operation == "add") name else inputName
    val slot = order.indexOf(orderName).unsafeCast<Int>()
    val plan = FavoriteLists.change(if (browser) FavoriteListProfile.BROWSER else FavoriteListProfile.CLASSIC,
        operation, name, replacement, sourceExists, targetExists, durableKeys(lists).size,
        activeMatches, slot, orderValues.map(::durableTruthy))
    val message = plan.error
    if (message != null) throw js("new Error(message)")
    if (plan.accepted) {
        if (plan.activeOrderAt >= 0) state.active = order[plan.activeOrderAt]
        when (plan.write) {
            "empty" -> lists[name] = js("[]")
            "copy" -> lists[replacement] = lists[inputName].slice()
            "alias" -> lists[replacement] = lists[inputName]
        }
        if (plan.eraseOld) js("delete lists[inputName]")
        if (plan.clearOld) lists[inputName] = js("[]")
        if (plan.appendOrder) order.push(name)
        if (plan.replaceOrderAt >= 0) order[plan.replaceOrderAt] = replacement
        if (plan.removeOrderAt >= 0) order.splice(plan.removeOrderAt, 1)
        if (plan.active != null) {
            if (browser) state.activeFavorites = plan.active else state.active = if (operation == "activate") inputName else plan.active
        }
    }
    val result: dynamic = js("({})")
    result.accepted = plan.accepted; result.synchronize = plan.synchronize
    return result
}

@JsExport
fun favoriteListOrder(lists: dynamic, order: Array<dynamic>): Array<dynamic> {
    val keys = durableKeys(lists)
    val candidates = order.toList() + keys.toList()
    val names = candidates.map(::durableText)
    val available = candidates.mapIndexed { index, name -> index >= order.size || durableTruthy(lists[name]) }
    val initiallySeen = names.filter { name -> js("Boolean(({})[name])").unsafeCast<Boolean>() }.toSet()
    return DurableSelections.listOrder(names, available, initiallySeen).map { candidates[it] }.toTypedArray()
}

@JsExport
fun moveFavoriteSelection(items: dynamic, id: dynamic, delta: dynamic) {
    val from = items.indexOf(id).unsafeCast<Int>()
    // Preserve the JS + and splice coercions used by this browser API.
    val to: dynamic = js("from + delta")
    if (DurableSelections.movedIndex(items.length.unsafeCast<Int>(), from, js("Number(to) - from").unsafeCast<Double>()) == null) return
    items.splice(from, 1); items.splice(to, 0, id)
}

@JsExport
fun favoriteListCurrent(state: dynamic): dynamic {
    favoriteListChange(state, "classic", "ensure", state.active, null)
    return state.lists[state.active]
}

@JsExport
fun loadClassicFavoriteLists(raw: dynamic, prior: dynamic): dynamic {
    val result: dynamic = js("({v:1})")
    if (raw != null && js("raw.v === 1").unsafeCast<Boolean>() && durableTruthy(raw.lists) && jsTypeOf(raw.lists) == "object") {
        val keys = durableKeys(raw.lists)
        val choice = FavoriteLists.loadActive(durableTruthy(raw.active), durableTruthy(raw.lists[raw.active]), keys.isNotEmpty())
        result.active = when (choice) { 0 -> raw.active; 1 -> keys[0]; else -> "Favorites" }
        result.lists = raw.lists
        result.order = if (js("Array.isArray(raw.order)").unsafeCast<Boolean>()) raw.order else keys
    } else {
        result.active = "Favorites"; result.lists = js("({Favorites:prior.slice()})"); result.order = js("['Favorites']")
    }
    return result
}


@JsExport
fun editFavoriteSelection(items: dynamic, id: dynamic, operation: String): Boolean {
    val index = DurableSelections.editSelection(items.indexOf(id).unsafeCast<Int>(), operation)
    if (index == -2) items.push(id) else if (index >= 0) items.splice(index, 1)
    return index == -2
}
