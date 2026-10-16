# License scope and third-party notices

The root [MIT license](LICENSE) covers original project code, contracts, scripts and documentation. The owner confirmed the rights and this grant on 2026-10-16. It does not replace third-party copyright notices or grant rights to separately licensed or unlicensed material.

- The shared Kotlin core retains [its MIT license](shared-core/LICENSE). Kotlin runtime/compiler material retains the [Apache-2.0 license](shared-core/licenses/kotlin-LICENSE.txt) and [NOTICE](shared-core/licenses/kotlin-NOTICE.txt). Generated distributions carry their own combined notice.
- The FOSS2 application retains [its MIT license](ottplay-foss2/LICENSE) and detailed [resource provenance and dependency notices](ottplay-foss2/THIRD-PARTY-NOTICES.md). Media engines, polyfills and font assets retain the terms recorded there and in their adjacent license files. A root MIT grant does not relicense those components.
- Vendored release/control helpers originating in [venus-os-ci-toolkit](https://github.com/victron-venus/venus-os-ci-toolkit) retain that project's [MIT notice](LICENSES/venus-os-ci-toolkit-MIT.txt).
- Repositories referenced by `checkouts.json`, downloaded dependencies and operator-supplied media are separately maintained material. Their licenses, ownership and redistribution requirements do not change here.

## Unresolved distribution provenance

The existing FOSS2 resource notice records incomplete provenance for every Fontello glyph. Those legacy assets are not relicensed by this change. Their distribution needs a supported grant or removal/replacement after checking actual use. This open question and the remaining security assessment prevent treating the new root license alone as a completed OpenSSF assessment.
