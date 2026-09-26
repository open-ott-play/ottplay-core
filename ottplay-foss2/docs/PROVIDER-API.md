# Provider and EPG contracts

The provider module uses ES5. Metadata stays plain data; only the view may
render it, with escaping.

## Interface

`providers.create({request, portalTransport})` creates an isolated instance.
`request(url, callback, options)` receives an absolute HTTP(S) URL and optional
`{headers}`; it returns a cancellation function. Its callback is
`callback(error, body)`, where body is JSON text, already parsed JSON, or M3U text.
Attach `status: 401/403` to HTTP authorization errors and use `code: "TIMEOUT"`,
`"RESPONSE_SIZE"` or `"PORTAL_TRANSPORT"` for these transport failures. Provider
errors use safe English messages and never echo the request URL, portal payload,
password or token.

The instance exposes:

- `load(source, callback)` → `{channels, epgUrls, warnings}`.
- `browse(source, folder, callback)` → `{items, warnings}`. `folder === null`
  returns the loaded source's non-live roots. Keep returned folder objects intact.
- `resolve(item, callback)` → `{url, channel}`. A folder is rejected, never played.
- `close(sourceId)` drops the source's cached session/catalog and series details.
  The controller cancels outstanding operations before calling it.

Every operation returns an idempotent cancellation function. Callbacks settle at
most once; cancelling suppresses late responses and prevents dependent requests.
Callbacks may complete synchronously, including cache hits and validation errors.
The controller must preserve cancellation across synchronous callbacks.

A source contains `id`, `type`, and `url`. The persistent source ID is mandatory.
Xtream additionally requires `username` and `password`. Stalker requires the
operator-registered `mac`. The provider also understands optional `output`
(`m3u8`, default; or `ts`), `language` (default `en`), `timezone` (default `UTC`),
and Stalker `profile` identity fields. The profile allows `stb_type`, `sn`,
`device_id`, `device_id2`, `signature`, `ver`, `image_version`, `hw_version`.
Operator-specific values are supplied explicitly; the player never fabricates
serial numbers, signatures or device certificates.

Items have stable `id`, `sourceId`, `name`, `group`, `kind`, optional `logo`,
`description`, `adult`, and media metadata. `kind` is `live`, `vod` or `folder`.
A folder has `folderType` and opaque provider identifiers. `url` is meaningful
only for an immediately resolvable media item. Stalker items contain a session
generation but no bearer token or portal command. The latter stay in closures.

## M3U

Accepts BOM, LF/CRLF, quoted commas, `#EXTGRP`, live and media entries, Unicode,
header/entry catch-up inheritance, XMLTV links, `tvg-id`, `tvg-name`, logos,
`group-title`, `tvg-shift`, and `timeshift` legacy shift tags. Relative stream,
logo and guide URLs resolve against the configured playlist URL. Pasted local
playlists without a base URL must use absolute URLs. Unknown/malformed records
produce safe warnings without discarding valid channels. Exact duplicate streams
are coalesced. Distinct streams sharing `tvg-id` keep separate identities.

Only HTTP(S) playback URLs are accepted; inline protocol header strings, executable
schemes and embedded URL user-info are rejected. Browser CORS and TLS rules remain
applicable unless the user enables a configured relay.

## Xtream-compatible API

After `player_api.php?username=…&password=…` confirms `user_info.auth=1` and an
active account, the provider loads `get_live_categories`, `get_live_streams`,
`get_vod_categories`, `get_vod_streams`, `get_series_categories`, `get_series`.
Empty arrays are valid. A malformed or rejected API response is an error;
unsupported endpoints are not represented as successful empty catalogs.

Live streams use `/live/user/password/id.m3u8` by default; movies use
`/movie/user/password/id.extension`. A valid explicit `direct_source` wins.
Series are folders; opening one requests `get_series_info&series_id=…`, followed
by local season folders and episodes. Both episode maps keyed by season and flat
episode arrays with explicit seasons are supported. Episode media uses
`/series/user/password/id.extension`. One series' normalized details are cached
at a time to bound memory. Category scopes and live/VOD/episode identities differ.

An archive is offered only when `tv_archive=1` and positive
`tv_archive_duration` are present. The explicit Xtream contract is
`/timeshift/user/password/durationMinutes/YYYY-MM-DD:HH-MM/id.extension`.
`epg.archiveUrl` enforces completed programmes and retention, uses UTC calendar
fields, and applies configured correction. It rounds the start down to a minute
and duration up to include the complete programme. This may include up to one
extra minute at either boundary; timestamps are not interpreted in the device's
local timezone. XMLTV is at `xmltv.php` with the same encoded credentials.

## Standard Stalker / Ministra STB API

Use the portal `/c/` URL, `/c/index.html`, or explicit `/server/load.php`,
`/load.php`, `/portal.php`. The browser cannot set `Cookie`. `portalTransport`
must be `true` or a function returning true only when a cookie-capable bounded
relay/native transport is configured. It is checked on every request, including
cached-session playback. A source boolean does not grant transport capability.

The client requests `type=stb&action=handshake`, then `get_profile`,
`type=itv&action=get_genres`, then `get_ordered_list` pages starting at `p=1`.
Requests include `JsHttpRequest=1-xml`, the MAC/language/timezone cookie, scoped
referer/model headers, and the bearer token after handshake. A missing token,
blocked profile, authorization error or unsupported second authentication step
fails explicitly. No profile payload is exposed as application state.

Live channels retain opaque commands privately. Playback calls
`type=itv&action=create_link` and accepts a returned HTTP(S) URL, optionally
prefixed by the portal's `ffmpeg`/`ffrt` marker. That marker is removed as data;
no shell command is executed. Every playback resolves a fresh link.

Movies and series are lazy folders: `type=vod&action=get_categories` →
`get_ordered_list&category=…`. `is_series` or `has_files` creates a movie folder;
`movie_id`, then `season_id`, then `episode_id` selects seasons, episodes and
files when the portal supplies those flags. Final VOD commands use
`type=vod&action=create_link`. Advert playlists or non-HTTP protocols are rejected
explicitly instead of silently choosing an arbitrary stream.

Catalog pagination has a 50,000-item/5,000-page limit. Repeated pages fail even
when the number of raw repeated records would equal `total_items`. Cancelled
pages cannot commit an old session. Empty arrays are valid catalogs.

## EPG

`epg.parseXML(text[, DOMParser[, sourceUrl]])` returns indexed XMLTV data.
Channel metadata includes `{id, names, logo}` in `channels` and `byId`. The first
safe HTTP(S) `<channel><icon src>` is retained; relative URLs require `sourceUrl`.
Metadata-only channels remain matchable even without programme entries.
`epg.mergeGuides(guides)` merges channels and programmes, coalesces exact programme
duplicates, preserves all display-name aliases and ambiguity, and sorts schedules.
The first valid logo for an ID wins in source order; merging does not mutate
source channel metadata.

`guide.coverage` exposes `{limited, windowStart, windowEnd, programmeLimit,
truncatedChannels}`. XMLTV root attributes `data-truncated="true"` or a positive
`data-truncated-channels` set `limited`; integer `data-window-start/end` describe
an ordered Unix-second interval and `data-programme-limit` describes the cap.
Invalid optional values are ignored. Plain XMLTV has `limited: false`, null
window/limit fields and zero truncated channels. Merge preserves any limited
flag, takes the envelope of declared windows and the smallest declared cap,
and sums the per-feed truncation counts. These counts are not distinct channel
counts, and the window envelope is not a claim that every channel covers that
entire interval. The UI uses `limited` to disclose a nearby-programme selection.

`epg.matchMetadata(channel, guide)` returns matched `{id, names, logo}` or null.
`epg.matchChannel(channel, guide)` returns the matched schedule array. Both prefer
the exact case-sensitive `tvgId`, then a unique case/whitespace-normalized
`tvgName`, then a unique normalized `name`. If both names fail, a unique quality
alias may match. `epg.canonicalName(name)` strips one separate leading and one
trailing HD/FHD/UHD/4K token after case/whitespace normalization. Region, language,
time-shift labels and other words remain part of the identity; no fuzzy or
substring match is performed. Duplicate aliases on one ID remain unique, while
different IDs sharing an alias do not resolve. An exact ID with no schedule
does not fall back to a different channel.

Positive `tvgShift` hours move programme timestamps later,
without mutating the shared guide. `currentNext(entries, nowSeconds)` handles
gaps and overlaps without extending an expired event.

The controller selects explicit XMLTV settings before playlist URLs, then the
built-in public EPG.ONE feed. A cleared custom URL restores automatic selection.
The built-in request uses the local server's fixed-source `/api/epg` filter;
custom feeds use direct XHR or the configured bounded relay. See
[EPG loading and server limits](EPG.md) for the wire contract and compatibility
boundary. A public guide match is not a provider-specific EPG API implementation.

`archiveUrl(channel, programme, nowSeconds)` returns a validated URL or null.
It supports explicit default/append/VOD templates, SIPTV shift, and normalized
Xtream metadata. Unknown placeholders or unknown archive formats return null.
No universal archive URL is guessed from retention alone.

## Verification boundary

Automated fixtures match published response shapes and contain synthetic account
and media data. Tests cover runtime ES5, 10,000-channel parsing,
relative URLs, source identity, empty catalogs, series navigation, Stalker
handshake/pagination/VOD/link resolution, authorization, duplicate callbacks,
cancellation, unsafe URLs and archive minute/retention boundaries. They are not
captured customer credentials or a live-operator acceptance test.

An operator-provided M3U/Xtream URL can use its matching generic protocol. Branded
proprietary adapters, the FOSS JSON-RPC `/stalker_portal/api/` variant,
Stalker vendor-specific authentication/DRM/advert playlists, portal EPG/archive,
VPortal/fXML, and physical decoder acceptance remain separate unverified scope.
No compatibility claim is based solely on a provider's brand or device UA.
