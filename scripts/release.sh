#!/bin/bash
# Releases the workspace: every package publishes itself, then the root owns the commit and the tag.
#
# Usage:
#   scripts/release.sh 0.2.0
#   scripts/release.sh --dry-run --ci
set -euo pipefail
# release-it hooks and IDE runners get no Homebrew profile; the directory is absent on Linux
export PATH=/opt/homebrew/bin:$PATH

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/release.sh <version> | scripts/release.sh --dry-run --ci" >&2
  exit 1
fi

case " $* " in
  *" --dry-run "*) DRY_RUN=true ;;
  *) DRY_RUN=false ;;
esac

# without a version the packages bump a patch and the root asks the changelog plugin, publishing two
# different versions
if [ "${DRY_RUN}" = false ] && [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  echo "pass an explicit version, e.g. bun release 1.0.0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# Verification gate, before the first publish rather than after it
bun install --frozen-lockfile
# The website sits outside the root workspace and carries its own lockfile, and the typecheck
# reaches into it for `astro check` and the Astro type definitions.
bun install --frozen-lockfile --cwd website
bun run lint
bun run typecheck
bun run build
bun run specs
bun test

# without its probe the parity suite skips itself; build it and make a miss fatal
cmake -S packages/react-native-nitro-h3/cpp/test -B build/host -DCMAKE_BUILD_TYPE=Release
cmake --build build/host --target parity_probe -j
export H3_PARITY_PROBE="${ROOT}/build/host/parity_probe"
export H3_PARITY_REQUIRED=1
bun run --cwd packages/react-native-nitro-h3 parity

# Packages: `npm publish` only, no git operations
for pkg in packages/*; do
  [ -d "$pkg" ] || continue
  (cd "$pkg" && bun release "$@")
done

# Root: the version bump commit, the tag, the changelog and the GitHub release
bun run release-it "$@"
