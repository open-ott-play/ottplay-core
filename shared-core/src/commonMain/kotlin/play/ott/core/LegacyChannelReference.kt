package play.ott.core

/** Import metadata only: never a channel's canonical identity or display label. */
sealed class LegacyChannelReference {
    data class Label(val value: String) : LegacyChannelReference()
    data class NumericId(val value: Double) : LegacyChannelReference()

    companion object {
        fun xtream(row: ProviderValue): LegacyChannelReference? =
            row["name"].takeIf { it.kind == ProviderValueKind.TEXT }?.let { Label(it.scalar) }

        fun stalker(row: ProviderValue): LegacyChannelReference? {
            val name = row["name"]
            if (name.kind != ProviderValueKind.TEXT || !name.truthy()) return null
            // The old JSON-RPC catalog selected row.id, never its ch_id fallback.
            val id = row["id"]
            if (!id.truthy()) return Label(name.scalar)
            return id.number().takeIf { it.isFinite() }?.let { NumericId(it) }
        }
    }
}
