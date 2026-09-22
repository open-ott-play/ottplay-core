@file:OptIn(ExperimentalJsExport::class)

import play.ott.core.*

@JsExport
fun nativeGuideSources(supplied: Array<String>, single: String, trim: (String) -> String, identity: ((String) -> String)? = null): Array<String> =
    NativeGuideSources.urls(supplied.toList(), single, true, NativeSourceFormat.SWIFT, trim, identity ?: { it }).toTypedArray()

@JsExport
fun nativeGuideUnowned(existing: Array<String>, incoming: Array<String>, identity: ((String) -> String)? = null): Array<String> =
    NativeGuideSources.unowned(existing.toList(), incoming.toList(), identity ?: { it }).toTypedArray()

@JsExport
fun nativeGuideLookup(now: Double, fetched: Double?, force: Boolean, pending: Boolean): String =
    NativeGuideSources.lookup(now, fetched, force, pending).name

@JsExport
fun nativeGuideDisk(source: String, storedSource: String, now: Double, fetched: Double, stale: Boolean): Boolean =
    NativeGuideSources.diskSwift(source, storedSource, now, fetched, stale)

@JsExport
fun nativeGuideFresh(age: Double): Boolean = NativeGuideSources.fresh(age)

@JsExport
fun nativeGuideRefresh(failed: Boolean, empty: Boolean, stale: Boolean): String =
    NativeGuideSources.refresh(failed, empty, stale).name

@JsExport
fun nativeGuideEvictSourceSet(count: Int, existing: Boolean): Boolean = NativeGuideSources.evictSourceSet(count, existing)
