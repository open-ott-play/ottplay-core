# Contributing

Use [GitHub issues](https://github.com/open-ott-play/ottplay-core/issues) for non-sensitive bug reports, questions and
feature proposals. Include the exact version/commit, environment, expected and
actual behavior, and a minimal sanitized reproduction. Check existing issues
first and keep follow-up evidence in the original thread. For vulnerabilities,
use the [private security process](SECURITY.md).

Submit a focused pull request against `main`. Describe the user-visible problem,
the resulting behavior, compatibility implications and checks performed. Preserve
existing authorship and third-party license/provenance records. Discuss changes
to protocols, storage, device safety or dependency/runtime requirements before
making an incompatible change. English is the common language for code review
and project documentation.

## Development and validation

```sh
python3 -m unittest discover -s scripts/tests -v
(cd shared-core && npm ci --ignore-scripts && ./gradlew --no-daemon jvmTest jsNodeTest)
(cd ottplay-foss2 && npm ci --ignore-scripts && npm test)
```

The README describes pinned consumer checkouts and full distribution verification. JVM/JS host tests, browser qualification, optional Apple targets and signed consumer delivery are separate. Regenerate Kotlin npm lockfiles from Gradle-generated build/js package metadata when changing dependency overrides.

The [CI workflow](.github/workflows/core.yml) is the authoritative list of required jobs.
Use isolated test data and temporary outputs. Never run a device write, unlock,
deployment or publication command merely to validate a documentation change.

## Test and review policy

Changes to behavior must add or update automated tests that fail for the old
defect and cover the new boundary; regression fixes should include the relevant
failure case. If automation is infeasible, explain why in the PR and document
the reproducible manual procedure and limits. Update user/API documentation and
release notes for user-visible changes. Keep compiler, lint, static-analysis and
test assertions enabled, resolve new warnings, and document any remaining
warning with its reason and scope. Do not suppress a real security finding to
obtain a passing check. Wait for required checks and independent review before
merging; do not use an administrator bypass.

## Contribution rights

Contribute original material under the root MIT license only when you have the right to do so. Preserve third-party attribution and license terms; record imported code and assets in THIRD_PARTY_NOTICES.md or the linked component notices. A public download URL alone is not a redistribution license.

See [governance](GOVERNANCE.md), [conduct](CODE_OF_CONDUCT.md) and the
[roadmap](ROADMAP.md). All major functionality changes require meaningful
automated regression coverage and relevant negative cases, with test invocation
and limitations documented in the pull request.
