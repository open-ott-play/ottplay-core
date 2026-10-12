# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/open-ott-play/ottplay-core/security/advisories/new).
If the form is unavailable, contact a maintainer through the repository's GitHub
profile to arrange a private channel before sharing sensitive details. Public
issues are for non-sensitive defects and feature requests.

Include the affected commit/release, prerequisites, a minimal synthetic
reproduction, expected and actual results, and impact. Do not include live
credentials, personal data or access to devices you do not own.

## Response and supported versions

Maintainers aim to acknowledge a private report within 14 days, investigate its
scope, and agree on remediation and disclosure with the reporter. If no reply
arrives within 14 days, follow up privately. Confirmed security defects are
prioritized by impact; critical defects take precedence over feature work.

Security fixes target the current default branch and latest published release,
where one exists. Older snapshots are not maintained security branches. Release
notes must identify security fixes, affected versions and upgrade actions without
disclosing credentials. This policy is a commitment for handling reports, not
a claim that no vulnerabilities exist or that past reports met a response SLA.

## Project boundary

This project provides the shared Kotlin domain core, FOSS2 browser client and cross-repository wire contracts.

Platform adapters own networking, parsing, storage and cryptography; the shared core owns domain decisions. Preserve the explicit boundary when importing source data or generating consumer artifacts. The FOSS2 relay accepts exact operator-approved origins, revalidates redirects/DNS, bounds bodies and pins resolved addresses. Its transport destination comes from the allowlist. Local parental PINs use a project-owned legacy SHA-256 implementation and 2048 iterations; this is a deterrent for old TVs, not a password vault or protection against a device owner.

See [security design and validation boundaries](docs/security-design.md).
