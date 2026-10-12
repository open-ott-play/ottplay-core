# Security design and verification

## Scope and trust boundaries

The project provides the shared Kotlin domain core, FOSS2 browser client and cross-repository wire contracts.

Platform adapters own networking, parsing, storage and cryptography; the shared core owns domain decisions. Preserve the explicit boundary when importing source data or generating consumer artifacts. The FOSS2 relay accepts exact operator-approved origins, revalidates redirects/DNS, bounds bodies and pins resolved addresses. Its transport destination comes from the allowlist. Local parental PINs use a project-owned legacy SHA-256 implementation and 2048 iterations; this is a deterrent for old TVs, not a password vault or protection against a device owner. Creating or changing a PIN requires a cryptographically secure random source for its 128-bit salt; browsers without one fail closed and can still verify an existing PIN.

## Node HTTPS transport profile

Run the FOSS2 Node services on a supported Node 22 or newer runtime. The relay
and default EPG downloader require [OpenSSL security level 2](https://docs.openssl.org/3.5/man3/SSL_CTX_set_security_level/) for HTTPS, preserving
the configured cipher selection and any explicitly higher `@SECLEVEL` in
`tls.DEFAULT_CIPHERS`. This rejects RSA certificates below 2048 bits and EC
certificates below 224 bits throughout the verified chain. Normal certificate
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
- [shared-core/src/commonTest](../shared-core/src/commonTest)

Run the documented commands in [CONTRIBUTING.md](../CONTRIBUTING.md) and the
[CI workflow](../.github/workflows/core.yml). Preserve negative tests for rejected inputs,
unavailable dependencies, authorization failures and cancellation. A passing
test run describes its fixtures and environment; it does not certify every
upstream service, hardware model or production deployment.

## Remaining security assessment

MIT grants exist in shared-core and FOSS2, but root tooling/contracts need an explicit license scope. Project-owned parental PIN cryptography prevents blindly asserting crypto_call/crypto_password_storage. Complete the criteria review before claiming a badge.

Report new issues through [SECURITY.md](../SECURITY.md). An OpenSSF assessment
records evidence and applicability; it is not a guarantee that a system is safe.
