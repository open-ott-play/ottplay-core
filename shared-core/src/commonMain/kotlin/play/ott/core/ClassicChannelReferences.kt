package play.ott.core

/** A renderer/storage numeric reference, before or after import into the current catalog. */
data class ClassicChannelReference(
    val itemId: String? = null,
    val legacyId: ProviderValue? = null,
    val origin: String? = null,
    val ambiguous: Boolean = false,
)

/** [key] and list order must match the host's Object.keys order. A null itemId uses the legacy fallback. */
data class ClassicChannelReferenceRow(
    val key: String,
    val itemId: String? = null,
    val legacyId: ProviderValue = ProviderValue.missing,
)

/** Shared preguard for hosts that must reject invalid keys before reading a catalog row. */
fun classicChannelReferenceNumberKey(value: ProviderValue, canonicalNumber: (String) -> String?): String? {
    if (value.kind != ProviderValueKind.NUMBER && value.kind != ProviderValueKind.TEXT) return null
    val numeric = value.kind == ProviderValueKind.NUMBER
    val raw = if (numeric) canonicalNumber(value.scalar) ?: return null else value.scalar
    val start = if (raw.startsWith('-')) 1 else 0
    if (start == raw.length || raw.substring(start).any { it !in '0'..'9' }) return null
    return if (numeric) raw else canonicalNumber(raw)
}

/**
 * The classic numeric alias graph. It never guesses between identities or breaks alias cycles.
 *
 * [canonicalNumber] is deliberately a host primitive: return ECMAScript String(Number(value)),
 * or null for a non-finite result. NUMBER scalars pass through it before the integer grammar;
 * TEXT scalars are checked first, preserving their distinct import rules. Java/Kotlin Double
 * formatting is NOT an interchangeable default (large integers and exponent notation differ).
 * JS uses its own Number/String primitives; JVM callers supply their storage format's codec.
 */
class ClassicChannelReferences(
    rows: List<ClassicChannelReferenceRow>,
    aliases: List<Pair<String, ProviderValue>> = emptyList(),
    private val canonicalNumber: (String) -> String?,
) {
    private val numbers = mutableMapOf<String, String>()
    private val items = mutableMapOf<String, Double?>()
    private val edges = mutableMapOf<String, MutableList<String>>()
    private val uncertain = mutableSetOf<String>()

    init {
        rows.forEach { row ->
            val number = numberKey(ProviderValue.text(row.key)) ?: return@forEach
            val item = row.itemId ?: "channel:$number"
            numbers[number] = item
            val numeric = number.toDouble()
            items[item] = if (!items.containsKey(item) || items[item] == numeric) numeric else null
            if (row.legacyId.kind != ProviderValueKind.MISSING) {
                // Revalidate the normalized number: String(1e21) is not a decimal-integer key.
                edge(row.legacyId, ProviderValue.text(number))
            }
        }
        aliases.forEach { (before, after) -> edge(ProviderValue.text(before), after) }
    }

    private fun numberKey(value: ProviderValue): String? {
        return classicChannelReferenceNumberKey(value, canonicalNumber)
    }

    private fun edge(before: ProviderValue, after: ProviderValue) {
        val key = numberKey(before) ?: return
        val target = numberKey(after)
        if (target == null) { uncertain.add(key); return }
        val next = edges.getOrPut(key) { mutableListOf() }
        if (target !in next) next.add(target)
    }

    fun project(reference: ClassicChannelReference?): Double? = reference?.itemId?.let { items[it] }

    fun resolve(value: ProviderValue, origin: String = "raw"): ClassicChannelReference {
        val pending = ClassicChannelReference(legacyId = value, origin = origin)
        val key = numberKey(value) ?: return pending
        if (origin == "canonical") return numbers[key]?.let { ClassicChannelReference(itemId = it) } ?: pending
        val candidates = mutableSetOf<String>()
        val visited = mutableMapOf<String, Int>()
        var ambiguous = false

        fun visit(at: String) {
            when (visited[at]) { 1 -> { ambiguous = true; return }; 2 -> return }
            visited[at] = 1
            numbers[at]?.let { candidates.add(it) }
            if (at in uncertain) ambiguous = true
            edges[at]?.forEach { next ->
                if (next == at) { if (!numbers.containsKey(at)) ambiguous = true } else visit(next)
            }
            visited[at] = 2
        }

        visit(key)
        return if (candidates.size == 1 && !ambiguous) ClassicChannelReference(itemId = candidates.first())
        else pending.copy(ambiguous = candidates.size > 1 || ambiguous)
    }
}
