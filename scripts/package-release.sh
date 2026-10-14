#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# != 2 ]]; then
  echo 'Usage: scripts/package-release.sh BASE_VERSION CHANNEL' >&2
  exit 2
fi
if [[ ! -f "${RELEASE_VERSION_PLAN:-.release-plan.json}" ]]; then
  echo 'Local candidate packaging requires the exact-source frozen release plan.' >&2
  exit 1
fi
python3 scripts/release_version_adapter.py "$1" "$2" >/dev/null
if [[ -e release-dist ]]; then
  echo 'Refusing to replace an existing release-dist directory.' >&2
  exit 1
fi
npm ci --ignore-scripts --prefix shared-core
npm --prefix shared-core run pack:core
npm --prefix shared-core run check:core
npm --prefix shared-core run check:js
python3 scripts/package_core_release.py
