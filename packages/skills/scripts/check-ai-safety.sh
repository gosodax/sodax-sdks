#!/usr/bin/env bash
#
# CI guard against unsafe fund-moving patterns in consumer-facing code examples. Agents copy
# these blocks verbatim, so a zero minimum output or a skipped simulation in an example ships
# straight into user code. Scans fenced code blocks in skills/**/*.md plus the standalone
# .tsx examples; prose may name the patterns (e.g. to forbid them).
#
# Opt-out: `ai-safety-allow` in a comment on the same line.

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/skills/

python3 - <<'PY'
import re
import sys
from pathlib import Path

# Slippage floors across features: min*Amount / min*Out(put) / min*Received / minReceive, and the
# DEX amount0Min / amount1Min. Object keys (quoted or not) and assignments (`const x = 0n`, which a
# later `{ x }` shorthand would send) both count. Only a zero literal is flagged.
FLOOR = r"(?i:min[a-z_]*(?:amount|out|output|received|receive)[a-z_]*|amount[a-z0-9]*min(?:imum)?)"
ZERO = r"(?:0n|0|'0'|\"0\"|BigInt\(\s*(?:0|'0'|\"0\")\s*\))"
TYPE = r"(?::\s*[\w.<>\[\]| ]+?\s*)?"  # `const x: bigint = 0n`
END = r"(?:\s*(?:[,;)}\]]|//|/\*|$)|\s+(?:as|satisfies)\b)"
RULES = [
    (re.compile(rf"\b{FLOOR}[\"']?\s*{TYPE}[:=]\s*{ZERO}{END}"),
     "zero minimum output — derive it from a live quote minus slippage"),
    (re.compile(r"\bskipSimulation[\"']?\s*[:=]\s*true\b"),
     "skipSimulation: true — the simulation catches an intent that would revert before the user signs"),
]
ALLOW = "ai-safety-allow"
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")

def code_lines(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    if path.suffix == ".tsx":
        yield from enumerate(lines, 1)
        return
    opener = None  # the fence that opened the current block: a longer or different fence inside it is content
    for n, line in enumerate(lines, 1):
        m = FENCE.match(line)
        if opener is None:
            if m:
                opener = m.group(1)
            continue
        if m and m.group(1)[0] == opener[0] and len(m.group(1)) >= len(opener) and not line.strip()[len(m.group(1)):]:
            opener = None
            continue
        yield n, line

problems = []
files = sorted(Path("skills").rglob("*.md")) + sorted(Path("skills").rglob("*.tsx"))
for path in files:
    for n, line in code_lines(path):
        if ALLOW in line:
            continue
        for rx, why in RULES:
            if rx.search(line):
                problems.append(f"{path}:{n}: {why}\n    {line.strip()}")

if problems:
    print("\n".join(problems), file=sys.stderr)
    print(f"\ncheck-ai-safety: {len(problems)} problem(s)", file=sys.stderr)
    sys.exit(1)
print(f"check-ai-safety: OK ({len(files)} files)")
PY
