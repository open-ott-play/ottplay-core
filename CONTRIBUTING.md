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

### Automatic pull request reviews

The installed Greptile GitHub App reviews eligible pull requests when they open,
receive pushes or are rebased. [`.greptile/config.json`](.greptile/config.json)
records these triggers and enables the native status check and status comments.
The app leaves pull request descriptions unchanged. No GitHub Actions workflow
or repository API secret is needed for this integration.

The repository config deliberately leaves the existing Greptile dashboard
filters and base review tier in place. Drafts are skipped, and the dashboard's
excluded authors, including `californiantiramisu`, remain excluded. Opening or
updating an eligible, non-draft pull request should produce a Greptile status
check and review activity; inspect the app installation and dashboard filters
first if it does not.

After a push, confirm a new `Greptile Review` check belongs to the pull request's
current head commit and that the review summary's last-reviewed commit matches.
A successful check on an earlier commit does not verify the latest changes.
See the [configuration reference](https://www.greptile.com/docs/code-review/greptile-config-reference)
for trigger and status settings.

The Greptile check is advisory, not a required merge check. A successful check
means the review completed; it does not guarantee that the review found no
issues. Read and address its findings alongside the existing required checks
and independent review policy above.

## Contribution rights

Contribute original material under the root MIT license only when you have the right to do so. Preserve third-party attribution and license terms; record imported code and assets in THIRD_PARTY_NOTICES.md or the linked component notices. A public download URL alone is not a redistribution license.

See [governance](GOVERNANCE.md), [conduct](CODE_OF_CONDUCT.md) and the
[roadmap](ROADMAP.md). Major functionality changes require meaningful automated
regression coverage and relevant negative cases, with test invocation documented
in the pull request. The same automation exception above applies: explain why automation is infeasible and document a reproducible
manual procedure and its limitations in the pull request.
