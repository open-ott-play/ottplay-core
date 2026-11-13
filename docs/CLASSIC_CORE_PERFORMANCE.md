# Classic contract performance qualification

Measured on 2026-11-12 (America/Los_Angeles). Synthetic portable-policy measurements; no player, device, deployment or persistent user settings were operated.

## Decision

The 28 paired scenarios pass exact result, persistence, callback and random-effect parity. **Bulk JavaScript migration remains deferred.** The measured input/output bridge costs are material even after the quadratic lookup fixes. Do not enable `classicChannelLibrary*` or `createClassicChannelReferences` in an existing consumer on the strength of contract correctness alone. No timing tolerance was raised and no device acceptance is claimed.

These new APIs are additive. The currently shipped `classicPortableSnapshot`, `classicInstallationState`, generic provider conversion and their common policies are unchanged by this integration; they are not newly deferred APIs. Their shipped-package comparison is recorded separately before accepting an artifact.

## Reproduction

```sh
node --expose-gc shared-core/scripts/qualify-classic-performance.cjs \
  --core shared-core/dist/ottplay-core.js --rounds 40 --warmup 5 \
  --output /outside/checkout/classic-performance.json
```

The harness verifies the pinned baseline fixture digests and binds the measured runtime and harness SHA-256. It alternates pair order, excludes setup/observation from elapsed time, and checks every warmup and measured pair. Timings cover the actual packaged ABI and host fixture, not only isolated Kotlin methods.

Runtime: v22.23.4, darwin/arm64, Apple M5 Pro. Forty measured pairs follow five warmup pairs per scenario.

Runtime SHA-256: `96ddef77852ae291138d2128a30071dd04aa46678927d60d3bf02b24de72b2c8`.

## API and scenario results

All rows have exact parity. `resolve`/`project` refer to the handle returned by `createClassicChannelReferences`. Medians and p95 are milliseconds.

| Scenario | API exercised | Baseline p50 | Candidate p50 | Candidate p95 | Activation |
|---|---|---:|---:|---:|---|
| `library/1000/create` | classicChannelLibraryEmpty/Decode + host setup | 0.490 | 0.545 | 0.599 | Deferred bulk |
| `library/1000/snapshot` | classicChannelLibraryGroups + host projection | 0.049 | 1.118 | 1.174 | Deferred bulk |
| `library/1000/move` | classicChannelLibraryDecision/Reduce + durable host effects | 0.054 | 2.908 | 3.327 | Deferred bulk |
| `library/1000/resetShuffle` | classicChannelLibraryDecision/Reduce + durable host effects | 0.397 | 4.723 | 5.205 | Deferred bulk |
| `library/1000/preference` | NeedsProviderContext/Decision/Reduce; persisted 10k shuffle | 0.418 | 0.637 | 0.986 | Deferred bulk |
| `library/1000/stored-groups/snapshot` | classicChannelLibraryGroups + host projection | 0.061 | 1.937 | 2.236 | Deferred bulk |
| `library/1000/stored-groups/move` | classicChannelLibraryDecision/Reduce + durable host effects | 0.182 | 5.179 | 5.603 | Deferred bulk |
| `library/1000/stored-groups/adoptOrder` | classicChannelLibraryDecision/Reduce + durable host effects | 0.189 | 3.381 | 3.750 | Deferred bulk |
| `references/1000/cold-build` | createClassicChannelReferences | 2.016 | 4.260 | 4.577 | Deferred bulk |
| `references/1000/1000-lookups` | reference handle resolve/project | 0.866 | 2.027 | 2.275 | Deferred bulk |
| `library/10000/create` | classicChannelLibraryEmpty/Decode + host setup | 3.940 | 4.066 | 4.368 | Deferred bulk |
| `library/10000/snapshot` | classicChannelLibraryGroups + host projection | 0.536 | 12.503 | 14.559 | Deferred bulk |
| `library/10000/move` | classicChannelLibraryDecision/Reduce + durable host effects | 0.475 | 30.816 | 32.078 | Deferred bulk |
| `library/10000/resetShuffle` | classicChannelLibraryDecision/Reduce + durable host effects | 4.399 | 50.831 | 53.923 | Deferred bulk |
| `library/10000/preference` | NeedsProviderContext/Decision/Reduce; persisted 10k shuffle | 4.133 | 6.155 | 6.620 | Deferred bulk |
| `library/10000/stored-groups/snapshot` | classicChannelLibraryGroups + host projection | 0.662 | 21.831 | 24.568 | Deferred bulk |
| `library/10000/stored-groups/move` | classicChannelLibraryDecision/Reduce + durable host effects | 6.000 | 57.413 | 61.810 | Deferred bulk |
| `library/10000/stored-groups/adoptOrder` | classicChannelLibraryDecision/Reduce + durable host effects | 1.881 | 34.576 | 37.237 | Deferred bulk |
| `references/10000/cold-build` | createClassicChannelReferences | 18.948 | 39.461 | 41.113 | Deferred bulk |
| `references/10000/1000-lookups` | reference handle resolve/project | 0.933 | 2.162 | 3.278 | Deferred bulk |
| `references/bounded/chain/cold-build` | createClassicChannelReferences | 0.203 | 0.388 | 0.418 | Deferred bulk |
| `references/bounded/chain/128-lookups` | reference handle resolve/project | 1.913 | 12.547 | 12.714 | Deferred bulk |
| `references/bounded/shared-tail/cold-build` | createClassicChannelReferences | 0.203 | 0.390 | 0.432 | Deferred bulk |
| `references/bounded/shared-tail/128-lookups` | reference handle resolve/project | 1.334 | 8.782 | 9.650 | Deferred bulk |
| `references/bounded/cycle/cold-build` | createClassicChannelReferences | 0.106 | 0.224 | 0.254 | Deferred bulk |
| `references/bounded/cycle/128-lookups` | reference handle resolve/project | 1.283 | 7.957 | 8.289 | Deferred bulk |
| `references/bounded/fanout/cold-build` | createClassicChannelReferences | 0.287 | 0.580 | 0.610 | Deferred bulk |
| `references/bounded/fanout/128-lookups` | reference handle resolve/project | 1.207 | 8.327 | 8.537 | Deferred bulk |

## Interpretation and limits

The original controls are still regressions: reference construction at 10k rows and editing preferences after reloading a persisted 10k-member shuffle. The many-group rows additionally expose the remaining bulk conversion cost; they must not be hidden by a narrow or empty-state workload.

Deterministic ID-access tests prove linear group lookup and stored-order reconstruction, preserve duplicate first-match behavior and callback ordering, and guard shuffle-reset/adopt membership work. The shared implementation is substantially better than its pre-fix quadratic paths, but improvement over a defective candidate is not parity with the shipped Classic path.

The chain/shared-tail/cycle/fanout cases cap at 256 nodes and 128 queries. They do not establish arbitrary-depth graph safety. XML timing is not compared here because this repository has no pinned classic XML reader adapter; the writer golden, malformed input and exhaustive UTF-16 checks remain separate correctness evidence.

Retained-heap deltas are reported only as noisy diagnostics after forced GC, not peak allocation or a memory pass. Some baseline deltas are negative or include collector/JIT effects; no relative memory acceptance conclusion is drawn from them.

Scalar policies and cloud framing have independent functional contracts, not a blanket performance approval from this table. Consumers must keep existing bulk paths until a separately qualified transport design removes the full mutable-state bridge without stale cross-call caches or weaker validation.


## Already shipped API regression control

The immutable baseline is Core 0.1.5 runtime SHA-256
`1667b70127619995ec7c819b710ca520a3432ed4f4859e2468ffad9d210ff959`, whose producer source receipt is
`5e18811d6f7c61854ee86c38f87227c60cd8430183b55fed1e39d18b21d64adc`.
These are existing exports, not the proposed Classic bulk migration. Twenty
paired scenarios check exact JSON bytes, property order/descriptors, prototypes
and input purity in both storage modes, including unsafe keys and a persisted
10k-member shuffle string. All pass; their source and generic conversion are
unchanged. This is a separate baseline from the old Classic consumer fixture.

| Existing API | Fixture | Storage | Baseline p50 ms | Candidate p50 ms |
|---|---|---|---:|---:|
| `classicPortableSnapshot` | settings-10000 | False | 0.850 | 0.836 |
| `classicInstallationState` | settings-10000 | False | 1.420 | 1.415 |
| `classicPortableSnapshot` | settings-10000 | True | 0.964 | 0.965 |
| `classicInstallationState` | settings-10000 | True | 1.612 | 1.487 |

Reproduce with `qualify-classic-existing.cjs --baseline SHIPPED_JS --core
CANDIDATE_JS --rounds 40 --warmup 5 --output OUTSIDE_REPO.json`. Full samples
and runtime/harness hashes are retained in the generated JSON. Small-call ratio
noise is not an activation budget; these controls do not approve the deferred
bulk APIs or establish browser/TV playback performance.
