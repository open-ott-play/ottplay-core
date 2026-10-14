# Changelog

## [0.1.0]

- Publish the existing compiled JVM17 JAR, ES5 JavaScript, declarations, source
  manifest and original license notices through the shared beta/RC pipeline.
- Add bounded offline RC fuzzing of the actual Kotlin playlist parser and guide
  timeline exports, with retained corpus, mutation logs and release evidence.
- Preserve input order when programme start times compare equal, including
  negative and positive zero, so requesting one or several future programmes
  returns a consistent prefix. Add the discovered input as a regression seed
  and test the common fix on both JVM and JavaScript.
- Qualify release candidates with the existing portable, browser-consumer and
  wire checks without invoking consumer delivery.

### Upgrade

This is the first `v0.1.0-*` release line for the compiled shared-core package;
FOSS2 retains its independent `foss2-*` version and release process. No consumer
repository or running application is updated by publishing these files.
Select a candidate explicitly and keep its JVM/ES5 files, declarations,
license notices and manifest together. Review the consuming application's
compatibility checks before integrating it. For a local reproduction, use the
exact source commit and synchronize its frozen version plan as described in
`docs/CORE-RELEASING.md` in that source checkout.

### Security

The new offline RC campaigns exercise malformed playlist data and guide timing
boundaries in the actual compiled core. The equal-time ordering correction is
a consistency fix; it does not change authentication, network access or provider
URL policy. Keep the consuming application's input and access controls enabled;
this package does not perform a device deployment or establish device acceptance.

## Unreleased

### Security

- Require OpenSSL security level 2 or an explicitly stronger configured policy
  in the FOSS2 Node relay and EPG downloader. Weak upstream certificates and CA
  chains now fail before HTTP or authentication data is sent. Keep isolated TLS
  handshakes for every request; operators must renew weak upstream certificates
  rather than disabling verification. This changes no shared-core wire schema.

- Refuse to create or change a parental PIN when secure randomness is missing,
  fails or returns invalid bytes. Existing PIN verification remains available;
  older browsers need Web Crypto before setting a new PIN. Remove the predictable
  clock/counter salt fallback and explain the requirement in the interface.
- Build FOSS2 relay transport destinations from operator-approved origins;
  only the path/query comes from the validated request. Existing exact-origin,
  redirect, DNS pinning and private-address checks remain required.
- Return a fixed error code from the loopback SWOP test server, keeping exception
  details in the local test log.
- Refresh FOSS2 `source-map-js` to 1.2.2 and pin Kotlin/JS test-tool dependencies
  `serialize-javascript` to 7.0.5 and `diff` to 8.0.3. Regenerate/install the
  checked-in npm lockfiles before testing. The core wire schema is unchanged.

### Maintenance

- Document contribution/testing rules, security boundaries and partial OpenSSF
  evidence, including the remaining license-scope and legacy parental-PIN
  cryptography questions. No certification or consumer rollout is implied.
