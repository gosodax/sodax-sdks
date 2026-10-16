# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.** The `@sodax/*` packages ship in wallets and dapps that move user funds; a public report puts those users at risk before a fixed release exists.

Report privately, via either:

1. **GitHub private vulnerability reporting** — [open a draft security advisory](https://github.com/icon-project/sodax-sdks/security/advisories/new) (preferred; keeps the report attached to the repo), or
2. **Email** — `tech-alerts@sodax.com` (mark the subject **SECURITY**) with a clear description and reproduction steps.

Please include: the affected package and version, impact, reproduction steps, and any relevant chain/tx references. Do **not** include secrets or live keys in the report.

## What to expect

- We aim to acknowledge a report within a few business days.
- We'll confirm the issue, keep you updated on remediation, and coordinate disclosure timing.
- A fix ships as a new release of the affected package. We publish the advisory once that release is out and consumers have had a chance to upgrade.
- Please give us reasonable time to remediate before any public disclosure.

## Recognition, not payment

SODAX does not run a paid bug bounty for this repository. There is no reward pool, and we would rather say so plainly than leave it ambiguous. What we do offer is credit: with your permission we name you — or your handle — in the pull request that carries the fix and in the release notes for the version that ships it.

## Scope

This policy covers the code in this repository: the published `@sodax/*` packages under `packages/`, the reference and example apps under `apps/` that integrators copy from, the tooling that builds, tests and releases them (`.github/workflows/`, `scripts/`), and the documentation under `docs/` that builds docs.sodax.com — an example or a page that leads an integrator into an unsafe pattern is in scope here, not just library code.

Out of scope for this repo, and routed elsewhere:

- **Smart contracts** — the deployed SODAX contracts and their audits.
- **Backend services, APIs and infrastructure** — including where a demo is hosted, as distinct from its source under `apps/`.

For either, email `tech-alerts@sodax.com` and a maintainer will route the report: both live in private repositories, so neither can take an advisory or a public issue from outside the organisation.

If you are unsure which side of a boundary a finding falls on, report it anyway and say so — we would rather re-route a report than miss one.

## Security issue, or ordinary bug?

Both are worth reporting. The difference is *where*: a security issue goes through the private channels above, an ordinary bug goes in a public issue like any other.

Treat it as a security issue when it can lead to:

- **Loss or theft of funds** — a flow that can be made to move, lock or misdirect a user's assets.
- **Unauthorised access** — bypassing an allowance, ownership or permission check, or acting on behalf of another account.
- **Key or signature flaws** — key or mnemonic material logged, leaked or reused; a signature that can be replayed, forged or re-scoped to a payload the signer did not agree to.
- **Relay or intent integrity** — a way to forge, replay, censor or misattribute an intent or relay message so a cross-chain flow settles other than as intended.
- **Supply-chain compromise** — a malicious or hijacked dependency, or anything that would let unreviewed code reach a published tarball.

Everything else is a normal issue, including:

- **Correctness defects** — a wrong quote, amount, decimal, address or type; a flow that fails or returns the wrong result.
- **Availability defects** — a crash, hang, unhandled rejection, memory leak or a broken RPC fallback.

A correctness or availability defect can still be a security issue if it is *reachable by an attacker and profitable to them* — an amount an untrusted input can steer, or a check that can be made to pass. If that is the case, say how in a private report.
