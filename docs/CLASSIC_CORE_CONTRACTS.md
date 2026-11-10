# Classic client contracts and migration

These additive **v1 classic profiles** preserve OTTPlay FOSS behavior. They do
not replace the differently shaped FOSS2 `LibraryState`, `ChannelIdentity` or
`PlaybackRetries` APIs. Public compiler outputs are built from the Kotlin
common source; clients must not maintain another copy of these policy rules.

## Ownership

- **Channel library:** classic v1 document validation and pure edits, inherited
  provider groups, membership, ordering, selection, hiding, locks and shuffle.
  The host retains durable readback, legacy migration, source-generation guards,
  callback ordering and numeric renderer projection. Randomness is an explicit
  host input, sampled only after the host admits a writable edit.
  `classicChannelLibraryNeedsProviderContext` lets the host omit unused catalog
  data for independent edits; the action classification stays in common core.
  Supplied provider data remains validated. Group projections are computed only
  when needed, without caching mutable host objects by identity.
- **Channel references:** numeric/item/alias graph, cycles, ambiguous references
  and pending raw values. JavaScript's decimal-to-number-to-string conversion
  is an explicit host primitive. JVM callers must provide that codec when
  interoperating with legacy numeric IDs; Kotlin `Double.toString()` is not an
  equivalent default. Renderer row numbers remain host-only.
- **Portable global favorites:** existing document/entry shapes, supported
  locator kinds, Unicode/path rules, identity and matching. No format bump.
  The JavaScript boundary rejects accessor, non-enumerable and symbol extras
  before converting untrusted objects. Storage, activation, grants and signature
  envelopes remain with the host. Matching returns the original candidate.
- **M3U user agents:** one preset/default definition and ASCII case-insensitive
  preset resolution; non-ASCII and other custom values remain unchanged. Rust and Swift tables may be
  generated from qualified JS exports to avoid a per-request embedded VM.
  HTTP header validation, SSRF rules, proxies and request ownership remain local.
- **Programme reminders:** source-bound validation, first-identity normalization,
  next deadline and notify/prompt eligibility over explicit sampled times. Opaque
  record fields are cloned in the host's JSON format. Timer handles, resolution,
  overdue-at-load suppression, prompt ownership, generation checks and durable
  readback remain local. Planning does not authorize playback.
- **Live stall recovery:** classic 0..5 attempts, 10/15/20/30-second timeout,
  three-second countdown, ten healthy seconds to reset and discontinuity/sleep
  handling. Pure planning only establishes eligibility. The host preserves
  reporting/reentrancy order, decoder/source ownership rechecks and consumption
  of an attempt even when restart dispatch fails. Event-driven OSD refresh is
  presentation, not a new recovery clock or budget.

## Delivery order and held integration

1. Freeze the existing client behavior as characterization cases and common
   contract tests, including rejected input and effect ordering.
2. Implement additive common APIs with JVM and JS tests. Keep incompatible
   schemas explicitly named instead of adapting them by coincidence.
3. Run `jvmTest jsNodeTest`, `pack:core`, `check:core` and `check:js`. The generated
   manifest binds exact source and JS/JAR bytes; never edit its hashes manually.
4. Use the existing consumer installer/verifier for the same candidate JS/JAR.
   Run the actual FOSS tests with that artifact, including persistence failure,
   stale source, reentrant callback and ambiguous-reference cases.
5. Switch consumers to thin ports and remove only the replaced local rules.
   Recheck source/vendor equality after the final source change.

The current migration uses a linked core PR and one FOSS integration PR. Both
remain **draft/manual hold, without automerge**, pending the owner's release
window and explicit merge clearance. A locally built candidate is not a released
version or a hardware acceptance result. No device operation is required by
these pure contract tests.

## Deliberately retained implementations

The native LG SDL/PlxNative application develops in `open-ott-play/ottplay-lg`;
it is distinct from the classic hosted LG wrapper. Its historical provenance and
GPL notices remain with that project and historical FOSS source releases.

Optimized Rust XMLTV reducers remain native implementations qualified against
the pinned core oracle. Do not substitute a per-record JS VM on their hot path.
DOM, network, storage, media lifetimes and platform decoder logic are not shared
domain rules. Folder-order and buffer helpers remain separate candidates until
another actual consumer and a compatible contract justify their extraction.
