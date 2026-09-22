# Browser EPG refresh contract

`before-core.json` is the unchanged baseline captured from the former `app.js` refresh policy before migration to shared core: 18 scenarios and 67 state snapshots. Its provenance records the original source commit and file hashes.

Run `node --test tests/test-epg-refresh.cjs` from the FOSS2 directory. The test is also included in `npm test`. It runs real public app actions, the existing app fixture, real `epg.js` and the XML parser. The in-memory controller accessor only observes state, using the shared refresh snapshot after migration. Expected guide payloads, request order, cancellation, notifications, progress, deadlines and generations remain unchanged.
