import play.ott.core.*

internal fun channelCatalogRows(rows: List<CatalogChannel>): dynamic = rows.map { value ->
    val row: dynamic = js("({})")
    row.itemId = value.itemId; row.providerId = value.providerId; row.name = value.name
    row.groupId = value.groupId; row.groupName = value.groupName; row.logo = value.logo; row.url = value.url
    row.archiveHours = value.archiveHours; row.archiveMode = value.archiveMode
    row
}.toTypedArray()
