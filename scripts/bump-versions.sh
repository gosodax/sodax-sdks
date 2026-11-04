#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PACKAGES=(types libs swaps-api bridge-api skills wallet-sdk-core sdk wallet-sdk-react dapp-kit )
TYPES_INDEX="packages/types/src/index.ts"

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
  read -rp "New version (e.g. 0.0.1 or 0.0.1-rc.1): " NEW_VERSION
fi

# Matches scripts/config-version.mjs's VERSION_PATTERN: no leading zeros, so a standalone run of this
# script cannot write a version the deriver would then refuse.
if [[ ! "$NEW_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]]; then
  echo "Error: '$NEW_VERSION' is not a valid version. Expected X.Y.Z or X.Y.Z-rc.N (digits only, no leading zeros)." >&2
  exit 1
fi

# Anchored: an unanchored pattern also matches an identifier ending in CONFIG_VERSION (MIN_CONFIG_VERSION,
# …), and `head -n1` would then read the wrong constant while the write clobbered both.
CV_ANCHOR='export const CONFIG_VERSION = '
CURRENT_CV=$(sed -nE "s/^${CV_ANCHOR}([0-9_]+);.*/\1/p" "$TYPES_INDEX" | tr -d _)
if [[ ! "$CURRENT_CV" =~ ^[0-9]+$ ]]; then
  echo "Error: could not read CONFIG_VERSION from $TYPES_INDEX" >&2
  exit 1
fi

# @sodax/types owns the formula; this derives through it so the two can never disagree.
NEW_CV=$(node "$REPO_ROOT/scripts/config-version.mjs" "$NEW_VERSION") || exit 1

for pkg in "${PACKAGES[@]}"; do
  f="packages/$pkg/package.json"
  sed -i.bak -E "s/(\"version\": *)\"[^\"]*\"/\1\"$NEW_VERSION\"/" "$f"
  rm "$f.bak"
  if ! grep -q "\"version\": \"$NEW_VERSION\"" "$f"; then
    echo "Error: sed did not update version field in $f as expected" >&2
    exit 1
  fi
  echo "  $f → $NEW_VERSION"
done

sed -i.bak -E "s|^${CV_ANCHOR}[0-9_]+;.*|${CV_ANCHOR}$NEW_CV; // $NEW_VERSION|" "$TYPES_INDEX"
rm "$TYPES_INDEX.bak"
if ! grep -qx "export const CONFIG_VERSION = $NEW_CV; // $NEW_VERSION" "$TYPES_INDEX"; then
  echo "Error: sed did not update CONFIG_VERSION in $TYPES_INDEX as expected" >&2
  exit 1
fi
echo "  $TYPES_INDEX → CONFIG_VERSION $CURRENT_CV → $NEW_CV ($NEW_VERSION)"

echo ""
echo "Done. Called by scripts/release.mjs, which prints the commit and tag steps."
