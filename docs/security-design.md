# Security design and verification

## Scope and trust boundaries

The project provides the shared Kotlin domain core, FOSS2 browser client and cross-repository wire contracts.

Platform adapters own networking, parsing, storage and cryptography; the shared core owns domain decisions. Preserve the explicit boundary when importing source data or generating consumer artifacts. The FOSS2 relay accepts exact operator-approved origins, revalidates redirects/DNS, bounds bodies and pins resolved addresses. Its transport destination comes from the allowlist.

FOSS2 parental PINs control local playback and configuration access. They are not
provider credentials and do not encrypt browser storage. A device owner, injected
same-origin script or browser-storage editor can bypass this local control.
New verifiers use the browser's native PBKDF2-HMAC-SHA-256 implementation,
600,000 iterations, a random 128-bit salt and a 256-bit output. This follows the
[OWASP PBKDF2 recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
using the [standard Web Crypto API](https://www.w3.org/TR/webcrypto/#pbkdf2).
PINs remain 4–12 decimal digits for remote-control entry; the slow verifier and
local cooldown do not make a short PIN resistant to a determined offline attack.

Legacy schema-1 verifiers are accepted only for authentication and immediate
migration. Their SHA-256 digest operations also use Web Crypto; the project-owned
SHA-256 primitive is removed. No new or changed PIN is stored in the old format.
Schema 2 identifies the algorithm, salt, hash and bounded integral work factor;
both Kotlin and JavaScript reject unknown formats and non-finite work factors.
The [migration guide](../ottplay-foss2/docs/PARENTAL-CONTROLS.md) documents the
durable write barrier, old-client lock, cancellation and recovery behavior.
Browsers without the required secure-context API cannot check or change an
existing PIN; protection is preserved. There is no weak hashing fallback.

## Node HTTPS transport profile

Run the FOSS2 Node services on a supported Node 22 or newer runtime. The relay
and default EPG downloader require [OpenSSL security level 2](https://docs.openssl.org/3.5/man3/SSL_CTX_set_security_level/) for HTTPS, preserving
the configured cipher selection and any explicitly higher `@SECLEVEL` in
`tls.DEFAULT_CIPHERS`. This rejects low effective-strength keys, but does not establish an exact
2048-bit RSA floor: OpenSSL can admit a 2047-bit key under this level. Full-chain
exact-bit boundary qualification remains incomplete. Normal certificate
trust and hostname checks remain enabled. Upgrade an upstream server's weak
certificate or CA chain if these services report an upstream connection failure;
do not disable verification to restore connectivity.

Both services deliberately retain `agent: false` and accept no caller-supplied
TLS session. Each upstream request therefore performs a fresh handshake and
certificate check. Security level changes alone do not revalidate a session
previously established under a weaker policy; do not replace these isolated
connections with a shared session cache without a separate security review.
Tests prime and successfully resume the default agent's cache before checking
that these services reject weak chains and never reuse that session. The EPG
fixture redirects only its fixed endpoint to a loopback TLS server while keeping
its actual request options; the relay test uses its default transport.

This policy applies to HTTPS requests made by these Node services. It does not
secure an operator-enabled plaintext HTTP origin, a browser or TV network stack,
an external reverse proxy, or a downstream device. No deployment or hardware
verification is implied.

## Source and operating documentation

- [shared-core/README.md](../shared-core/README.md)
- [CORE-DELIVERY.md](../CORE-DELIVERY.md)
- [ottplay-foss2/scripts/relay.cjs](../ottplay-foss2/scripts/relay.cjs)
- [ottplay-foss2/src/security.js](../ottplay-foss2/src/security.js)

## Regression evidence

- [ottplay-foss2/tests/test-relay.cjs](../ottplay-foss2/tests/test-relay.cjs)
- [ottplay-foss2/tests/test-tls-policy.cjs](../ottplay-foss2/tests/test-tls-policy.cjs)
- [ottplay-foss2/tests/test-security.cjs](../ottplay-foss2/tests/test-security.cjs)
- [ottplay-foss2/tests/test-security-storage.cjs](../ottplay-foss2/tests/test-security-storage.cjs)
- [ottplay-foss2/tests/test-app.cjs](../ottplay-foss2/tests/test-app.cjs)
- [shared-core/src/commonTest](../shared-core/src/commonTest)

Run the documented commands in [CONTRIBUTING.md](../CONTRIBUTING.md) and the
[CI workflow](../.github/workflows/core.yml). Preserve negative tests for rejected inputs,
unavailable dependencies, authorization failures and cancellation. A passing
test run describes its fixtures and environment; it does not certify every
upstream service, hardware model or production deployment.

## Remaining security assessment

The root MIT grant now covers original tooling, contracts and documentation;
third-party terms remain separate. This parental-control change does not qualify
all network stacks, downstream clients or deployed hardware. Complete the whole
project's criteria review before claiming a badge. No TV latency or on-device
acceptance result is implied by synthetic Node/browser tests.

Report new issues through [SECURITY.md](../SECURITY.md). An OpenSSF assessment
records evidence and applicability; it is not a guarantee that a system is safe.
