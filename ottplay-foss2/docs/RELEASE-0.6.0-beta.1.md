# OTT-play FOSS 2 — 0.6.0-beta.1

This beta improves source identity, programme guides, playback recovery and
remote-control behavior in the ES5 client.

## Changes

- Source-bound identity reconciliation moves favorites/order, overrides/hidden channels, PIN protection, last/previous channel, preferences, history, bookmarks and reminders together before playback authorization. Stream URLs are not stored in identity descriptors. Ambiguous legacy selections require review and keep PIN protection.
- XMLTV feed identity and per-channel feed affinity prevent same-ID schedules/logos from different providers from merging.
- Android browser numeric DOM input is separate from the explicitly selected native KeyEvent profile.
- Recoverable Shaka errors retain its recovery process under a bounded no-progress watchdog.
- EPG downloads refresh every 30 minutes, reconcile overdue foreground work and back off failed requests while retaining configured feeds' last good data.
- Explicit retry preserves VOD/archive position; multi-engine fallback preserves one DVR offset across intermediate failures.
- Guide opens the programme guide without interrupting playback; the server serves allowlisted profile HTML routes consistently with device detection.
- TV suspension preserves playback intent and position, rechecks PIN authorization on foreground, and respects intentional pause/Stop/source changes.
- Flussonic/tvg-rec archive contracts are recognized. Built-in XMLTV requests support seven past days and 24 future hours within explicit memory/response limits.
- Large sequential catalog scans no longer evict the entire EPG working set; the lookup cache stays bounded.

The compact UI, English default with Russian selection, numeric remote profiles, bundled fonts, Window Controls Overlay and polyfill-before-library/Worker loading policy are retained. Pinned media library versions are unchanged.

## Install or upgrade

Verify `SHA256SUMS`, unzip `ottplay-foss2-0.6.0-beta.1.zip`, and run inside its directory:

```sh
npm ci --omit=dev
npm start
```

The server defaults to `http://127.0.0.1:8092/`. Static assets are already built. Node runs on the serving computer, not the TV. To bind the local network explicitly use `HOST=0.0.0.0 PORT=8092 npm start`; the development server is not an authenticated public hosting service.

Before replacing an existing installation, retain its directory and a full settings export. Use the same origin and browser profile to keep browser storage; changing the port changes that origin. Stop the old server before starting the new one on its port. Retain any explicitly configured `OTT2_RELAY_ORIGINS` allowlist. Do not clear storage or uninstall the Chrome app.

For rollback, restore the previous directory/server and, if necessary, the pre-upgrade full settings export. Identity migrations can replace saved IDs, so restoring old code alone is not a complete settings rollback.

## Verification boundary

Release checks cover ES5 grammar, polyfill/library/Worker order, resource/vendor integrity, isolated device/provider/media tests, browser journeys and an extracted-archive startup. The `validation.json` beside the release ZIP records the final commands, hashes and results. Synthetic feeds and media avoid private provider credentials.

Actual LG/webOS, Tizen, Panasonic, MAG, Dune and Android TV model/firmware acceptance, multi-hour physical playback, private operators, native proprietary bridges, DRM and codec availability are not certified by this beta. ES5 syntax/polyfills cannot supply missing native decoding or media APIs. Legacy ambiguous favorites may require manual selection; protection is retained rather than guessed.
