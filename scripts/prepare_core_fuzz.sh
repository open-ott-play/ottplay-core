#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Hosted Linux runners expose the preinstalled Temurin17 path. Local JDK17+
# also works; selecting the declared runner JDK avoids mutable default choices.
if [[ -n "${JAVA_HOME_17_X64:-}" ]]; then
  export JAVA_HOME="$JAVA_HOME_17_X64"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
java -version
npm ci --prefix shared-core --ignore-scripts --no-audit --no-fund
npm ci --prefix fuzz --ignore-scripts --no-audit --no-fund
npm --prefix shared-core run pack:core
npm --prefix shared-core run check:core
