#!/usr/bin/env bash
# Fail PRs that change packages/*/src without a related mapped doc, README, or packages/<pkg>/docs/.
# Usage: check-docs-drift.sh <base-ref> [head-ref]

set -euo pipefail

BASE_REF="${1:?usage: check-docs-drift.sh <base-ref> [head-ref]}"
HEAD_REF="${2:-HEAD}"
RANGE="$BASE_REF...$HEAD_REF"
MAP_FILE="scripts/docs-pages-map.json"

# Without this, non-ASCII paths are C-quoted and miss the ^packages/ anchors.
# --no-renames keeps the source side: a rename out of src/ (or into a test path)
# otherwise reports only the destination and hides the package entirely.
CHANGED=$(git -c core.quotePath=false diff --name-only --no-renames "$RANGE")
# ACMR = added/copied/modified/renamed. Deletions are not a docs signal.
UPDATED=$(git -c core.quotePath=false diff --name-only --diff-filter=ACMR "$RANGE")

PKGS=$(echo "$CHANGED" \
  | grep -E '^packages/[^/]+/src/' \
  | grep -vE '\.(test|spec)\.(ts|tsx|mts|cts)$' \
  | grep -v '/e2e-tests/' \
  | cut -d/ -f2 | sort -u | grep -vx 'skills' || true)

# Renames keep their source path, so an in-place rename of a deliberately unpublished
# page is not forced onto the map. A move in from elsewhere reports as an add.
ADDED_SDK_DOCS=$(git -c core.quotePath=false diff --name-only --diff-filter=A \
  "$RANGE" -- 'packages/sdk/docs' || true)
RENAMED_SDK_DOCS=$(git -c core.quotePath=false diff --name-status --diff-filter=R \
  "$RANGE" -- 'packages/sdk/docs' || true)

# Membership checks use here-strings, not producer pipelines: under pipefail a
# huge list can SIGPIPE the producer when grep -q exits early, faking a non-match.
is_mirrored() {
  grep -qxF "$1" <<< "$MIRRORED_SRCS"
}

was_published() {
  grep -qxF "$1" <<< "$BASE_MIRRORED_SRCS"
}

# Declared as deliberately-not-published-yet, so the gate lets it exist off the map.
is_unpublished() {
  grep -qxF "$1" <<< "$UNPUBLISHED_PAGES"
}

is_doc_page() {
  case "$1" in
    *.md | *.mdx) return 0 ;;
  esac
  return 1
}

# Mapped file for this package, any mapped packages/sdk/docs/ page (covers types/sdk/dapp-kit),
# or a mapped root docs/ page whose pkgs entry lists this package.
covers_pkg() {
  local path="$1" pkg="$2"
  is_mirrored "$path" || return 1
  case "$path" in
    packages/"$pkg"/*) return 0 ;;
    packages/sdk/docs/*) return 0 ;;
  esac
  grep -qxF "${pkg}"$'\t'"${path}" <<< "$PKG_COVERAGE"
}

# Doc paths from one array of the map at a ref: mirrored holds {src, dest} objects,
# unpublished holds bare paths. Strict at HEAD, where a malformed map must fail the
# PR; tolerant at the base, whose map predates any rule this PR adds.
read_map_paths() {
  git show "$1:$MAP_FILE" | python3 -c '
import json, sys

key = sys.argv[1]
strict = sys.argv[2] == "strict"

def reject(message):
    if strict:
        print(message, file=sys.stderr)
        sys.exit(1)

# A map the caller cannot read at all is not a map with no entries: exit nonzero
# even when tolerant, so the base read fails closed instead of reporting nothing.
def unreadable(message):
    print(message, file=sys.stderr)
    sys.exit(1 if strict else 2)

try:
    data = json.load(sys.stdin)
except ValueError:
    unreadable("::error::scripts/docs-pages-map.json is not valid JSON.")

if not isinstance(data, dict):
    unreadable("::error::scripts/docs-pages-map.json must be a JSON object.")

for item in data.get(key, []):
    path = item.get("src") if isinstance(item, dict) else item
    if path is None or path == "":
        continue
    if not isinstance(path, str) or any(c in path for c in "\n\r\t\0"):
        reject(f"::error::scripts/docs-pages-map.json {key} entry must be a single-line, tab-free path.")
        continue
    # Markdown only: otherwise a PR could map its own changed source file and self-satisfy the gate.
    if not path.endswith((".md", ".mdx")):
        reject(f"::error::scripts/docs-pages-map.json {key} entry must be a .md or .mdx page: {path}")
        continue
    print(path)
' "$2" "$3"
}

load_map() {
  if ! git cat-file -e "$HEAD_REF:$MAP_FILE" 2>/dev/null; then
    echo "::error::$MAP_FILE is missing at $HEAD_REF — cannot verify mirrored docs."
    exit 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "::error::python3 is required to read $MAP_FILE."
    exit 1
  fi

  MIRRORED_SRCS=$(read_map_paths "$HEAD_REF" mirrored strict)
  UNPUBLISHED_PAGES=$(read_map_paths "$HEAD_REF" unpublished strict)

  # The base map is what tells a rename of a published page apart from a rename of
  # one that was never published; unreadable means fall back to requiring the map.
  BASE_MAP_READABLE=0
  BASE_MIRRORED_SRCS=""
  if git cat-file -e "$BASE_REF:$MAP_FILE" 2>/dev/null; then
    if BASE_MIRRORED_SRCS=$(read_map_paths "$BASE_REF" mirrored tolerant 2>/dev/null); then
      BASE_MAP_READABLE=1
    else
      echo "::warning::$MAP_FILE is unreadable at $BASE_REF — every renamed page must carry a map entry."
      BASE_MIRRORED_SRCS=""
    fi
  fi

  # pkgs is checked against the real package dirs at HEAD — read from git, not the
  # filesystem, so the gate behaves the same on an arbitrary range. A typo'd name
  # would otherwise pass the pattern check and silently cover no package at all.
  PKG_DIRS=$(git ls-tree -d --name-only "$HEAD_REF:packages" 2>/dev/null || true)

  # pkg<TAB>src pairs from entries that opt into package coverage via pkgs.
  PKG_COVERAGE=$(git show "$HEAD_REF:$MAP_FILE" | PKG_DIRS="$PKG_DIRS" python3 -c '
import json, os, re, sys
dirs = set(os.environ["PKG_DIRS"].split("\n"))
data = json.load(sys.stdin)
for item in data.get("mirrored", []):
    src = item.get("src")
    pkgs = item.get("pkgs")
    if not isinstance(src, str) or src == "" or pkgs is None:
        continue
    if not isinstance(pkgs, list) or not pkgs or not all(
        isinstance(p, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", p) for p in pkgs
    ):
        print("::error::scripts/docs-pages-map.json pkgs must be a non-empty array of package directory names.", file=sys.stderr)
        sys.exit(1)
    for p in pkgs:
        if p not in dirs:
            print(f"::error::scripts/docs-pages-map.json pkgs names a package that does not exist: {p} (in {src})", file=sys.stderr)
            sys.exit(1)
        print(f"{p}\t{src}")
')
}

load_map

MISSING_MAPPED=""
while IFS= read -r src; do
  [ -z "$src" ] && continue
  if ! git cat-file -e "$HEAD_REF:$src" 2>/dev/null; then
    MISSING_MAPPED="$MISSING_MAPPED $src"
  fi
done <<< "$MIRRORED_SRCS"

if [ -n "$MISSING_MAPPED" ]; then
  echo "::error::Mapped src(s) are missing at $HEAD_REF:$MISSING_MAPPED"
  echo "If you moved or renamed the page, point the src entry in $MAP_FILE at its new path."
  echo "Only delete the entry if the page is gone for good — deleting one that carries"
  echo "pkgs also drops the Docs Drift coverage those packages rely on."
  echo "See CONTRIBUTING.md#documentation."
  exit 1
fi

UNMAPPED_NEW=""
while IFS= read -r added; do
  [ -z "$added" ] && continue
  if is_doc_page "$added" && ! is_mirrored "$added" && ! is_unpublished "$added"; then
    UNMAPPED_NEW="$UNMAPPED_NEW $added"
  fi
done <<< "$ADDED_SDK_DOCS"

UNPUBLISHED_RENAME=""
while IFS=$'\t' read -r _status from to; do
  [ -z "$to" ] && continue
  if ! is_doc_page "$to" || is_mirrored "$to"; then
    continue
  fi
  case "$from" in
    packages/sdk/docs/*) ;;
    *)
      # Moved in from elsewhere: a new page here, so the same two-list rule applies.
      if ! is_unpublished "$to"; then
        UNMAPPED_NEW="$UNMAPPED_NEW $to"
      fi
      continue
      ;;
  esac
  # A page that was never on the map stays unpublished under its new name; only one
  # that was mapped before this PR gets taken down by renaming it off the map.
  if [ "$BASE_MAP_READABLE" -eq 0 ] || was_published "$from"; then
    UNPUBLISHED_RENAME="$UNPUBLISHED_RENAME $from -> $to"
  fi
done <<< "$RENAMED_SDK_DOCS"

if [ -n "$UNMAPPED_NEW" ]; then
  echo "::error::New SDK doc(s) are not in $MAP_FILE:$UNMAPPED_NEW"
  echo "To publish one, add it to \"mirrored\" — every mapped src is published — and give"
  echo "it a nav entry in docs/docs.json, or it is live but absent from sidebar and search."
  echo "Not ready to publish? Add it to \"unpublished\" and map it in a follow-up."
  echo "See CONTRIBUTING.md#documentation."
  exit 1
fi

if [ -n "$UNPUBLISHED_RENAME" ]; then
  echo "::error::Renamed SDK doc(s) dropped off $MAP_FILE:$UNPUBLISHED_RENAME"
  echo "Point the src entry at the new path so the page keeps publishing."
  echo "Renaming a page on the \"unpublished\" list (DEX.md, ORACLE.md, …) needs no map entry."
  echo "See CONTRIBUTING.md#documentation."
  exit 1
fi

if [ -z "$PKGS" ]; then
  echo "No package source changes — docs check not applicable."
  exit 0
fi

MISSING=""
for PKG in $PKGS; do
  if ! [[ "$PKG" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    MISSING="$MISSING $PKG"
    continue
  fi
  if grep -qxF "packages/$PKG/README.md" <<< "$UPDATED"; then
    continue
  fi
  if [ "$PKG" != "sdk" ] && grep -qE "^packages/${PKG}/docs/" <<< "$UPDATED"; then
    continue
  fi
  HAS_RELATED_MIRROR=0
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if covers_pkg "$path" "$PKG"; then
      HAS_RELATED_MIRROR=1
      break
    fi
  done <<< "$UPDATED"
  if [ "$HAS_RELATED_MIRROR" -eq 1 ]; then
    continue
  fi
  MISSING="$MISSING $PKG"
done

if [ -n "$MISSING" ]; then
  echo "::error::Source changed in:$MISSING — but no publishable docs were updated."
  echo "Update a mapped file for that package (packages/<pkg>/… in $MAP_FILE),"
  echo "a packages/sdk/docs/ page on the map, a mapped root docs/ guide whose"
  echo "pkgs entry lists the package, the package README, or"
  echo "packages/<pkg>/docs/ (non-sdk packages)."
  echo "JSDoc, packages/skills, and \"unpublished\" sdk/docs pages (DEX.md, ORACLE.md, …) do not count."
  echo "An unrelated mapped file (e.g. packages/skills/README.md) does not satisfy another package."
  echo "Deleting a README, mapped page, or packages/<pkg>/docs/ file does not count."
  echo "If this PR truly has no user-facing change, ask a maintainer for the 'docs-not-needed' label."
  echo "See CONTRIBUTING.md#documentation for guidance."
  exit 1
fi

echo "All changed packages ship a docs signal. ✓"
