# Security design and verification

## Scope and trust boundaries

The project provides the shared Kotlin domain core, FOSS2 browser client and cross-repository wire contracts.

Platform adapters own networking, parsing, storage and cryptography; the shared core owns domain decisions. Preserve the explicit boundary when importing source data or generating consumer artifacts. The FOSS2 relay accepts exact operator-approved origins, revalidates redirects/DNS, bounds bodies and pins resolved addresses. Its transport destination comes from the allowlist. Local parental PINs use a project-owned legacy SHA-256 implementation and 2048 iterations; this is a deterrent for old TVs, not a password vault or protection against a device owner. Creating or changing a PIN requires a cryptographically secure random source for its 128-bit salt; browsers without one fail closed and can still verify an existing PIN.

## Source and operating documentation

- [shared-core/README.md](../shared-core/README.md)
- [CORE-DELIVERY.md](../CORE-DELIVERY.md)
- [ottplay-foss2/scripts/relay.cjs](../ottplay-foss2/scripts/relay.cjs)
- [ottplay-foss2/src/security.js](../ottplay-foss2/src/security.js)

## Regression evidence

- [ottplay-foss2/tests/test-relay.cjs](../ottplay-foss2/tests/test-relay.cjs)
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
