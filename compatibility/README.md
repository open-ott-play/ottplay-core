# Tested release combinations — 2026-09-27

`releases-2026-09-27.json` records exact consumer tags, commit IDs, shipped artifact
digests, matching core source receipts and the scope of the tests actually run.
It is a snapshot of tested combinations, not a promise that any client can take
the current core, and not a publication approval.

FOSS `v1.1.45-beta.36` carries core inputs matching `a37fc5c`. Android
`v0.2.1-preview.3` and FOSS2 `foss2-v0.6.0-beta.2` carry inputs matching
`03f8ff3`. All manifests say `0.1.0-dev`; that label alone cannot identify a
compatible package. The verifier compares every source receipt file with Git
and each shipped artifact with its recorded digest. A matching source commit
does not uniquely identify the build or its producer workflow.

## Verify the exact combinations

Provide clean checkouts at the tags in the matrix, with tags available locally:

```sh
python3 scripts/check-release-compatibility.py \
  --checkout foss=/absolute/path/to/released-foss \
  --checkout android=/absolute/path/to/released-android \
  --checkout foss2=/absolute/path/to/released-core
```

This command only validates provenance. It deliberately reports
`runtime_tests_rerun: false` and `publication_gate: not_qualified`. Run each
consumer's recorded commands to refresh runtime evidence. The matrix records
SHA-256 digests of the original local evidence logs; those logs are retained in
the acceptance evidence directory, not embedded in this source repository.

FOSS2 browser playback needs a valid synthetic MP4 through `OTT2_TEST_MEDIA`.
The default empty media fixture cannot establish playback. Android JVM tests
require JDK 17 and the Android SDK; native adapter tests require Swift and Kotlin.
The native tests compile real adapters but substitute platform APIs. They do not
qualify installed Android/iOS applications or physical TV devices.

## Cross-repository SWOP HTTP test

```sh
node scripts/test-swop-e2e.cjs \
  /absolute/path/to/released-foss \
  /absolute/path/to/released-swop \
  /absolute/path/to/swop-result.json
```

Install the player's locked development dependencies first (`npm ci`). The test
loads the actual player adapter, its generated wire policy and the actual Worker
from the supplied checkouts. It binds only a temporary loopback HTTP listener.
Browser UI/timers are substitutes; no production service is used. Legacy Worker
checkouts use a KV substitute. A checkout with `src/session.ts` uses real workerd,
SQLite Durable Objects and the rate-limit binding; install that Worker
checkout's locked dependencies as well. The script records dirty-worktree status
and source file hashes, so an uncommitted candidate is not mistaken for its base SHA.
Seven scenarios check admin authorization, client allowlisting, session creation,
waiting, ownership, Unicode delivery, sequential duplicate submission/consumption,
and client handling of denial. The captured tagged-release result is
`swop-http-2026-09-27.json`.

Sequential success does not establish atomic burn-after-read. The separate audit
reproduced two ready responses when concurrent Worker calls read before delete.
Cloudflare KV consistency, deployed auth and edge rate limits remain outside this
test. `swop-candidate-http-2026-09-27.json` captures the separately identified
unreleased atomic-session candidate, with seven scenarios passing in workerd.
That historical candidate is superseded by installation authorization in
SWOP `v0.1.0-beta.14` (`4293d8e`); do not use its old auth model for new deployments.
The web vitrine consumes releases and does not embed a shared-core runtime.

## Server-authorized SWOP flow

SWOP `v0.1.0-beta.14` authenticates the hosting installation through a secret
injected by a same-origin server relay. Client identity and separate per-session
read/write capabilities scope an exchange; the installation secret is never
client configuration. The KV allowlist remains only a legacy compatibility path.
The user reports that this version of the flow has already been redeployed;
these local tests are not an independent live deployment attestation.

```sh
node scripts/test-swop-e2e.cjs \
  /absolute/path/to/installation-auth-foss \
  /absolute/path/to/swop-v0.1.0-beta.14 \
  /absolute/path/to/result.json --installation
```

`swop-installation-foss-e2e.json` pins FOSS installation-auth branch commit
`9059e070ea0595d7f67ff886ab9e3dc851aaf9c7` and the exact SWOP release, with clean
tracked files. Ten scenarios cover server authorization, read/write capability
separation, ownership, manual TV code display/submission, Unicode delivery,
single consume and client handling of a rejected installation credential.
The minimal loopback relay is a test fixture; production relay code, same-origin
browser enforcement and deployed settings are outside this test's claim.
`swop-current-legacy-foss-e2e.json` separately verifies seven legacy scenarios
with released FOSS `v1.1.45-beta.36` against the same Worker release.

The reconciled SWOP follow-up changes only test dependencies and adds a restart
regression for installation ownership/capabilities; production authorization,
manual code handling and repeatable Terraform migrations stay at `4293d8e`.

## Cross-repository control-server browser test

```sh
node scripts/test-command-server-e2e.cjs \
  /absolute/path/to/released-foss \
  /absolute/path/to/released-control-server \
  /absolute/path/to/command-result.json
```

Requires the player's locked dependencies, Playwright Chromium and Go. The test
builds the actual Go server, starts it on a temporary loopback port with synthetic
credentials, and loads the actual FOSS command adapter into Chromium. It checks
admin/device separation, lost ACK and reconnect without double dispatch,
cross-device denial, real CORS enforcement, queued-command expiry and unsupported
platform dispatch. Platform dispatch/settings callbacks are substitutes, so an
ACK is not a claim that physical audio, video or device state changed. Exact
release receipts are in `command-server-http-2026-09-27.json`.

FOSS production-build browser evidence is also recorded: `npm run build` followed
by `npm run test:devices:browser -- --workers=2`, 106 tests including synthetic HLS
playback and capability profiles. It qualifies Chromium and these fixtures, not
installed native applications or physical legacy TVs.

## Remaining acceptance scope

The snapshot explicitly leaves full installed-app/device playback, physical
command execution, deployed edge controls and hardware fault/latency acceptance
unqualified. Test success must not advance
publication while those required gates remain open. Branch protection and the
other repositories' CI are not inferred from these results.
