# OttPlay service wire contracts v1

`ottplay-wire-v1.json` is the maintained service contract source. The deterministic
`../scripts/generate-wire-contracts.py` emits Go and ES5-compatible TypeScript
policy, interfaces, identifiers, limits and endpoint names. Update this source
and the generator together; never maintain policy in generated consumer files.

Run `python3 scripts/workspace-wire.py` from this source checkout to distribute,
and append `--check` to check all consumers without writing. It imports the
canonical generator's output functions, preserves the generator bytes, and uses
`scripts/consumer_paths.py` to find sibling repositories (or the absolute
`OTTPLAY_CONSUMER_ROOT` override). Use `--target main`, `swop` or `control` to
limit the workspace operation. It requires existing checkouts with the configured
origin, but permits development branches and local changes. Each shipping
consumer contains a generated copy of the schema, generator and source receipt;
`python3 scripts/generate-wire-contracts.py --check` in any consumer works offline
without this checkout. Python 3 is required; the Go target also uses `gofmt`.
Receipts bind both the schema bytes and generator bytes. The source checkout
checks receipt, generator, schema and generated implementation equality.
Do not run the canonical generator's old multi-repository entrypoint from this
source checkout: workspace path resolution belongs to `workspace-wire.py`.

Profiles deliberately retain the existing wire behavior:

- Control server: strict object decoding rejects duplicate keys and trailing JSON;
  text limits measure UTF-8 bytes after native JSON decoding, nonblank strings are
  required, command-specific fields and safe integers are checked, absolute volume
  is 0..100 and exactly one of volume/step must be present. Unknown command precedes
  unexpected-field errors, which precede invalid-value errors.
- Legacy player: known fields are optional and validated even for unrelated
  commands. Empty/unbounded strings, extra fields, finite numbers beyond the safe
  integer boundary, positive durations below 0.001 and simultaneous volume/step
  retain existing acceptance. The host dispatcher still determines support,
  channel readiness, PIN/provider policy and device effects.
- Command client: legacy delivery IDs allow 1..128 URL-safe characters, while
  the Go server emits/accepts 32 lowercase hexadecimal characters. Response batches
  allow 256 entries; acknowledgement batches allow 50.
- SWOP: client IDs allow 8..128 characters. Server text limits use UTF-16 code
  units, while player input is sent unchanged. Existing malformed JSON fallback,
  JSON-null errors, header priority, TTL rounding and burn-after-read behavior
  remain host behavior.

Go JSON, UTF-8, URL parsing, authentication, randomness and HTTP stay native.
Worker Requests/Responses, KV, crypto and HTML stay native. Browser URLs, storage,
DOM and transport execution stay in their adapters. Shared generated predicates
replace handwritten wire decisions; the generator has no player-core dependency.

Immutable before-migration fixtures in each consumer exercise 81 actual player
command-handler cases, 90 Go validator/HTTP cases and 27 Worker service scenarios.
Their provenance records the original checkout revisions; generated policy is
never used to construct expected data.

`ottplay-web-vitrine` is already an artifact consumer. Its verified
`ottplay-foss-dist.tar.gz` contains the player; the vitrine's own source only
stages and deploys that artifact. It contains no maintained player core or service
wire validator to migrate. Its release verification and deployment tools remain
outside this contract generator.
