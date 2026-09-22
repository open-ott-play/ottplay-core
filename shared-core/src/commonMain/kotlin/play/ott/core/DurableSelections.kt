package play.ott.core

/** Persisted selection policy. Storage, payloads and list aliasing stay in the host. */
object DurableSelections {
    fun toggle(ids: Set<String>, id: String): Set<String> = if (id in ids) ids - id else ids + id

    fun mergeFavorites(old: Set<String>, incoming: Set<String>): Set<String> =
        (old + incoming).toList().takeLast(10_000).toSet()

    fun mergeResume(old: Map<String, Long>, incoming: Map<String, Long>): Map<String, Long> {
        val result = LinkedHashMap(old)
        incoming.forEach { (id, value) -> result.remove(id); result[id] = value }
        while (result.size > 500) result.remove(result.keys.first())
        return result
    }

    fun saveResume(old: Map<String, Long>, id: String, position: Long): Map<String, Long> {
        val value = position.coerceAtLeast(0)
        if (old[id] == value) return old
        return mergeResume(old, mapOf(id to value))
    }

    fun validateBackup(selected: String?, favorites: Set<String>, positions: Map<String, Long>) {
        fun validId(id: String) = id.isNotBlank() && id.length <= 512 && id.none { it.code < 32 }
        require(selected == null || validId(selected)) { "Invalid selected source" }
        require(favorites.size <= 10_000 && favorites.all(::validId)) { "Invalid favorites" }
        require(positions.size <= 500 && positions.all { (id, value) -> validId(id) && value >= 0 }) { "Invalid playback positions" }
    }

    fun selectedSource(imported: String?, previous: String?, available: Set<String>): String? =
        imported?.takeIf { it in available } ?: previous

    fun safeListName(value: String): Boolean = value.isNotEmpty() && value.length < 160 &&
        value !in setOf("__proto__", "constructor", "prototype")

    fun listOrder(keys: List<String>, available: List<Boolean>, initiallySeen: Set<String>): List<Int> {
        val seen = initiallySeen.toMutableSet()
        return keys.indices.filter { index -> available[index] && seen.add(keys[index]) }
    }

    fun editSelection(index: Int, operation: String): Int = when (operation) {
        "add" -> if (index < 0) -2 else -1
        "remove" -> index
        "toggle" -> if (index < 0) -2 else index
        else -> error("Unsupported selection operation")
    }

    fun movedIndex(size: Int, from: Int, delta: Double): Double? {
        val to = from + delta
        return if (from < 0 || to < 0 || to >= size) null else to
    }
}

enum class FavoriteListProfile { CLASSIC, BROWSER }

data class FavoriteListChange(
    val accepted: Boolean = false,
    val error: String? = null,
    val write: String = "",
    val eraseOld: Boolean = false,
    val clearOld: Boolean = false,
    val appendOrder: Boolean = false,
    val replaceOrderAt: Int = -1,
    val removeOrderAt: Int = -1,
    val active: String? = null,
    val activeOrderAt: Int = -1,
    val synchronize: Boolean = false,
)

/** Existing callers supply host property-presence and truthiness, including classic inherited keys. */
object FavoriteLists {
    fun loadActive(preferred: Boolean, available: Boolean, hasFirst: Boolean): Int =
        if (preferred && available) 0 else if (hasFirst) 1 else 2

    fun change(profile: FavoriteListProfile, operation: String, name: String, replacement: String,
               sourceExists: Boolean, targetExists: Boolean, ownCount: Int, activeMatches: Boolean,
               slot: Int, orderTruthy: List<Boolean>): FavoriteListChange {
        val browser = profile == FavoriteListProfile.BROWSER
        return when (operation) {
            "ensure" -> if (sourceExists) FavoriteListChange() else FavoriteListChange(true, write = "empty")
            "activate" -> if (sourceExists) FavoriteListChange(true, active = name, synchronize = true) else FavoriteListChange()
            "add" -> if (browser) {
                if (!DurableSelections.safeListName(name)) FavoriteListChange(error = "Invalid name")
                else FavoriteListChange(true, write = if (sourceExists) "" else "empty", active = name)
            } else if (name.isEmpty() || sourceExists) FavoriteListChange()
                else FavoriteListChange(true, write = "empty", appendOrder = slot < 0)
            "rename" -> {
                if (browser && !DurableSelections.safeListName(replacement)) return FavoriteListChange(error = "Invalid name")
                if (browser && !sourceExists) return FavoriteListChange(error = "Unknown list")
                if (replacement == name) return FavoriteListChange()
                if (browser && targetExists) return FavoriteListChange(error = "List already exists")
                if (!browser && (replacement.isEmpty() || !sourceExists || targetExists)) return FavoriteListChange()
                FavoriteListChange(true, write = if (browser) "copy" else "alias", eraseOld = !browser || name != "default",
                    clearOld = browser && name == "default", replaceOrderAt = if (browser) -1 else slot,
                    active = if (browser || activeMatches) replacement else null, synchronize = !browser)
            }
            "delete" -> {
                if (!browser && (!sourceExists || ownCount <= 1)) return FavoriteListChange()
                val fallbackSlot = if (slot == 0) 1 else 0
                val choosesOrder = !browser && activeMatches && fallbackSlot < orderTruthy.size && orderTruthy[fallbackSlot]
                FavoriteListChange(true, eraseOld = !browser || name != "default", clearOld = browser && name == "default",
                    removeOrderAt = if (browser) -1 else slot,
                    active = if (!activeMatches || choosesOrder) null else if (browser) "default" else "Favorites",
                    activeOrderAt = if (choosesOrder) fallbackSlot else -1, synchronize = !browser)
            }
            else -> error("Unsupported favorites operation")
        }
    }
}
