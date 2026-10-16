# Security scanning

The `Security` workflow (`.github/workflows/security.yml`) runs CodeQL, OSV-Scanner,
Semgrep, gitleaks and Dependency Review. This page covers the dependency scan, whose
shape is deliberate and easy to undo by accident.

## Why the OSV scan is split in two

OSV's advisory feed moves independently of this repo. An absolute scan over the whole
lockfile therefore fails on commits that changed no dependency: an advisory published
between a pull request's green run and its merge turns `main` red, and every open pull
request with it. That happened twice on 2026-09-03 — once for `fflate`, once for
`stream-json` and `toml`, the latter 39 minutes after the same lockfile scanned clean.

So the scan is two jobs with different jobs to do:

| Job | Trigger | Blocking | Reports to |
| --- | --- | --- | --- |
| `OSV-Scanner (new in PR)` | `pull_request` | yes | check annotations, job log |
| `OSV-Scanner (dependencies)` | `push`, `schedule` | no | Security > Code scanning |

The pull request job scans the base branch and the head in one job, against a single
advisory snapshot, and fails only where an advisory's occurrence count went **up** —
`osv-reporter --old --new`. A branch that adds a vulnerable dependency is blocked; a
branch that merely exists while the world learns something new is not.

The push and scheduled job scans everything and never fails the build. Its findings are
the backlog, and Code scanning is where they are triaged. **Do not make it blocking
again** — that is the state this split exists to leave behind.

Both scan steps carry `continue-on-error: true` so the reporter decides the outcome,
which would also hide a crashed scanner. The `Verify …` step after them fails the job
on a missing or empty result file, so a broken scan cannot pass silently.

## Accepting an advisory

Prefer a fix over an entry. In order:

1. **Override the dependency** in `pnpm-workspace.yaml` when a patched release exists and
   is old enough for `minimumReleaseAge`. Overriding past the range a parent declares is
   normal here — check the consumers still work, and say so in the inline comment.
2. **Add an `IgnoredVulns` entry** to `osv-scanner.toml` when the fix is unreachable
   (an ESM-only or engine-bumping major that would break its consumer) or the advisory
   does not cover the code path in use. Say which, concretely.

`pnpm update -r <pkg>` refreshes a transitive dependency to a new floor inside the range
its parents already declare, without re-resolving the whole tree.

In `trustPolicyExclude` pnpm keeps only the first entry per package name, so several
versions of one package go in a single entry joined with `||` — `"undici-types@6.19.8 || 6.21.0"`.

Every entry needs an `ignoreUntil` date, which osv-scanner enforces — past it, the
advisory is reported again. Use the date a cooldown lapses for a fix that is merely
waiting, and the quarterly re-triage date otherwise. An expired entry does not turn
`main` red; it reappears in Code scanning and blocks a pull request that would newly
introduce it. Re-triage on expiry rather than extending the date.

`group = "dev"` in a `PackageOverrides` entry does **not** work here: osv-scanner's
pnpm-lock extractor emits no dependency groups, so the entry silently matches nothing
and the advisory stays live. Dev-only dependencies still need per-advisory entries.

## Running it locally

```bash
curl -sLo osv-scanner https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_$(uname -s | tr 'A-Z' 'a-z')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
chmod +x osv-scanner && ./osv-scanner --recursive --format=table ./
```

It reads `pnpm-lock.yaml` directly, so no install is needed. `osv-reporter` — the diffing
half — ships only in the `ghcr.io/google/osv-scanner-action` image, so the pull request
job's exact behaviour is verified in CI rather than locally.
