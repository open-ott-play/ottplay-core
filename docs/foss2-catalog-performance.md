# FOSS2 catalog and guide projection caches

FOSS2 keeps a catalog index for an immutable provider result and its channel-edit
revision. Paging reuses the filtered/sorted selection; it only slices the visible
page. A bounded cache retains at most 16 filter combinations. Channel lookup uses
an ID index. Replacing the source or changing overrides invalidates the index;
favorite order and restored library entries invalidate their separate projection.

The guide snapshot is keyed by catalog, guide identity/version and time. It stays
valid until the next programme start/end. At that boundary it updates only guide
lookups whose schedule expired; edits refresh matching identities. Moving the
clock backwards forces a refresh. Guide rows are sorted once per snapshot/filter
and expire when retained archive entries cross the seven-day cutoff. Leaving the guide, replacing the catalog, resetting provider browsing, and
destroying the app release the sorted guide projection and its backing snapshot.
Initial catalog decoration, a new filter and the initial full guide match still require
linear work. EPG counts continue to cover the complete visible catalog, not only
the rendered page. No shared-core protocol or persisted-state format changes.

Run `node scripts/benchmark-catalog.cjs` from `ottplay-foss2`. This synthetic test
compares 100 page projections over 10,000 channels, including initial decoration.
Both paths receive the same catalog; the baseline repeats EPG and filter work.
The indexed path performs 10,000 EPG lookups instead of 1,000,000. Timings depend
on hardware/runtime and are not startup or streaming measurements. Regression
tests in `tests/test-catalog-index.cjs` assert invalidation and operation counts,
not unstable wall-clock thresholds.

## Delivery boundary

This source belongs to the independent `ottplay-foss2` client in `ottplay-core`.
Changing it does not modify the classic `ottplay-foss` client, Tauri package,
Capacitor package, or their hosted deployment. The shared-core vendor workflow
only distributes `shared-core` artifacts. FOSS2 must be built/released using its
own workflow. Classic guide selection has a separate optimization in its own
consumer repository and must be tested/delivered there.
