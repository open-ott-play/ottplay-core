package play.ott.core

enum class NativeSourceFormat { SWIFT, ANDROID, ANDROID_RAW }
enum class NativeCacheLookup { CACHE, JOIN, LOAD }
enum class NativeCacheRefresh { STALE, REPLACE, FAIL }

/** Source/cache decisions only; hosts own clocks, storage, locks and network callbacks. */
object NativeGuideSources {
    private const val DEFAULT_URL = "https://cdn.epg.one/epg2.xml.gz"
    private const val TTL = 7200

    fun urls(supplied: List<String>, single: String, bundled: Boolean, format: NativeSourceFormat,
             trim: (String) -> String = { it.trim() }, identity: (String) -> String = { it }): List<String> {
        if (format == NativeSourceFormat.ANDROID_RAW)
            return (listOf(single) + supplied).filter { it.isNotBlank() }.distinct()
        val fallback = if (bundled) listOf(DEFAULT_URL) else emptyList()
        // Swift selects the raw array before trimming; Android selects nonblank values first.
        val candidates = if (format == NativeSourceFormat.SWIFT) {
            if (supplied.isNotEmpty()) supplied else listOf(single)
        } else supplied.filter { it.isNotBlank() }.ifEmpty { listOf(single) }
        return candidates.map(trim).filter { it.isNotEmpty() }.distinctBy(identity).ifEmpty { fallback }
    }

    /** First source owns the entire channel, including an absent schedule or icon. */
    fun unowned(existing: Collection<String>, incoming: List<String>, identity: (String) -> String = { it }): List<String> {
        return claim(existing.map(identity).toMutableSet(), incoming, identity)
    }

    internal fun claim(seen: MutableSet<String>, incoming: List<String>, identity: (String) -> String = { it }): List<String> =
        incoming.filter { seen.add(identity(it)) }

    fun fresh(age: Double): Boolean = age < TTL
    private fun lookup(fresh: Boolean, force: Boolean, pending: Boolean): NativeCacheLookup = when {
        !force && fresh -> NativeCacheLookup.CACHE
        pending -> NativeCacheLookup.JOIN
        else -> NativeCacheLookup.LOAD
    }
    fun lookup(now: Double, fetched: Double?, force: Boolean, pending: Boolean): NativeCacheLookup =
        lookup(fetched != null && fresh(now - fetched), force, pending)
    fun lookupAndroid(now: Long, fetched: Long?, force: Boolean, pending: Boolean): NativeCacheLookup =
        lookup(fetched != null && now - fetched < TTL, force, pending)

    fun diskSwift(source: String, storedSource: String, now: Double, fetched: Double, stale: Boolean): Boolean =
        source == storedSource && (stale || fresh(now - fetched))
    // Retain JVM integer arithmetic and the archived adapter's inclusive disk TTL.
    fun diskAndroid(source: String, storedSource: String, now: Long, fetched: Long, stale: Boolean): Boolean =
        source == storedSource && (stale || maxOf(0L, now - fetched) <= TTL)

    /** Rust refreshes an ordered source set atomically, preserving old ownership on partial failure. */
    fun refresh(failed: Boolean, empty: Boolean, stale: Boolean): NativeCacheRefresh = when {
        stale && (failed || empty) -> NativeCacheRefresh.STALE
        empty -> NativeCacheRefresh.FAIL
        else -> NativeCacheRefresh.REPLACE
    }
    fun evictSourceSet(count: Int, existing: Boolean): Boolean = count >= 8 && !existing
}
