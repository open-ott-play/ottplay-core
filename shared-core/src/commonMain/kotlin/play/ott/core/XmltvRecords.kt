package play.ott.core

enum class XmltvRecordFormat { SWIFT, ARCHIVED_ANDROID, ANDROID, RUST, RUST_NATIVE }

object NativeRecordRules {
    /** A permutation keeps host payloads native and preserves equal-start input order. */
    fun order(starts: List<Double>, format: XmltvRecordFormat): List<Int> =
        if (format == XmltvRecordFormat.RUST || format == XmltvRecordFormat.ANDROID) starts.indices.toList()
        else starts.indices.sortedBy { starts[it] }
}

/** Interprets decoded XML events, not XML bytes. Hosts retain parsing/security limits and payloads.
 * Output rows describe native collection writes; drains release them after each bounded input batch.
 * Host trim/equality primitives preserve Foundation and Rust Unicode contracts across the JS bridge.
 */
class XmltvRecords(
    private val format: XmltvRecordFormat,
    private val trim: (String) -> String = { it.trim() },
    private val identity: (String) -> String = { it },
) {
    private val rust = format == XmltvRecordFormat.RUST || format == XmltvRecordFormat.RUST_NATIVE
    private val android = format == XmltvRecordFormat.ANDROID
    private val clock = NativeGuideClock(when (format) {
        XmltvRecordFormat.SWIFT -> NativeGuideFormat.SWIFT
        XmltvRecordFormat.ARCHIVED_ANDROID -> NativeGuideFormat.ARCHIVED_ANDROID
        else -> NativeGuideFormat.RUST
    })
    private val knownChannels = mutableSetOf<String>()
    private var channel: String? = null
    private var channelName = ""
    private var channelIcon = ""
    private var aliases = mutableListOf<String>()
    private var programme: String? = null
    private data class Time(val epoch: Long?, val encoded: String)
    private var from: Time? = null
    private var to: Time? = null
    // Repeated programme boundaries must not repeatedly format emulated JS Longs.
    // A ring bounds both encoded values and retained input strings, as the guide clock does.
    private val encodedTimes = mutableMapOf<String, Time>()
    private val encodedKeys = arrayOfNulls<String>(4096)
    private var encodedCursor = 0
    private val title = StringBuilder()
    private val description = StringBuilder()
    private var programmeIcon = ""
    private var field: String? = null
    private val text = StringBuilder()
    private var actions = mutableListOf<List<String>>()
    private var failed = false

    private fun time(value: String): Time {
        encodedTimes[value]?.let { return it }
        val epoch = if (android) GuideTime.parse(value, GuideTimeFormat.ANDROID)
            else clock.seconds(value).let { if (format == XmltvRecordFormat.ARCHIVED_ANDROID) it.toInt().toLong() else it.toLong() }
        val result = Time(epoch, epoch.toString())
        if (value.length <= 64) {
            encodedKeys[encodedCursor]?.let { encodedTimes.remove(it) }
            encodedKeys[encodedCursor] = value
            encodedCursor = (encodedCursor + 1) % encodedKeys.size
            encodedTimes[value] = result
        }
        return result
    }

    fun start(name: String, attributes: Map<String, String>) = startDecoded(name,
        attributes["id"], attributes["channel"], attributes["start"], attributes["stop"], attributes["src"])

    /** Flat decoded attributes avoid constructing a Kotlin map for every XML tag in JS hosts. */
    fun startDecoded(name: String, id: String?, programmeId: String?, start: String?, stop: String?, icon: String?) {
        if (failed) return
        when (name) {
            "channel" -> if (!android) {
                channel = if (rust) id.orEmpty() else id
                if (rust) { channelName = ""; channelIcon = ""; aliases = mutableListOf() }
            }
            "programme" -> {
                programme = when { android -> trim(programmeId.orEmpty()); rust -> programmeId.orEmpty(); else -> programmeId }
                from = time(start.orEmpty()); to = time(stop.orEmpty())
                title.clear(); description.clear(); programmeIcon = ""
                if (android) field = null
            }
            "display-name" -> if (!android && channel != null) { text.clear(); field = "display-name" }
            "title", "desc" -> if (programme != null) {
                field = name
                if (rust || android) text.clear()
            }
            "icon" -> if (!android) {
                if (rust) {
                    icon?.let { if (channel != null) channelIcon = it else if (programme != null) programmeIcon = it }
                } else channel?.let { actions.add(listOf("icon", it, icon.orEmpty())) }
            }
        }
    }

    fun text(value: String) {
        if (failed || field == null) return
        if (rust || android || field == "display-name") text.append(value)
        else if (field == "title") title.append(value) else description.append(value)
    }

    /** Decoding a text/entity can fail even outside an interpreted field. Retain the host error only
     * when that field was being consumed, as QuickXML's former conditional decoder did. */
    fun textError(index: String) {
        if (!failed && field != null) { actions.add(listOf("error", index)); failed = true }
    }

    private fun firstName(id: String, name: String) {
        if (knownChannels.add(identity(id))) actions.add(listOf("channel", id, name))
    }

    fun end(name: String) {
        if (failed) return
        if (android) {
            if (name == field) {
                if (name == "title" && title.isBlank()) { title.clear(); title.append(trim(text.toString())) }
                if (name == "desc" && description.isBlank()) { description.clear(); description.append(trim(text.toString())) }
                field = null
            }
            if (name == "programme") {
                val id = programme.orEmpty()
                if (GuideProgrammeRules.validAndroid(id, from?.epoch, to?.epoch)) {
                    actions.add(listOf("programme", id, from!!.encoded, to!!.encoded, title.toString().ifBlank { "Untitled programme" }, description.toString(), ""))
                }
                programme = null
            }
            return
        }
        when (name) {
            "display-name", "title", "desc" -> {
                if (rust) {
                    val value = trim(text.toString())
                    when (field) {
                        "display-name" -> if (channel != null) { aliases.add(value); channelName = value }
                        "title" -> if (programme != null) { title.clear(); title.append(value) }
                        "desc" -> if (programme != null) { description.clear(); description.append(value) }
                    }
                    text.clear()
                } else if (name == "display-name") {
                    channel?.let { id ->
                        val value = trim(text.toString())
                        if (value.isNotEmpty()) { actions.add(listOf("name", id, value)); firstName(id, value) }
                    }
                }
                field = null
            }
            "channel" -> {
                channel?.let { id ->
                    if (rust) actions.add(listOf("replace-channel", id, channelName.ifEmpty { id }, channelIcon) + aliases)
                    else firstName(id, id)
                }
                channel = null
                field = null
            }
            "programme" -> {
                programme?.let { id ->
                    val value = title.toString()
                    val admitted = if (format == XmltvRecordFormat.ARCHIVED_ANDROID) value.isNotBlank() else value.isNotEmpty()
                    if (admitted) actions.add(listOf("programme", id, from!!.encoded, to!!.encoded, value, description.toString(), programmeIcon))
                }
                programme = null
                field = null
            }
        }
        if (rust) field = null
    }

    fun drain(): List<List<String>> = actions.also { actions = mutableListOf() }
}
