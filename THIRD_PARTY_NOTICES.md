# License scope and third-party notices

The root [MIT license](LICENSE) covers original project code, contracts, scripts and documentation. The owner confirmed the rights and this grant on 2026-10-16. It does not replace third-party copyright notices or grant rights to separately licensed or unlicensed material.

- The shared Kotlin core retains [its MIT license](shared-core/LICENSE). Kotlin runtime/compiler material retains the [Apache-2.0 license](shared-core/licenses/kotlin-LICENSE.txt) and [NOTICE](shared-core/licenses/kotlin-NOTICE.txt). Generated distributions carry their own combined notice.
- The FOSS2 application retains [its MIT license](ottplay-foss2/LICENSE) and detailed [resource provenance and dependency notices](ottplay-foss2/THIRD-PARTY-NOTICES.md). Media engines, polyfills and font assets retain the terms recorded there and in their adjacent license files. A root MIT grant does not relicense those components.
- Vendored release/control helpers originating in [venus-os-ci-toolkit](https://github.com/victron-venus/venus-os-ci-toolkit) retain that project's [MIT notice](LICENSES/venus-os-ci-toolkit-MIT.txt).
- Repositories referenced by `checkouts.json`, downloaded dependencies and operator-supplied media are separately maintained material. Their licenses, ownership and redistribution requirements do not change here.

## Removed resources

Unused FOSS2 Fontello icon resources and their CSS declaration were removed because complete glyph provenance was not established. The interface uses text commands; the six licensed text-font filenames remain. Historical copies in Git are not relicensed by the root MIT grant. The remaining security assessment is independent of this licensing cleanup.
