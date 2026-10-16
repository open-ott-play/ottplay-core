# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/open-ott-play/ottplay-core/security/advisories/new).
If the form is unavailable, email **alvit.work@gmail.com** privately. Public
issues are for non-sensitive defects and feature requests.

Include the affected commit/release, prerequisites, a minimal synthetic
reproduction, expected and actual results, and impact. Do not include live
credentials, personal data or access to devices you do not own.

## Response and supported versions

Maintainers aim to acknowledge a private report within 14 days, investigate its
scope, and agree on remediation and disclosure with the reporter. If no reply
arrives within 14 days, follow up privately. Confirmed security defects are
prioritized by impact; critical defects are handled immediately. Known medium-or-higher
vulnerabilities in supported project results are fixed within 60 days of public
disclosure. If an upstream fix is unavailable, document a reviewed mitigation or
disable the affected supported path rather than claiming it is clean.

Security fixes target the current default branch and latest published release,
where one exists. Older snapshots are not maintained security branches. Release
notes must identify security fixes, affected versions, available CVE/GHSA
identifiers and upgrade actions without
disclosing credentials. Credit reporters of fixed vulnerabilities unless they
request anonymity, and coordinate disclosure before publishing private details.
This policy is a commitment for handling reports, not
a claim that no vulnerabilities exist or that past reports met a response SLA.

## Project boundary

This project provides the shared Kotlin domain core, FOSS2 browser client and cross-repository wire contracts.

Platform adapters own networking, parsing, storage and cryptography; the shared core owns domain decisions. Preserve the explicit boundary when importing source data or generating consumer artifacts. The FOSS2 relay accepts exact operator-approved origins, revalidates redirects/DNS, bounds bodies and pins resolved addresses. Its transport destination comes from the allowlist.

FOSS2 parental PINs use native Web Crypto PBKDF2-HMAC-SHA-256 with 600,000
iterations and a fresh 128-bit salt. Legacy verifiers migrate only after correct
authentication and confirmed storage. Unsupported Web Crypto environments stay
locked. This is local access control, not encrypted storage or a defense against
the device owner. Read the [upgrade and recovery guide](ottplay-foss2/docs/PARENTAL-CONTROLS.md)
before changing browser versions or restoring data.

See [security design and validation boundaries](docs/security-design.md).
