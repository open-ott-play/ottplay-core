# Documentation images

The FOSS2 client bundled with this repository is a user interface; the shared
core library itself is not. The hero shows its real first-run screen in English,
with the navigation menu expanded and no provider or playlist configured.
The version shown by the source package is `0.6.0-beta.4`. This documents the
client interface, not platform coverage or playback acceptance.

## Capture

From a clean checkout, run:

```sh
cd ottplay-foss2
npm ci --omit=dev
HOST=127.0.0.1 PORT=18479 npm start
```

Open `http://127.0.0.1:18479/` in a fresh browser origin/profile. Use a 1280 × 720
viewport, open **Menu**, and capture the page without browser chrome. Do not
import personal settings or add a provider. The checked-in original is
[`foss2-start.jpg`](foss2-start.jpg). Its source commit, hash and capture context
are recorded in [capture-provenance.json](capture-provenance.json).

## Regenerate the hero

Install ImageMagick 7, then run from the repository root:

```sh
./scripts/render-docs-hero.sh
```

The renderer checks the source dimensions before applying perspective, rounded
outer corners, a neutral background and a soft shadow. It does not redraw any
application content. The flat original is preserved and linked from the README.
When replacing it, update the provenance and caption and review the composition.
