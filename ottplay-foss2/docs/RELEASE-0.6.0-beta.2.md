# OTT-play FOSS 2 — 0.6.0-beta.2

This beta packages the completed shared-core integration in the independent ES5
client. Its version and archive are separate from the original OTT-play FOSS and
native Android release channels. The previous `0.6.0-beta.1` notes and artifacts
remain historical records.

## Changes

- M3U, Xtream and Stalker source, session, catalog, identity and media-route rules
  use the common OttPlay implementation. Request lifetime and the bounded series
  cache retain the client's cancellation and stale-response behavior.
- Browser and Node programme-guide processing share timestamp conversion,
  XMLTV record normalization, channel matching, schedule selection, feed merging,
  refresh coordination and bounded streaming output rules.
- Persisted selections, backups, legacy settings import, parental sessions and
  playback recovery/position decisions delegate to the same pinned core.
  Browser storage, HTTP, XML/JSON decoding, DOM focus and media-engine effects
  remain in the client.
- The archive includes the ES5 core, source receipt and licenses. Its exact core
  source is `1f6d25045ad80c3ee449f6ed2affbf051bfff73939c4db9833da7ee22e1da67f`.
  Running the application requires no shared-source checkout or Kotlin compiler.

The compact interface, English/Russian selection, remote profiles, fonts and
Window Controls Overlay remain available. Existing media-library pins are
unchanged. Captured migration fixtures preserve prior public outputs, callback
ordering and partial-failure behavior.

## Install or upgrade

Verify `SHA256SUMS`, extract `ottplay-foss2-0.6.0-beta.2.zip`, then run:

```sh
cd ottplay-foss2-0.6.0-beta.2
npm ci --omit=dev
npm start
```

Open `http://127.0.0.1:8092/`. The static assets are already built; Node runs on
the serving computer. For an explicit local-network listener, use
`HOST=0.0.0.0 PORT=8092 npm start`.

Before replacing an installation, retain its directory and export a full settings
backup. Stop the old server before starting this version on its port. Keep the
same origin and browser profile to retain browser storage, and preserve any
`OTT2_RELAY_ORIGINS` allowlist. Clearing data or reinstalling the browser app is
unnecessary. For rollback, restore the earlier directory and, if required, the
saved settings export; restoring old code alone does not undo identity migrations.

## Verification

The accompanying `validation.json` records the twelve release checks and exact
input fingerprints: unit contracts, ES5 grammar, resource/vendor/core integrity,
and eleven Chromium journeys covering generated-media playback, providers, EPG,
compatibility, browsing, controls, startup, scrolling and window controls.
`release-manifest.json` identifies every archive entry; `SHA256SUMS` identifies
the package. The extracted package is also checked for startup and served assets.

Physical TV/STB firmware, private operator accounts, proprietary native bridges,
DRM and codec availability require their own acceptance. The local development
server is not an authenticated public hosting service. The beta does not certify
those capabilities or retire any retained client target.
