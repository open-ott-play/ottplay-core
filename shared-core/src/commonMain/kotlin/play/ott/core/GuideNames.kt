package play.ott.core

/** Matching rules belong to the core; platform adapters supply decoded channel records. */
object GuideNames {
    private fun quality(value: String): Boolean = value == "hd" || value == "fhd" || value == "uhd" || value == "4k"
    fun normalized(value: String): String = CoreText.normalizedSpaces(value).lowercase()
    fun canonical(value: String): String {
        return stripQuality(normalized(value))
    }
    internal fun stripQuality(value: String): String {
        var result = value
        val first = result.indexOf(' ')
        if (first >= 0 && quality(result.substring(0, first))) result = result.substring(first + 1)
        val last = result.lastIndexOf(' ')
        if (last >= 0 && quality(result.substring(last + 1))) result = result.substring(0, last)
        return result
    }

    /** Ordered compatibility policy: ID, then exact names, then quality aliases.
     * Ambiguity in one name does not hide a different, unique fallback name.
     * Candidate lists are distinct IDs from the host's feed-scoped indexes.
     */
    fun chooseOrdered(ids: List<String>, exact: List<List<String>>, aliases: List<List<String>>): String? {
        ids.singleOrNull()?.let { return it }
        for (candidates in exact) candidates.singleOrNull()?.let { return it }
        for (candidates in aliases) candidates.singleOrNull()?.let { return it }
        return null
    }
}
