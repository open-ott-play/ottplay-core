import play.ott.core.*

internal fun channelCatalogRows(rows: List<CatalogChannel>): dynamic = rows.map { value ->
    val row: dynamic = js("({})")
    row.itemId = value.itemId; row.providerId = value.providerId; row.name = value.name
    row.groupId = value.groupId; row.groupName = value.groupName; row.logo = value.logo; row.url = value.url
    row.archiveHours = value.archiveHours; row.archiveMode = value.archiveMode
    value.legacyReference?.let { reference ->
        val legacy: dynamic = js("({})")
        when (reference) {
            is LegacyChannelReference.Label -> { legacy.kind = "name-hash"; legacy.value = reference.value }
            is LegacyChannelReference.NumericId -> { legacy.kind = "numeric-id"; legacy.value = reference.value }
        }
        row.legacyReference = legacy
    }
    row
}.toTypedArray()
