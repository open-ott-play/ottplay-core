# Programme guide and logo contracts

## Source selection

The controller selects up to ten explicitly configured XMLTV URLs first. With
no explicit URLs, it uses the active playlist/provider's `epgUrls`. With neither,
it requests `https://cdn.epg.one/epg2.xml.gz`. Clearing and saving the XMLTV field
restores this automatic selection. Changing a source cancels the previous guide
load and clears its metadata; cancelled responses cannot populate the new source.

This default reproduces an existing source contract: the original companion's
`src-rs/server/src/main.rs:epg_urls` and desktop's
`src-tauri/src/commands/tauri_commands.rs:init_xmltv_urls` fall back to
`http://epg.it999.ru/epg2.xml.gz`. The original mobile Full edition uses the
HTTPS CDN URL above. These source facts do not establish current network
availability or coverage of every channel.

## Built-in feed

The supplied Node server implements `POST /api/epg` with an application/json body:

```json
{"channels":[{"tvgId":"station-id","tvgName":"Station","name":"Station HD","archiveDays":7}]}
```

The browser sends only channel identity metadata to its local server. Provider
credentials, playlist bodies and playback URLs are excluded. The server fetches
the fixed HTTPS EPG.ONE URL and does not send these channel identities upstream.
The endpoint does not accept a custom upstream URL. It is independent of the
optional `/api/relay` allowlist and requires same-origin browser requests to the
actual local server address. The browser adds `X-OTT2-EPG: 1` to built-in requests.
For older TV engines that omit Origin on same-origin XHR, the endpoint accepts
this marker only when Host matches the actual bound socket address and port.
An explicitly supplied Origin must still pass the normal same-origin checks;
the marker does not override a mismatched Origin. Cross-origin preflight is not
enabled. Static-only hosting and reverse-proxy host rewriting are outside this
endpoint's supported contract. This legacy-header path applies to `/api/epg`;
the general `/api/relay` endpoint still requires Origin.

The server detects gzip by its signature, decompresses it as a stream and parses
XML with `saxes`. It retains matching channel metadata and a programme window
covering 24 hours before/after request processing by default. Each channel may request `archiveDays` from 0 to 7; the past window grows to that bounded depth while the future window remains 24 hours. It returns ordinary XMLTV so
the browser uses the same ES5 parser, matching rules and view as custom feeds.
Metadata must preserve ambiguous candidate IDs even when their programmes are
not selected, so filtering cannot turn an ambiguous name into a unique match.

Limits are explicit:

- Request: 4 MiB, at most 16,384 channel identities, 512 characters per field.
- Upstream: 80 MiB compressed/wire data, 512 MiB decoded data, 120-second timeout.
- XML: bounded nesting and field lengths; custom entity declarations are rejected.
- Result: at most 384 programmes per channel, 50,000 total, 16 MiB serialized XML;
  the per-channel allowance shrinks as needed to share the total budget across
  requested identities and candidate XMLTV channels. The limit of 384 is a
  ceiling, not a guaranteed number of programmes for every channel.
- Concurrency: at most eight request clients; one active identity-set fetch.
- Cache: one successful filtered result, keyed by channel identities and requested archive depth, for 30 minutes.

Malformed XML or an excessive request/upstream/field fails with a bounded error
code. Programme budgets retain current and next programmes first, then the
nearest programmes around the request time. The server marks a limited result
with XMLTV root attributes `data-truncated`, `data-truncated-channels`,
`data-window-start`, `data-window-end` and `data-programme-limit`. Browser parsing
validates these optional values and exposes `guide.coverage.limited`; the status
line discloses **nearby programmes only**. Metadata that preserves ambiguous
matches is not discarded to make a match appear unique.

Identical active requests share a fetch. Disconnecting the last client cancels
it. The browser timeout allows a short margin beyond the server timeout. The
bounded seven-day archive window and programme selection may not include every historical programme. Configure an appropriate custom XMLTV source when a wider schedule is needed.

`saxes` is a Node server dependency. It is not bundled into `boot.js` or any TV
script, and does not weaken the ES5 browser runtime contract. Node runs on the
computer serving the application; no Node installation is required on the TV.

## Custom feeds

Custom XMLTV uses cancellable XHR, or the optional source relay when enabled.
Direct requests require CORS and XML text after HTTP content decoding. A raw
`.xml.gz` download without browser HTTP decoding requires the configured relay.
The relay handles HTTP gzip/deflate and gzip file signatures, including a gzip
file transported with HTTP compression, while bounding decoded size at 16 MiB.
These custom requests retain the relay's exact-origin allowlist, redirect/DNS
checks, header restrictions and timeout. The built-in server filter does not
automatically authorize arbitrary guide servers.

## Matching, images and display

Both schedules and logos use the same matcher: exact case-sensitive XMLTV ID;
unique normalized `tvgName`; unique normalized channel `name`; then unique
quality aliases in that order. Normalization collapses whitespace and lowers
case. Quality aliases remove only separate leading/trailing HD, FHD, UHD or 4K
tokens. Regions, languages, shifted variants such as `+2`, punctuation and other
words are retained. No substring score selects an arbitrary station.

XMLTV retains all display-name aliases, including channels without programmes.
The first valid HTTP(S) channel icon wins for duplicate declarations/source IDs;
relative icon URLs resolve against the XMLTV document URL. Unsafe schemes and
URL user-info are rejected. The view prefers that EPG icon, then the playlist
logo, and hides a failed image without changing row dimensions.

The status line shows request progress, matched channel/current programme counts,
no matches, outdated guide dates or errors. Current/next labels refresh every
30 seconds on the visible main interface. This uses the loaded data rather than
fetching the public feed every 30 seconds. A successful refresh replaces guide
data; a failed refresh does not invent programmes.

## Evidence and boundaries

`tests/test-epg.cjs` exercises parser, metadata, names, merging, time shifts and
archive contracts. `tests/test-epg-service.cjs` exercises the streaming service
and bounds with synthetic responses. `tests/browser-epg.cjs` checks the rendered
guide and loaded images in Chromium. Its latest run artifact is
`test-results/browser-epg-report.json`; read the run date/results before using it
as evidence for an edited version.

Public-feed availability and the user's real channel coverage require a separate
live check. Synthetic fixtures are not a private-provider acceptance test.
Proprietary portal EPG, channel-specific authentication and physical LG firmware
remain separate compatibility boundaries.

The recorded live run at `2026-09-14T15:40:44.168Z` requested 1,562 playlist
channels; its shared programme budget produced a per-channel cap of 18 and a
limited result containing 14,217 programmes. See
[the live EPG report](../test-results/epg-live-report.json). This is a dated server
fetch/filter/matching result, not proof that every channel has a complete
48-hour schedule or that the result was tested on physical LG hardware.

## Channel browsing

The channel cursor is separate from the playing channel. Moving it updates only
the selected channel panel: current title/time/description and next programme.
Returning from playback restores the playing channel's page and cursor. The
existing video continues in the preview; no second decoder or stream request is
created. Enlarged text prioritizes the current description over next-programme
text when space is limited. Info opens the channel card with the full description.

## Refresh and feed identity (beta 0.6)

Downloads refresh every 30 minutes while visible; foreground reconciles overdue requests. Failures back off from one to 30 minutes. Each configured feed retains its last good guide through a transient error. Removing a feed removes its guide; a cancelled or old-source callback cannot restore it.

M3U entry `tvg-source`/`url-tvg` affinity precedes playlist-wide URLs. Merged guides qualify channel IDs by feed, so unrelated XMLTV channels with the same ID cannot mix schedules or logos. Unqualified matches must be unambiguous. Anonymous imports have separate identities. The bounded 4,096-entry cache protects 75% of its working set from sequential scan eviction and rotates the remainder. Retained shifted schedules have a separate 65,536-programme budget; unshifted schedules reuse the parsed arrays. Source/guide replacement invalidates the cache.

M3U archive depth recognizes `catchup-days`, then `timeshift`, then `tvg-rec` within each scope. Entry values override header values, including explicit zero; metadata is bounded to 30 days. Explicit catchup templates are supported, and Flussonic archive URLs preserve existing query parameters. The built-in feed requests at most seven days even when the provider advertises more.
