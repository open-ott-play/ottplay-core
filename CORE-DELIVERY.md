# Delivering the shared core

Changing `shared-core` and merging the change into `main` starts this chain:

1. `portable` tests Kotlin/JVM and JS, builds the ES5 JavaScript and JAR, validates
   the distribution manifest, and uploads its exact five-file package.
2. `browser-client` checks the committed FOSS2 pin, then installs that uploaded
   candidate into a disposable checkout and exercises the browser contracts.
   `wire-contracts` independently checks the integration snapshot and wire policy.
3. After all three jobs succeed, the pinned shared CI toolkit validates the source
   commit/run, archive digest, manifest and source receipt and creates signed
   draft vendor updates wherever the committed consumer package differs.
4. Consumer CI validates each update before acceptance. The consumer's existing
   beta/release workflow follows its own policy.

Delivery targets are:

- `open-ott-play/ottplay-foss`, `vendor/`: ES5 JS, JAR, manifest and license.
  Server and Tauri share this package.
- `open-ott-play/ottplay-android`, `core/vendor/`: JAR, manifest and license.
- `open-ott-play/ottplay-core`, `ottplay-foss2/vendor/`: ES5 JS, manifest and license.

FOSS2 vendor-only merges do not change the source subtree. Identical packages are
no-ops and repeated attempts reuse the same update, so this creates no update
loop. Documentation-only runs skip compilation and delivery. `checkouts.json`
remains an explicit integration snapshot, independent of consumer default branches.

## Repository configuration

`CORE_DELIVERY_ENABLED=true` activates the final delivery job. Keep it false
during initial rollout or to pause deliveries. Builds and local consumers do not
depend on this flag. Set `CORE_DELIVERY_COMMITTER_NAME` and
`CORE_DELIVERY_COMMITTER_EMAIL` to the dedicated signing identity.

Forward the existing organization `BOT_PAT` to the reusable workflow. Its account
needs contents and pull-request write permissions to the three destinations; the `bots` team
grants are managed in `4alvit/terraform-github-open-ott-play`. Store the dedicated
SSH private key only in the producer's `CORE_DELIVERY_SIGNING_KEY` secret and
register its public signing key with the matching GitHub identity. Do not reuse
a developer's workstation private key. Actions and toolkit code are pinned to
reviewed immutable commits.

Delivery does not automatically accept updates, bump versions, create release
tags, deploy servers or install workstation applications.

## Retry and local builds

Dispatch `core.yml` on current `main` to build, qualify and deliver the current
package again. Existing identical files or an unchanged open update are reused.
When rerunning an existing workflow, choose **Re-run all jobs**: qualification is
bound to one run attempt, so rerunning only a failed delivery job is insufficient.
An older source tree, changed consumer base, modified generated branch or expired
archive fails explicitly. Use a fresh main run for a newer tree or expired archive;
resolve a modified/closed update deliberately rather than overwriting it.

The archive is retained for seven days as transport. Its bytes become ordinary
tracked files through the update. Building FOSS/server/Tauri or Android locally
or publishing their beta therefore needs only that consumer repository and its
normal toolchain, even after the archive expires. A local checkout of this core
repository is needed only when developing/recompiling the common implementation.

The shared [delivery contract](https://github.com/victron-venus/venus-os-ci-toolkit/blob/main/docs/VENDOR_DELIVERY.md)
documents validation, signatures and allowed paths. Each update identifies the
producer commit, qualified run and artifact digest used for its files.
