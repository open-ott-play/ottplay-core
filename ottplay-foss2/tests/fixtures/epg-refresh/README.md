# Browser EPG refresh contract

`before-core.json` defines 18 refresh scenarios and 67 expected state snapshots.

Run `node --test tests/test-epg-refresh.cjs` from the FOSS2 directory. The test is also included in `npm test`. It runs real public app actions, the existing app fixture, real `epg.js` and the XML parser. The in-memory controller accessor only observes state, using the shared refresh snapshot. Expected guide payloads, request order, cancellation, notifications, progress, deadlines and generations remain unchanged.
