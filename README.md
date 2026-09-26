# OttPlay core and FOSS2

This repository maintains the shared OttPlay business logic, its compiled
JVM/ES5 distributions, service wire contracts and the FOSS2 browser client.
The five independent consumer repositories live beside it, normally under
`~/victron`. Consumers carry generated artifacts and build without a sibling
core checkout or Kotlin compiler.

## Architecture

`shared-core/src/commonMain` owns:

- M3U parsing, operator sessions/catalogs, Xtream and Stalker/Ministra protocols.
- Channel identity, XMLTV dates and records, feed selection, matching, schedules,
  refresh coordination, bounded caches and streaming guide output.
- Archive retention, catch-up URL rules, favorites/history, settings import,
  backup portability and parental authorization.
- Playback target selection, recovery, seek/track restoration and channel-switch
  admission.

Compatibility profiles preserve each client's data and protocol contracts.
Platform adapters provide UI/focus, HTTP/TLS, storage, XML/JSON/URL decoding,
cryptography, codec/media engines, device APIs and OS lifecycle effects.

Android consumes the JVM JAR. FOSS2, the base player, Tauri and the Node companion
consume ES5 JavaScript. iOS runs the same JavaScript in JavaScriptCore; the Rust
server uses QuickJS-NG, including Alpine/musl builds. No WebAssembly or remote
execution is required. Compiler outputs are generated distributions of the
common source.

Control-server and SWOP consume policy generated from
`contracts/ottplay-wire-v1.json`; their self-contained generators and digest
receipts check schema and output integrity. Vitrine publishes the base player's
packaged artifact. See [shared core API and builds](shared-core/README.md),
[service contracts](contracts/README.md) and [FOSS2](ottplay-foss2/README.md).

## Reproduce this source tree

The [open-ott-play/ottplay-core](https://github.com/open-ott-play/ottplay-core)
repository owns `shared-core`, its distribution tooling, the service wire
contracts and `ottplay-foss2`. Its usual local checkout is `~/victron/ottplay-core`.
The other five repositories remain
independently versioned consumers/services. Their integration commits are pinned
in `checkouts.json`.

To clone the source repository into the flat workspace:

```sh
cd ~/victron
git clone git@github.com:open-ott-play/ottplay-core.git ottplay-core
```

The default layout is:

```text
~/victron/
  ottplay-core/                 # this repository (local name is not significant)
    shared-core/
    contracts/
    ottplay-foss2/
  ottplay-foss/
  ottplay-android/
  ottplay-control-server/
  ottplay-swop/
  ottplay-web-vitrine/
```

All orchestration resolves consumer paths through `scripts/consumer_paths.py`.
The default consumer root is this checkout's parent directory, regardless of the
current working directory or the name of this checkout. Set
`OTTPLAY_CONSUMER_ROOT` to a nonempty absolute path to use another directory.
Run `python3 scripts/consumer_paths.py` to inspect the resolved layout. FOSS2,
shared-core and local reports always remain inside this checkout.

For a pinned reproduction, use a fresh directory so that existing development
checkouts are untouched. GitHub access is required to clone the pinned consumers:

```sh
export OTTPLAY_CONSUMER_ROOT="$(mktemp -d)"
python3 scripts/checkouts.py
(cd shared-core && npm ci && ./gradlew --no-daemon jvmTest jsNodeTest && npm run pack:core && npm run check:js)
(cd ottplay-foss2 && npm ci && npm test)
(cd "$OTTPLAY_CONSUMER_ROOT/ottplay-foss" && npm ci --ignore-scripts)
node scripts/check-unification.cjs
```

The checkout helper only clones missing repositories. Existing paths must be
the root of the configured Git repository, with the exact pinned commit and no
local changes; it refuses symlinks, wrong origins and other revisions. It never
fetches, resets, moves or cleans an existing checkout. A newer development
checkout is expected to fail this pin check; use a separate consumer root for
reproduction. Unset `OTTPLAY_CONSUMER_ROOT` to resume using sibling checkouts.

Consumer artifacts can be verified and built without this source repository.
CI delivers qualified compiler outputs through signed vendor updates, as
described in [core delivery](CORE-DELIVERY.md). For local development, compile once
and use the three install commands in `shared-core/README.md`. The integration
snapshot in `checkouts.json` is updated separately after consumer acceptance.
For wire policy, run `python3 scripts/workspace-wire.py`
to distribute or add `--check` for read-only verification. This runner reuses the
canonical generator and preserves its bytes and consumer receipts. Consumer-local
`scripts/generate-wire-contracts.py --check` remains self-contained and unchanged.

Run `python3 -m unittest discover -s scripts/tests -v` for layout and checkout
safety tests. These use temporary local repositories and need no network access.

GitHub Actions rebuilds the common JVM/ES5 outputs and checks the browser pin,
then runs FOSS2 contracts and Chromium EPG/compatibility journeys. Its wire job
clones pinned consumers into an explicit runner-temporary directory. Consumers run their own native/platform CI.
Source publication is separate from a product release or deployment.

## Validation and releases

CI classifies the complete Git diff with the pinned shared toolkit before
starting Kotlin, browser and wire-contract jobs. Changes limited to ordinary
documentation and the exact documentation paths in `core.yml` skip those jobs.
Source, tests, fixtures, assets, configuration and unknown paths run full
validation. Manual runs always perform full validation; documentation-only runs
produce no build artifacts.

Successful portable builds upload one distribution archive with seven-day
retention. Browser CI installs that exact artifact in a disposable FOSS2
checkout. Only qualified `main` builds can deliver it to consumers. Repeated
identical deliveries do not create duplicate updates. Browser reports are
retained for one day after success or three days after failure/cancellation.
See [core delivery](CORE-DELIVERY.md) for configuration and retries.

Run `node scripts/check-unification.cjs` after building and distributing the core.
It verifies artifacts and the required provider/device file inventory. Common
tests run against JVM and JavaScript; optional Apple checks are described in the
shared-core documentation. Fixtures cover malformed data, Unicode, time zones,
identity ambiguity, cancellation and platform compatibility profiles.

Automated tests do not certify physical TV/STB codecs, DRM, provider accounts or
installation/rollback behavior. Those require the corresponding devices and
accounts. Product releases and deployments remain separate from source
publication and core delivery. FOSS2 installation and upgrade instructions are in
[the beta release notes](ottplay-foss2/docs/RELEASE-0.6.0-beta.2.md).
