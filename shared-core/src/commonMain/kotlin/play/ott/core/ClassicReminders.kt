package play.ott.core

/** Classic programme reminder v1 policy. Clocks, resolution, storage and prompt ownership stay with the host. */
object ClassicReminders {
    private fun text(value: ProviderValue) = value.kind == ProviderValueKind.TEXT
    private fun finiteNumber(value: ProviderValue) = value.kind == ProviderValueKind.NUMBER && value.number().isFinite()

    fun valid(record: ProviderValue, source: String): Boolean =
        text(record["sourceId"]) && record["sourceId"].scalar == source &&
            listOf("id", "channelId", "programmeId").all { text(record[it]) && record[it].scalar.isNotEmpty() } &&
            text(record["title"]) && finiteNumber(record["start"]) && finiteNumber(record["end"]) &&
            record["end"].number() > record["start"].number()

    /** Indices retain the first valid occurrence and let the host clone opaque payloads in its own format. */
    fun normalizedIndices(records: List<ProviderValue>, source: String): List<Int> {
        val seen = mutableSetOf<String>()
        return records.indices.filter { valid(records[it], source) && seen.add(records[it]["id"].scalar) }
    }

    fun next(start: Double, end: Double, now: Double, lead: Double, prompted: Boolean, notified: Boolean): Double {
        if (!now.isFinite() || end <= now) return Double.POSITIVE_INFINITY
        var next = if (prompted) Double.POSITIVE_INFINITY else start
        if (lead != 0.0 && !notified && start > now) next = minOf(next, maxOf(now, start - lead))
        return next
    }

    /** Host must recheck current record, source generation and resolution before applying this decision. */
    fun action(start: Double, end: Double, now: Double, lead: Double, prompted: Boolean, notified: Boolean): String = when {
        end <= now -> "none"
        start > now -> if (lead != 0.0 && start - lead <= now && !notified) "notify" else "none"
        prompted -> "none"
        else -> "prompt"
    }

    fun minutes(start: Double, now: Double): Double = maxOf(0.0, kotlin.math.ceil((start - now) / 60.0))
}
