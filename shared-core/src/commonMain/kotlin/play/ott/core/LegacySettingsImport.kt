package play.ott.core

data class ImportedSource(val type: String, val url: String, val name: String = "", val username: String = "", val password: String = "", val mac: String = "", val days: Double = 0.0, val nameKey: String = "", val args: List<String> = emptyList(), val identity: List<String> = emptyList())
data class ImportMessage(val key: String, val args: List<String> = emptyList())
data class NativeLegacyImport(val sources: List<ImportedSource>, val messages: List<ImportMessage>)

/** Explicit legacy-import profiles. JSON/XML parsing and platform URL canonicalization stay in the host. */
object LegacySettingsImport {
    private fun text(value: String) = ProviderValue.text(value)
    private fun obj(value: Map<String, ProviderValue>) = ProviderValue.obj(value)
    private fun array(value: List<ProviderValue>) = ProviderValue.array(value)
    private fun fail(message: String): Nothing = throw DurableStateFailure(message)
    private fun primitive(value: ProviderValue) = if (value.kind in listOf(ProviderValueKind.TEXT, ProviderValueKind.NUMBER, ProviderValueKind.BOOLEAN)) value.scalar else ""
    private fun androidTrim(value: String) = CoreText.trim(value, CoreText::androidSpace)
    private fun blank(value: String) = androidTrim(value).isEmpty()
    private fun asObject(value: ProviderValue, parse: (String) -> ProviderValue): ProviderValue? = when {
        value.isObject -> value
        value.kind == ProviderValueKind.TEXT -> try { parse(value.scalar).takeIf { it.isObject } } catch (_: Throwable) { null }
        else -> null
    }
    fun native(rootValue: ProviderValue, parse: (String) -> ProviderValue, http: (String) -> String?, path: (String) -> String): NativeLegacyImport {
        val root = asObject(rootValue, parse) ?: fail("Legacy settings must be a JSON object")
        val containers = listOf(root) + listOf("localStorage", "storage", "values").mapNotNull { asObject(root[it], parse) }
        fun find(vararg names: String): ProviderValue? = containers.firstNotNullOfOrNull { row -> names.firstNotNullOfOrNull { asObject(row[it], parse) } }
        val messages = mutableListOf<ImportMessage>(); val sources = mutableListOf<ImportedSource>()
        fun field(value: ProviderValue, key: String) = primitive(value[key])
        val m3u = find("m3um3uArr", "m3uArr") ?: root.takeIf { it["M3Us"].isArray }
        m3u?.get("M3Us")?.elements?.filter { it.isObject }?.forEachIndexed { index, slot ->
            val args = listOf((index + 1).toString()); val url = androidTrim(field(slot, "www"))
            if (!blank(url)) {
                val canonical = http(url)
                if (canonical == null) messages += ImportMessage("LEGACY_PLAYLIST_UNSUPPORTED", args)
                else {
                    val name = field(slot, "name"); val hours = field(slot, "rechours").toDoubleOrNull() ?: 0.0
                    sources += ImportedSource("M3U", canonical, name, days = if (hours.isFinite() && hours in 0.0..87600.0) hours / 24 else 0.0,
                        nameKey = if (blank(name)) "IMPORTED_PLAYLIST" else "", args = if (blank(name)) args else emptyList(), identity = listOf("legacy", "m3u", canonical))
                }
            }
            if (!blank(field(slot, "medUrl"))) messages += ImportMessage("LEGACY_LIBRARY_SKIPPED", args)
        }
        find("xtreamxtream_data", "xtream_data")?.let { row ->
            val url = http(androidTrim(field(row, "server"))); val user = field(row, "username"); val password = field(row, "password")
            if (url != null && !blank(user) && !blank(password)) sources += ImportedSource("XTREAM", url, username = user, password = password, nameKey = "IMPORTED_XTREAM", identity = listOf("legacy", "xtream", url, user))
            else messages += ImportMessage("LEGACY_XTREAM_INVALID")
        }
        find("stalkerstalker_data", "stalker_data")?.let { row ->
            val portal = http(androidTrim(field(row, "portal"))); val mac = androidTrim(field(row, "mac")); val parts = mac.split(':')
            val valid = parts.size == 6 && parts.all { it.length == 2 && it.all { c -> c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F' } }
            if (portal != null && valid) {
                val url = if (path(portal).trimEnd('/').endsWith("/api")) portal else portal.trimEnd('/') + "/stalker_portal/api/"
                sources += ImportedSource("STALKER", url, mac = mac, nameKey = "IMPORTED_STALKER", identity = listOf("legacy", "stalker", portal, mac.lowercase()))
            } else messages += ImportMessage("LEGACY_STALKER_INVALID")
        }
        if (sources.isEmpty()) messages += ImportMessage(if (root["settings"].isObject && field(root, "version") == "1") "LEGACY_BACKUP_WITHOUT_SOURCES" else "LEGACY_NO_SOURCES")
        if ("favoritesArray" in root.properties || "parentalArray" in root.properties) messages += ImportMessage("LEGACY_FAVORITES_SKIPPED")
        return NativeLegacyImport(sources, messages.distinct())
    }

    fun browser(incoming: ProviderValue, xml: Boolean, defaults: () -> ProviderValue, validate: (ProviderValue) -> ProviderValue,
                parse: (String) -> ProviderValue, http: (ProviderValue) -> String): ProviderValue {
        var proposed = defaults(); var fields = LinkedHashMap(proposed.properties); var settings = LinkedHashMap(proposed["settings"].properties)
        val warnings = mutableListOf<String>(); var format: String; var legacy = false; var recognized = 0; var parental = false
        val sources = mutableListOf<ProviderValue>(); val legacySources = linkedMapOf<String, String>()
        fun warn(message: String) { if (message !in warnings) warnings += message }
        fun language(value: ProviderValue) {
            if (value.kind == ProviderValueKind.TEXT && value.scalar in listOf("ru", "_rus")) settings["language"] = text("ru")
            else if (value.kind == ProviderValueKind.TEXT && value.scalar in listOf("en", "_eng")) settings["language"] = text("en")
            else if (value.truthy()) warn("This language is not available yet; English will be used.")
        }
        fun font(value: ProviderValue) {
            val index = when { value.kind == ProviderValueKind.NUMBER -> value.number(); value.kind == ProviderValueKind.TEXT && value.scalar.length == 1 && value.scalar[0] in '0'..'6' -> value.number(); else -> Double.NaN }
            if (index.isFinite() && index % 1 == 0.0 && index >= 0 && index < BrowserDurableState.fonts.size) settings["fontFamily"] = text(BrowserDurableState.fonts[index.toInt()])
            else if (value.kind != ProviderValueKind.MISSING) warn("An unknown legacy font was replaced with the system font.")
        }
        fun embedded(value: ProviderValue, label: String): ProviderValue {
            if (value.kind == ProviderValueKind.TEXT && value.scalar.startsWith("\u0001LZ\u0001")) { warn("Compressed legacy $label was skipped; export it as JSON in the old player first."); return ProviderValue.nil }
            return if (value.kind == ProviderValueKind.TEXT) parse(value.scalar) else value
        }
        fun addSource(type: String, value: ProviderValue, name: ProviderValue, user: ProviderValue, password: ProviderValue, suffix: Int) {
            val url = http(value)
            if (url.isEmpty()) { warn("A source with an unsupported or invalid URL was skipped."); return }
            if (sources.size >= 100) fail("Too many sources in legacy export")
            val id = "legacy-$type-$suffix"
            sources += obj(linkedMapOf("id" to text(id), "name" to text(if (name.kind == ProviderValueKind.TEXT && name.truthy()) name.scalar.take(160) else type.uppercase() + " " + (sources.size + 1)),
                "type" to text(type), "url" to text(url), "text" to text(""), "username" to text(if (user.kind == ProviderValueKind.TEXT) user.scalar else ""), "password" to text(if (password.kind == ProviderValueKind.TEXT) password.scalar else ""), "mac" to text("")))
            legacySources["$$type$suffix"] = id
        }
        fun oldIds(raw: ProviderValue, protected: Boolean) {
            val value = embedded(raw, if (protected) "parental selections" else "favorites")
            if (value.kind == ProviderValueKind.NULL) return
            if (!value.isArray) fail("Invalid legacy channel selections")
            if (value.elements.size > 50000) fail("Too many legacy channel selections")
            if (value.elements.isNotEmpty()) { if (protected) parental = true; warn(if (protected) "Legacy protected-channel IDs cannot be matched safely. Set a new PIN and review protected channels before playback." else "Legacy favorite IDs are provider-specific and were not guessed. Re-select favorites after loading the source.") }
        }
        fun m3u(raw: ProviderValue) {
            val value = embedded(raw, "M3U sources"); if (value.kind == ProviderValueKind.NULL) return
            if (!value.isObject || !value["M3Us"].isArray) fail("Invalid legacy M3U settings")
            if (value["M3Us"].elements.size > 100) fail("Too many legacy M3U sources")
            value["M3Us"].elements.forEachIndexed { index, row ->
                if (!row.isObject) fail("Invalid legacy M3U source")
                if (row["www"].truthy()) addSource("m3u", row["www"], row["name"], text(""), text(""), index)
                if (row["rechours"].truthy() || row["medUrl"].truthy()) warn("Legacy archive-hour overrides and VPortal links need manual review and were not imported.")
            }
            legacySources["$" + "m3u" + value["active"].string()]?.let { fields["activeSourceId"] = text(it) }
        }
        fun xtream(raw: ProviderValue) {
            val value = embedded(raw, "Xtream source"); if (value.kind == ProviderValueKind.NULL) return
            if (!value.isObject) fail("Invalid legacy Xtream settings")
            if (value["server"].truthy()) addSource("xtream", value["server"], text("Xtream"), value["username"], value["password"], 0)
        }
        fun selectionKey(key: String, name: String): Boolean {
            val without = if (key.startsWith("m3u")) key.drop(3) else if (key.startsWith("xtream")) key.drop(6) else key
            return without.startsWith(name) && without.drop(name.length).all { it in '0'..'9' }
        }
        if (!incoming.isObject) fail("Unsupported settings format")
        if ("schema" in incoming.properties) { proposed = validate(incoming); format = "ottplay-foss2-v1" }
        else if (incoming["version"].kind == ProviderValueKind.NUMBER && incoming["version"].number() == 1.0 && incoming["settings"].isObject) {
            format = "ottplay-foss-v1"; legacy = true; val old = incoming["settings"]
            font(old["fontSize"]); language(old["language"])
            if (incoming["favoritesArray"].kind != ProviderValueKind.MISSING) oldIds(incoming["favoritesArray"], false)
            if (incoming["parentalArray"].kind != ProviderValueKind.MISSING) oldIds(incoming["parentalArray"], true)
            if (old["parentPin"].truthy()) warn("The old plaintext parental PIN was omitted. Set a new PIN in Parental controls.")
            warn("The old JSON export contains no provider source credentials. Add your source separately.")
            warn("Only preferences with an exact new equivalent were migrated; old key bindings and device-specific options were omitted.")
            proposed = obj(fields + ("settings" to obj(settings)))
        } else {
            if ("version" in incoming.properties) fail("Unsupported legacy settings envelope")
            format = if (xml) "ottplay-properties-xml" else "ottplay-storage-json"; legacy = true
            incoming.properties.forEach { (key, value) -> when {
                key == "ottplaylang" -> { language(value); recognized++ }
                key == "sFont" -> { font(value); recognized++ }
                key == "m3um3uArr" -> { m3u(value); recognized++ }
                key == "xtreamxtream_data" -> { xtream(value); recognized++ }
                selectionKey(key, "favoritesArray") -> { oldIds(value, false); recognized++ }
                selectionKey(key, "parentalArray") -> { oldIds(value, true); recognized++ }
                key == "parentPIN" -> { warn("The old plaintext parental PIN was omitted. Set a new PIN in Parental controls."); recognized++ }
                key == "ottplayprov" -> recognized++
            } }
            if (recognized == 0) fail("No recognized OTT-Play settings were found")
            if (incoming["ottplayprov"].kind == ProviderValueKind.TEXT && incoming["ottplayprov"].scalar == "xtream") legacySources["\$xtream0"]?.let { fields["activeSourceId"] = text(it) }
            warn("Unknown legacy storage keys, local-server access settings and device credentials were omitted.")
            proposed = validate(obj(fields + mapOf("sources" to array(sources), "settings" to obj(settings))))
        }
        val secrets = proposed["sources"].elements.isNotEmpty() || proposed["settings"]["epgUrl"].truthy() || proposed["settings"]["epgUrls"].elements.isNotEmpty()
        if (secrets) warn("Source URLs and provider credentials are included. Confirm before replacing local settings.")
        if (legacy) warn("Migration is a preview. Existing settings are unchanged until you confirm the import.")
        fun bool(value: Boolean) = ProviderValue(ProviderValueKind.BOOLEAN, value.toString())
        return obj(linkedMapOf("format" to text(format), "proposed" to proposed, "warnings" to array(warnings.map(::text)), "containsSecrets" to bool(secrets), "requiresSourceConfirmation" to bool(secrets), "requiresParentalReview" to bool(parental), "legacy" to bool(legacy), "summary" to obj(mapOf("sources" to ProviderValue(ProviderValueKind.NUMBER, proposed["sources"].elements.size.toString()), "language" to proposed["settings"]["language"], "fontFamily" to proposed["settings"]["fontFamily"]))))
    }
}
