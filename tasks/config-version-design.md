# Design: derive `CONFIG_VERSION` from the package version

**Status:** implemented on this branch — see the `feat(types): derive CONFIG_VERSION from the package
version` commit. This document is the design record behind it; where the two ever disagree, the code
and its tests are authoritative.
**Scope:** `packages/types/src/index.ts`, the release tooling in `scripts/`, and the publish workflows.

---

## 1. Why

`packages/types/src/index.ts:23` exports `CONFIG_VERSION`, one of the very few runtime values in the
otherwise type-only `@sodax/types`. Its job is SDK↔API drift detection: the backend returns `version`
from `GET /config/all` (`GetAllConfigResponseV2.version: number`) and `ConfigService.initialize()`
compares it against `CONFIG_VERSION`, falling back to the packaged defaults when they do not agree.

**The backend does not maintain this number — it re-exposes ours.** The API depends on the SODAX SDK
package and serves `CONFIG_VERSION` straight from it; there is no separate backend numbering, no column
storing it, and nothing for the backend team to agree to. `response.version` is therefore literally
"the `CONFIG_VERSION` of the SDK release the API has installed". That is what makes deriving the number
from the package version so natural: the comparison becomes *do the SDK and the API run the same
`@sodax/sdk` release?*, and the number is the release identifier that answers it.

**The compatibility rule is exact equality: `response.version !== CONFIG_VERSION` rejects.** This is
the selected policy and what the config-v2 enablement must implement. The commented-out code in
`ConfigService.ts:166` currently reads `response.version < CONFIG_VERSION` — an ordering test — and
that line is to be replaced, not preserved. The distinction drives the whole of section 3: **the
property the gate depends on is injectivity, not monotonicity.** Two different releases must never
produce the same number; whether one number is larger than another is not something equality asks.

Today it is a **stateful counter**, `+1` per release, bearing no relationship to the package version:

| | package version | `CONFIG_VERSION` |
| --- | --- | --- |
| `origin/main` | `2.0.0-rc.17` | `100` |
| `origin/release` (tip `d1ab2a7e`, tag `@sdks@2.2.0-rc.5`) | `2.2.0-rc.5` | `235` |

Three problems follow.

1. **The number carries no identity.** A counter can answer *whether* two sides match — `235 === 235`
   works fine — but not *what* they are mismatched with. When the gate rejects, the operator gets
   "236 vs 241" and no way to turn either number into a release without consulting the `release`
   branch's history. Under an equality rule that diagnostic is the whole of the debugging story, so
   the number being decodable stops being a nicety: `2_020_006` vs `2_030_099` reads directly as
   "the API is on 2.3.0, you are on 2.2.0-rc.6".
2. **The counter's only state lives on `release`.** `main` has never moved off `100` — `git log -S
   CONFIG_VERSION` finds two commits and neither changed the value. `scripts/release.mjs:355` carries
   an explicit warning about this: *"A stale release branch would bump from the wrong base and reuse
   the previous CONFIG_VERSION."* A wrong merge-conflict resolution on line 23 silently reuses or
   skips a number, and nothing catches it.
3. **Nothing verifies it.** `verifyMutation` in `release.mjs` asserts every manifest version against
   the release target — its stated doctrine is *"Assert what actually moved rather than trusting the
   bump script's unanchored seds"* — yet it never reads `CONFIG_VERSION`'s value.

**Goal:** make `CONFIG_VERSION` reflect the `package.json` version while still moving on every
release, so the equality gate is meaningful and the number becomes decodable.

**Core invariant:** distinct releases get distinct numbers — the encoding is injective over the
permitted version grammar. Strict monotonicity in semver order comes free with the chosen encoding and
is kept as a secondary property (it makes the numbers readable and lineage reasoning possible), but the
gate does not rely on it. Section 3 states both precisely and verifies them.

**Timing.** The consumer is entirely commented out behind `TODO(config-v2): enable once the config v2
endpoint is live` (`packages/sdk/src/shared/config/ConfigService.ts:158-185`). There is no live
runtime comparison today, which makes this the cheapest possible moment to change the encoding.

---

## 2. The encoding

```
CONFIG_VERSION = major * 1_000_000
               + minor *    10_000
               + patch *       100
               + (rc === null ? 99 : rc)

Domain — every field a hard throw at derivation time, never silent truncation:
  major in 1..99     minor in 0..99     patch in 0..99     rc in 0..98
  99 in the rc slot is the reserved sentinel for "stable"
  => CONFIG_VERSION is always in [1_000_000, 99_999_999]
```

Decode: `rc = n % 100` (99 means stable) · `patch = floor(n/100) % 100` ·
`minor = floor(n/10_000) % 100` · `major = floor(n/1_000_000)`, and **`null` for anything outside
`[1_000_000, 99_999_999]` or non-integer**. The bound is not decoration — see §3.

This is a base-100 positional numeral over `(major, minor, patch, rcSlot)`. Within the domain it is a
bijection, and strictly order-preserving under lexicographic ordering of those digits — which is
exactly semver ordering once stable maps to the top rc slot.

The version grammar is fixed to `X.Y.Z` / `X.Y.Z-rc.N` by `VERSION_PATTERN` (`scripts/release.mjs:7`),
so the encoding is order-isomorphic to semver: `encode(a) < encode(b)` iff `compareVersions(a, b) < 0`.
The deriver must use **that** pattern, not the looser one in `scripts/bump-versions.sh` — see §5.1.

A plausible forward history from the real switchover point, each row verified strictly greater than
the one above it:

| npm version | `CONFIG_VERSION` | |
| --- | --- | --- |
| *(today on `release`, legacy counter)* `2.2.0-rc.5` | `235` | the value being left behind |
| **`2.2.0-rc.6` — the real next release** | **`2_020_006`** | clears the counter by six orders of magnitude |
| `2.2.0-rc.7` | `2_020_007` | same triple, higher rc |
| `2.2.0` | `2_020_099` | stable outranks every rc of its triple |
| `2.2.1-rc.1` | `2_020_101` | next patch re-opens the rc range |
| `2.2.1` | `2_020_199` | |
| `2.3.0-rc.1` | `2_030_001` | patch field maxes at `99*100+99 = 9_999 < 10_000`, so no carry |
| `2.3.0` | `2_030_099` | |
| `2.10.0` | `2_100_099` | double-digit minor sorts above `2.3.x` — the string-compare trap |
| `3.0.0-rc.1` | `3_000_001` | |
| `3.0.0` | `3_000_099` | |

`main`'s stale manifest (`2.0.0-rc.17`) derives `2_000_017`, the value the switchover hand-edit must
use: below the next release's number, above the legacy counter.

The cap at major 99 (rather than the int32 limit of major 2146) keeps the whole range two orders of
magnitude inside int32 and makes the encode guard and the decode bound the same statement. Nothing
persists this number — the API serves it from the SDK package it imports — so the cap is about keeping
the decoder's domain closed and the digits readable, not about any storage width.

---

## 3. Correctness

### 3.1 The invariants, in priority order

- **(I0) injectivity — the one the gate depends on.** Distinct versions in the permitted grammar map
  to distinct numbers. Under `response.version !== CONFIG_VERSION`, a collision is the only way the
  gate can be *wrong in the dangerous direction*: two different releases sharing a number means the
  SDK accepts config built for a release it is not. **Guaranteed by construction and verified below.**
- **(I1) semver monotonicity** — `encode` is strictly order-preserving with respect to semver order.
  Free with this encoding, and retained deliberately: it is what makes the numbers readable, keeps
  lineage reasoning possible, and leaves the door open to a range-based policy later. The equality gate
  does not consult it.
- **(I2) publish-time monotonicity** — numbers increase in the order artifacts reach npm. Holds only
  while publishes happen in semver order: the unified `@sdks@` flow enforces that
  (`versionAdvanceErrors`, `scripts/release.mjs:273-288`), the per-package backport path does not.
  **Under exact equality this is no longer load-bearing at all** — see §11.

Restating the shift plainly, because it inverts what the old counter was for: the counter existed to
be *comparable*, and provided I2 and nothing else. The equality rule needs the number to be an
*identifier*, and an identifier's only hard requirement is uniqueness. That is why §3.3's caps are
described below as collision hazards first and ordering hazards second — under equality, a collision is
a correctness bug and an inversion is merely confusing.

### 3.2 Verification — run, not reasoned

A one-off design-time sweep, exhaustive over the full guarded digit space for majors 1–4:
**4,000,000 versions**, every minor 0–99 × patch 0–99 × rc 0–98 and stable, iterated in semver order.
(The permanent test suite carries the focused boundary and property version instead — see §9 A4/A4b.)

```
collisions          : 0     <- I0, the property the equality gate depends on
ordering violations : 0     <- I1
round-trip failures : 0     (decode(encode(v)) === v for all 4,000,000)
```

Majors 1–4 is a complete check of the digit space; the positional structure generalises upward, and
major is capped at 99 anyway. Injectivity is also structural, not incidental: the encoding is a
base-100 positional numeral, so distinct digit tuples cannot share a value while every digit stays
inside its field — which is exactly what §3.3's caps enforce.

The two ordering cases most often asked about (I1, verified even though the gate no longer reads it):

- same version, higher rc gives a higher number:
  `2.2.0-rc.5` `2020005` < `2.2.0-rc.6` `2020006` < `2.2.0-rc.17` `2020017`
- a higher version with no rc is never lower:
  `2.2.0-rc.98` `2020098` < `2.2.0` `2020099` < `2.3.0` `2030099` < `3.0.0` `3000099`

### 3.3 Every cap is load-bearing

At each boundary the scheme holds; one past it it breaks **silently**, with nothing to surface it at
runtime. Read the "breaks" column as collisions first: under exact equality a collision means the SDK
accepts config built for a different release, which is the one genuinely dangerous failure.

| | holds | breaks |
| --- | --- | --- |
| rc sentinel | `rc.98` `2020098` < `2.2.0` `2020099` | `rc.99` gives `2020099`, **colliding** with its own stable; `rc.100` gives `2020100`, **outranking** it |
| patch | `2.2.99` `2029999` < `2.3.0` `2030099` | `2.2.100` gives `2030099`, **carrying into the minor field** and colliding with `2.3.0` |
| minor | `2.99.0` `2990099` < `3.0.0` `3000099` | `2.100.0` gives `3000099`, **carrying into the major field** and colliding with `3.0.0` |
| major floor | `1.0.0-rc.0` gives `1000000`, the minimum, clearing every legacy value | a major-0 version lands anywhere in `0..999_999`, **overlapping the legacy counter's range** — `0.0.1` gives `199`, below the published `235` |

Every row produces a collision, and three of them also invert the ordering. This is the whole argument
for the release-time deriver **throwing** per field rather than truncating: a release must fail loudly
instead of shipping a number that another release already owns. Error messages should name the remedy —
`patch 100 outside 0..99 (bump the minor instead)`.

### 3.4 Decode must be bounded on both ends

This was a real defect in the first draft of this design. With only a lower bound,
`decode(Number.MAX_SAFE_INTEGER + 1)` returned `{major: 9007199254, …}` instead of `null`. The upper
bound fixes it. The input is not hostile — the API echoes our own constant — but it is not guaranteed
to be in this encoding either: an API running an older SDK serves a legacy counter value such as `235`,
and a proxy, a mock, or a misconfigured host can return anything at all. A decoder exported to
consumers (§4) must not answer a fabricated `{major: 9007199254, …}` in those cases. Verified `null`
for `235`, `100`, `0`, `-1`, `1.5`, `NaN`, `Infinity`, `-Infinity`, `999_999`, `100_000_000`,
`2**31`, and `MAX_SAFE_INTEGER + 1`.

**Exact equality already closes the hazard this bound was guarding.** Under an ordering gate, a
garbage-large `version` satisfies `>= CONFIG_VERSION` and the SDK adopts whatever config came with it;
under `!==`, any number that is not precisely ours is rejected, garbage-large included. The bound still
earns its place — `parseConfigVersion` and `formatConfigVersion` are exported to consumers (§4) and must
not hand back a fabricated `{major: 9007199254, …}` for a value outside the encoding — but it is a
correctness property of the decoder, no longer a load-bearing part of the gate.

### 3.5 Two properties the counter lacks

- **Idempotent.** Re-running `bump-versions.sh 2.2.0-rc.6` yields the same number; today a second run
  silently produces `237`.
- **Merge-conflict-proof.** Resolving line 23 either way stops mattering — the next `pnpm release`
  overwrites it deterministically and the checks catch a wrong resolution.

---

## 4. Consumer-facing surface

Decoding must **ship**, not just exist in the release tooling. Once the number encodes the version,
consumers want to read it back: an app showing "SDK 2.2.0-rc.6" in a debug panel or a bug report, and
`ConfigService` logging something legible instead of two opaque integers.

Today `@sodax/types` exports no version identity at all — no `SDK_VERSION`, no `__VERSION__`, and no
build-time version injection anywhere in the repo (no tsup `define`; `@sodax/types` builds with plain
`tsc`). A consumer's only option is `import pkg from '@sodax/types/package.json'`, which the exports
map allows but which is awkward across bundlers and CJS.

The encoding is lossless for the permitted grammar, so the version string is recoverable from the
integer. No second literal needs to be written, and therefore none can go stale:

```ts
export const CONFIG_VERSION = 2_020_006;                           // the only written literal
export const configVersionFor = (version: string) => number | null;   // '2.2.0-rc.6' -> 2_020_006
export const parseConfigVersion = (n: number) => ({ major, minor, patch, rc }) | null;
export const formatConfigVersion = (n: number) => string | null;      // 2_020_006 -> '2.2.0-rc.6'
export const SDK_VERSION = formatConfigVersion(CONFIG_VERSION);    // computed, never written
```

**`@sodax/types` owns the canonical implementation of both directions.** The encoder is exported, not
buried in the release tooling: a consumer that knows a version string can compute the number it
corresponds to, which is what makes the drift question answerable from application code —
`configVersionFor('2.2.0') === CONFIG_VERSION` answers "is this the exact release my SDK was built
for?" — the same question the gate asks — without the caller reimplementing the packing. It also makes the round-trip a genuine
property test (B3) instead of two hard-coded tables.

- **`SDK_VERSION` is computed, not written.** This is what separates it from the rejected
  "counter plus a hand-maintained `SDK_VERSION` string" alternative in §7: there is one literal, and
  the string is a projection of it, so the two cannot disagree.
- **`parseConfigVersion` takes any number**, not just `CONFIG_VERSION`. Its real job is the backend's
  `response.version` — which is what makes the `TODO(config-v2)` warn message in
  `ConfigService.ts:166-169` readable, and gives an app a way to render the drift itself.
- **All three are total: they return `| null` and never throw.** `configVersionFor` gets a version
  string from a caller it does not control; `parseConfigVersion` and `formatConfigVersion` get the
  backend's number. A throw inside a config path is the wrong failure mode, and `null` composes with
  the existing fall-back-to-packaged-defaults behaviour. `configVersionFor` returns `null` for anything
  outside the grammar (`2.3.0-beta.1`, `02.1.0`, `v2.1.0`, a non-string) **and** for anything outside
  the domain (`0.1.0`, `2.2.100`, `2.2.0-rc.99`).
- **The release tooling is the one caller that must fail loudly**, so it wraps the total encoder rather
  than reimplementing it — see §8.1. Writing a bad number must stop a release; reading one must not
  crash an app.
- **Put them directly in `src/index.ts`,** beside `CONFIG_VERSION`. That is the entry file, which is
  why `CONFIG_VERSION` does not trip `check:knip` (`packages/types/knip.json` leaves entry exports
  alone). **No new constant in this file may have a name ending in `CONFIG_VERSION`** — see §5.9; the
  release script's seds would eat it. Keep the numeric bounds inside the functions.
- **This fits the package's rules, narrowly.** `packages/types/AGENTS.md` says prefer `import type` and
  keep runtime output minimal, but explicitly allows "a small number of intentional runtime values,
  e.g. `CONFIG_VERSION`". Two pure functions with zero dependencies stay inside that allowance;
  anything larger does not belong here.
- **Reaches apps for free.** `packages/sdk/src/index.ts:15` is `export * from '@sodax/types'`, so
  `import { SDK_VERSION, configVersionFor } from '@sodax/sdk'` works with no dapp-kit or wallet-sdk
  change. No app surfaces a version today, so this is new capability, not a migration.
- **That surface is the ceiling.** One literal (`CONFIG_VERSION`), three pure zero-dependency
  functions, one computed string. Anything needing state, I/O, or a comparison *policy* belongs in
  `@sodax/sdk`'s `ConfigService`, not in a types package.

---

## 5. Border cases in the process, not the arithmetic

The arithmetic is settled in §3. These are the states the repo can actually get into.

1. **`bump-versions.sh` run standalone.** Its own regex
   (`^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$`) is *looser* than `release.mjs`'s `VERSION_PATTERN`:
   `02.1.0`, `2.01.0` and `2.1.0-rc.007` pass the former and fail the latter. Today that writes a
   malformed version into all 8 manifests and `CONFIG_VERSION` still just goes `+1` — nothing notices.
   The deriver must use the **strict** pattern, turning this into a loud failure. Tightening
   `bump-versions.sh`'s own regex to match is a one-line follow-on worth doing in the same PR.
2. **A `0.x` release becomes impossible.** `0.1.0` passes *both* regexes today, so it is reachable in
   principle; the major floor makes the deriver throw. In practice `versionAdvanceErrors` already
   requires advancing `2.2.0-rc.5`, so nothing can reach it — but it is a deliberate narrowing, for a
   reason: major-0 values span `0..999_999`, overlapping the legacy counter's range, so the floor is
   what guarantees separation from every value ever published.
3. **`requireTagAdvance` is `Boolean(lastTag)`** (`scripts/release.mjs:448`) — it silently relaxes when
   no `@sdks@` tag is visible. Tags exist, so this is not live, but it means I2 rests on remote tag
   *presence* while I1 rests on nothing external. Another reason to make I1 the stated invariant.
4. **`release` reset, force-pushed, or recreated from `main`.** Today this destroys the only copy of
   the counter's state and the next release silently reuses a number. Under derivation there is no
   state to lose: the number is a function of the version, and the next version must still advance the
   highest *published tag*, which `release.mjs` reads from the remote.
5. **A bad merge resolution that is never cut.** A wrong constant can sit on `release` unpublished;
   §8 layer 2 (at cut) and layer 3 (at tag) both catch it before anything reaches npm.
6. **Which manifest is authoritative.** `bump-versions.sh` sets all 8 and `sdks-publish.yml` validates
   all 8 against the tag, so they cannot diverge silently — but the derivation must still name one:
   `packages/types/package.json`, the package that owns the constant.
7. **A non-`rc` prerelease (`2.3.0-beta.1`).** Both regexes reject it, so the tooling cannot produce
   one — but `sdks-publish.yml`'s dist-tag computation is generic
   (`PRERELEASE_ID="${EXPECTED_VERSION#*-}"`), so a hand-cut tag would publish it under `beta` today.
   The new publish-time check would throw and fail that publish: a **new failure mode, stricter than
   today**. Defensible, but it would also block an emergency hand-cut release, so the error message
   must name the remedy rather than just reporting a parse failure.
8. **`rc.0` is legal** (`-rc.0` passes both regexes) and maps to slot `0`, ordering below `rc.1`.
9. **The `CONFIG_VERSION` seds are unanchored — and this design would trip them.** Both the read
   (`bump-versions.sh:20`, `sed -nE 's/.*CONFIG_VERSION = ([0-9]+).*/\1/p' | head -n1`) and the write
   (`:38`, no `g` but applied to *every* matching line) match **any identifier ending in
   `CONFIG_VERSION`**, and the read takes the file's first hit. Adding a constant such as
   `MIN_CONFIG_VERSION` above line 23 makes the script read the wrong number and rewrite both
   constants; `:40`'s `grep -q` still passes because *a* line matches, and `verifyMutation` still
   passes because the path set is unchanged. Since this design adds exports to exactly that file, it is
   a self-inflicted hazard unless handled: **anchor both seds on `^export const CONFIG_VERSION = `**,
   and keep bound constants out of `index.ts`. Covered by test A7.

---

## 6. What the derivation does and does not fix

An audit of the release path found that **no publish workflow compares a version against published
history** — all nine validate only "tag suffix equals manifest version" — and that
`scripts/release.mjs`, the only thing that ever checks ordering, never runs in CI. So I2 was never
enforced by the system; it was enforced by people using `pnpm release`. Saying this plainly is the
difference between "this change guarantees the invariant" and "this change guarantees the half that is
guaranteeable".

| | fixed | why |
| --- | --- | --- |
| `CONFIG_VERSION` as independent mutable branch state | **yes** | it becomes a function of the manifest; a reset, force-push or bad merge resolution of `release` can no longer silently regress it |
| `verifyMutation` never checking the value | **yes** | §8 layer 2 |
| `bump-versions.sh` standalone producing a bogus number | **yes** | the strict pattern plus field guards throw |
| the unanchored seds | **yes, if anchored** | §5.9 — mandatory here |
| a hand-cut tag pushed without `pnpm release` | **partly** | layer 3 catches a *mismatched* constant, not a *lower version*; nothing reads published history at tag time |
| the documented per-package backport | **no** | one manifest vs one tag is the entire check — and for I1 the lower number is the correct outcome anyway |
| non-`rc` prereleases invisible to `release.mjs`'s floor | **no** | pre-existing; the version pattern rejects them while the publish glob accepts them |
| deleting `@sdks@` tags disarming `requireTagAdvance` | **no** | pre-existing; the floor is remote-tag-shaped |
| the 8 manifests diverging | **no** | but the derivation names `packages/types/package.json` as its single input, and layer 3 compares against the **tag**, so it stays well-defined under divergence |

Two cheap hardenings worth carrying alongside, since they protect the new gate itself: add
`scripts/release.mjs`, `scripts/bump-versions.sh` and `scripts/config-version.mjs` to
`.github/CODEOWNERS` (which today covers `/.github/` and `/docs/` but **not** the release scripts), and
give the eight per-package publish workflows the `concurrency` group the unified one already has.
Everything else in the "no" rows is pre-existing and out of scope.

---

## 7. Alternatives, and why they lose

- **Radix 1000** — `3.0.0` gives `3_000_000_999`, overflowing int32, for headroom in fields that are
  already two digits wider than this project will ever need.
- **`YYYYMMDDnn`** — reflects release *time*, not the package version, so it misses the ask; and it
  needs an intra-day counter, reintroducing exactly the stateful thing being removed.
- **Keep the counter, add a hand-written `SDK_VERSION` string** — leaves `CONFIG_VERSION` itself
  opaque (the actual ask), keeps the stateful counter, and adds a *second written literal* that can
  drift from the first. Not the same as §4's `SDK_VERSION`, which is computed and so cannot drift —
  the derived encoding is what makes that possible.
- **Semver string on the wire** — breaks `GetAllConfigResponseV2.version: number` and the API that
  serves it, to buy ordering information the integer already has for free. Note that under exact
  equality it buys even less: `!==` on a string would work identically, and the wire type change would
  be pure cost. (`SDK_VERSION` already gives consumers the string, alongside the number.)

---

## 8. Where the derivation lives, and how it is verified

### 8.1 `scripts/config-version.mjs`

A node helper, not bash and not build-time.

- **Not bash**: the formula would exist in bash, restated in JS for `release.mjs`'s `verifyMutation`,
  and again in the tests — three copies of the thing that must never disagree.
- **Not build-time**: `@sodax/types` builds with plain `tsc` (no `define`, no plugin hook), and
  `@sodax/sdk`'s tsup has `noExternal: ['@sodax/types']`, which inlines the literal into the SDK
  bundle. The constant must stay a plain source literal.

Surface: `configVersionForOrThrow(version)` — a thin wrapper that produces the field-level diagnostic
(`patch 100 outside 0..99 (bump the minor instead)`) the runtime encoder deliberately does not;
`readManifestVersion` / `readConfigVersion`; `configVersionDriftErrors(root)`; plus a CLI
(`node scripts/config-version.mjs <version>` prints the integer; `--check` exits 1 on drift).

**`@sodax/types` owns the canonical formula in both directions; `scripts/` keeps a mirror, and that
duplication is forced.** Release tooling is plain `.mjs` that runs *before* anything is built, so it
cannot import `packages/types/dist`, and it cannot import the `.ts` source either. Equally, consumers
cannot import a repo script. So the packing exists twice — roughly ten lines each — and the design's job
is to make a divergence impossible to miss rather than to pretend it away:

- `scripts/config-version.test.mjs` (A6) asserts the **scripts** formula, applied to
  `packages/types/package.json`'s version, equals the integer committed in `index.ts`;
- `packages/types/src/config-version.test.ts` (B4) asserts the **runtime** formula, applied to the same
  committed integer, equals that same manifest version.

Both are pinned to the one committed constant from opposite directions, so any disagreement between the
two implementations fails at least one of them on every PR. Each file's header comment must name the
other as its counterpart, and say that `@sodax/types` is normative — the mirror exists only because the
release tooling runs before a build.

**Reuse, don't duplicate:** `parseVersion` and `compareVersions` already exist and are exported from
`scripts/release.mjs:32-57`, returning `{ major, minor, patch, rc }` with `rc: null` for a stable
release — exactly the shape the formula needs, and `compareVersions` already orders a release above its
rcs. Move `VERSION_PATTERN` / `parseVersion` into `config-version.mjs` and re-export them from
`release.mjs`, so `scripts/release.test.mjs:23`'s import keeps working and the tooling keeps exactly
one version parser.

### 8.2 Five verification layers, because CI never runs on `release`

This constraint shapes the design. `.github/workflows/ci.yml` triggers on `push` to `main` /
`development` and on `pull_request` only — **never on `release`**, where every bump happens. A PR-time
test alone therefore cannot fix the drift fragility.

1. **Generation** — `bump-versions.sh` computes instead of incrementing, and asserts
   `NEW_CV > CURRENT_CV` (with a documented `ALLOW_CONFIG_VERSION_DECREASE=1` escape hatch for a
   deliberate backport).
2. **Cut time** — `verifyMutation` (`scripts/release.mjs:313-332`) asserts the landed constant equals
   `configVersionForOrThrow(target)`. Closes problem 3 in §1; it is one more `errors.push`.
3. **Tag time** — a step in `.github/workflows/sdks-publish.yml` asserting the constant matches
   `${GITHUB_REF_NAME#@sdks@}`. **This is the layer that actually removes the `main`-vs-`release`
   fragility**, being the only automation that runs on `release`. The existing validate step (line 25)
   already does this shape of check for every manifest with `jq`, but runs before Node is pinned — so
   add a new step after `Setup Node.js` rather than extending it. Compare against the **tag**, not a
   manifest: that keeps the check well-defined even if the 8 manifests have diverged, and it is the
   only gate that sees a hand-cut tag pushed without `pnpm release`. Add the same step to
   `sodax-types-publish.yml`, the one per-package workflow that ships this constant.
4. **PR time** — `scripts/config-version.test.mjs` (node:test), registered in `test:release-scripts`
   (`package.json:22`), which `pnpm test` runs first and CI runs via `pnpm test`. Cases in §9.
5. **Package tests** — `packages/types/src/config-version.test.ts` (vitest) covering the shipped
   decoder. Required, not optional: these are shipped functions, and the manifest assertion is what
   closes the round trip across the encode/decode split. Read the manifest with
   `readFileSync(new URL('../package.json', import.meta.url))`, matching
   `packages/types/src/chains/logo-assets.test.ts`, **not** a JSON import: `tsconfig.json` sets
   `rootDir: "src"` (inherited by `tsconfig.check.json`, which typechecks tests per
   `check-tests-typechecked.mjs`), so reaching above `src/` through the module graph risks TS6059.
   Turbo needs no new inputs — `$TURBO_DEFAULT$` already covers the package's own `package.json`.

---

## 9. Test specification

Every fixture below was produced by running the encoding, not written by hand. Paste them in as
data-driven cases (`it.each` / `for (const [input, expected] of …)`) rather than restating them prose-style.

### A. `scripts/config-version.test.mjs` — the encoder (node:test)

**A1. Normal cases** — the scripts mirror. The same table is reused by B3 against the runtime encoder:

| version | expected | version | expected |
| --- | --- | --- | --- |
| `1.0.0-rc.1` | `1000001` | `2.9.0` | `2090099` |
| `1.0.0` | `1000099` | `2.10.0` | `2100099` |
| `2.0.0-rc.17` | `2000017` | `2.10.1-rc.2` | `2100102` |
| `2.2.0-rc.5` | `2020005` | `3.0.0-rc.1` | `3000001` |
| `2.2.0-rc.6` | `2020006` | `3.0.0` | `3000099` |
| `2.2.0` | `2020099` | `10.20.30` | `10203099` |
| `2.2.1` | `2020199` | `99.99.99` | `99999999` |
| `2.3.0-rc.1` | `2030001` | `2.3.0` | `2030099` |

Keep `2.9.0` < `2.10.0` labelled as the string-compare regression case.

**A2. Border cases** — every field at its minimum and maximum:

| version | expected | what it pins |
| --- | --- | --- |
| `1.0.0-rc.0` | `1000000` | global minimum; `rc.0` is legal |
| `1.0.0` | `1000099` | stable sentinel at the floor |
| `1.99.99-rc.98` | `1999998` | every field maxed below major 2 |
| `2.0.0-rc.0` | `2000000` | major boundary |
| `2.0.99` | `2009999` | patch max, no carry into minor |
| `2.99.0` | `2990099` | minor max |
| `2.99.99` | `2999999` | minor and patch maxed, no carry into major |
| `99.0.0-rc.0` | `99000000` | major max |
| `99.99.99-rc.98` | `99999998` | largest rc value |
| `99.99.99` | `99999999` | global maximum |

**A3. Throw cases** — `configVersionForOrThrow`. Assert it throws **and** on the message, since the
message is the operator's only guidance mid-release. The same inputs must return `null` from the
runtime encoder (B3b):

| input | message contains |
| --- | --- |
| `0.0.1`, `0.1.0` | `major 0 outside 1..99` |
| `100.0.0` | `major 100 outside 1..99` |
| `2.100.0` | `minor 100 outside 0..99` |
| `2.2.100` | `patch 100 outside 0..99 (bump the minor instead)` |
| `2.2.0-rc.99`, `2.2.0-rc.100` | `rc … outside 0..98 (99 is reserved for stable)` |
| `2.3.0-beta.1` | not `X.Y.Z` or `X.Y.Z-rc.N` — the prerelease the publish glob accepts but the tooling must not |
| `02.1.0`, `2.01.0`, `2.1.0-rc.007` | not valid — the leading-zero divergence from `bump-versions.sh`'s looser regex (§5.1) |
| `2.1`, `v2.1.0`, `''`, `'2.1.0 '` (trailing space), `null`, `undefined`, `2.1` (number) | not valid |

**A4. Adjacency at every field boundary.** This is where a positional encoding actually fails, and it
is worth more than bulk enumeration: each pair is a *successor* pair straddling one carry, so an
off-by-one in any field shows up as a non-positive gap. The gap column is part of the assertion — the
dense (gap 1) rows are the informative ones.

| from | | to | | gap | boundary |
| --- | --- | --- | --- | --- | --- |
| `1.0.0-rc.0` | `1000000` | `1.0.0-rc.1` | `1000001` | 1 | first rc to second |
| `1.0.0-rc.98` | `1000098` | `1.0.0` | `1000099` | 1 | last rc to its stable (rc slot to sentinel) |
| `2.2.0-rc.98` | `2020098` | `2.2.0` | `2020099` | 1 | the same, at the live version |
| `2.2.0` | `2020099` | `2.2.1-rc.0` | `2020100` | 1 | stable to the next patch's first rc |
| `2.2.99` | `2029999` | `2.3.0-rc.0` | `2030000` | 1 | patch max to next minor — the patch/minor carry |
| `2.2.99` | `2029999` | `2.3.0` | `2030099` | 100 | same carry, to the stable |
| `2.99.99` | `2999999` | `3.0.0-rc.0` | `3000000` | 1 | minor max to next major — the minor/major carry |
| `2.99.99` | `2999999` | `3.0.0` | `3000099` | 100 | same carry, to the stable |
| `2.9.0` | `2090099` | `2.10.0` | `2100099` | 10000 | single to double digit minor — the string-compare trap |
| `2.0.9` | `2000999` | `2.0.10` | `2001099` | 100 | single to double digit patch |
| `98.99.99` | `98999999` | `99.0.0-rc.0` | `99000000` | 1 | last major boundary inside the domain |

Plus the two absolutes: `1.0.0-rc.0` is `1000000` (global minimum) and `99.99.99` is `99999999`
(global maximum).

**A4b. Property tests over a sampled domain.** A few thousand versions from a **seeded** generator —
deterministic, so CI cannot flake — asserting the three properties that matter:

- **injectivity (I0)** — the sample's numbers, put in a `Set`, keep their cardinality;
- **round trip** — `decode(encode(v)) === v` and `encode(decode(n)) === n`;
- **ordering agrees with the release tooling (I1)** — `Math.sign(encode(a) - encode(b))` equals
  `Math.sign(compareVersions(a, b))` for sampled pairs, so the two definitions of "older" cannot drift.

A one-off exhaustive sweep of 4,000,000 cases was run while designing this (§3.2) and found nothing the
table above does not pin. It is deliberately **not** kept in the suite: the encoding is a positional
numeral, so its failure modes live at the carries, and bulk enumeration buys runtime and maintenance
rather than confidence.

**A5. Idempotence** — the encoder called twice returns the same number. The property the counter
lacked: a second `bump-versions.sh` run silently produced `+2`.

**A6. Repo self-consistency** — the scripts formula applied to `packages/types/package.json`'s version
equals the integer read out of `packages/types/src/index.ts`, via `join(import.meta.dirname, '..')` as
`scripts/release.test.mjs:30` already does. This is what makes the constant unfalsifiable on every
branch.

**A7. Anchored-sed regression** — guards this design against itself (§5.9). Build a fixture `index.ts`
containing a decoy `export const MIN_CONFIG_VERSION = 200;` **above** the real
`export const CONFIG_VERSION = 2020006;`, run the real `bump-versions.sh` against it, and assert the
decoy is untouched and only the real constant moved. Add the mirror case with the decoy below.

**A8. CLI contract** — `node scripts/config-version.mjs 2.2.0-rc.6` prints `2020006` and exits 0; an
invalid version exits non-zero with the message on stderr; `--check` exits 0 on a consistent tree and
non-zero naming both values on an inconsistent one.

### B. `packages/types/src/config-version.test.ts` — the decoder (vitest)

**B1. Decode normal and border** — the A1/A2 tables in reverse: `formatConfigVersion(n)` returns the
version string and `parseConfigVersion(n)` returns the right `{major, minor, patch, rc}`, with
`rc: null` for every stable entry. Assert `null` explicitly, not falsy — `rc: 0` is legal and falsy.

**B2. Decode returns `null`, never throws**, for every one of:

`235` and `100` (today's counter — the realistic backend case) · `0` · `-1` · `1.5` · `NaN` ·
`Infinity` · `-Infinity` · `999_999` (just below the floor) · `100_000_000` (just above the ceiling) ·
`2**31` · `Number.MAX_SAFE_INTEGER + 1` (**the defect the upper bound fixes** — label it) ·
`'2020006'` (a string, not a number) · `null` · `undefined`.

**B3. Round-trip property** — a real property test, since both directions ship here:
`formatConfigVersion(configVersionFor(v)) === v` for every version in A1 and A2, and
`configVersionFor(formatConfigVersion(n)) === n` for every integer in them. Also assert
`configVersionFor(v)` equals the A1/A2 integers directly, so the runtime encoder is pinned to the same
literals as the scripts mirror rather than only to itself.

**B3b. `configVersionFor` returns `null`, never throws**, for the whole A3 list — `0.0.1`, `0.1.0`,
`100.0.0`, `2.100.0`, `2.2.100`, `2.2.0-rc.99`, `2.2.0-rc.100`, `2.3.0-beta.1`, `02.1.0`, `2.01.0`,
`2.1.0-rc.007`, `2.1`, `v2.1.0`, `''`, `'2.1.0 '`, `null`, `undefined`, `2.1` (number). Same inputs as
A3, opposite expectation: the release tooling throws on these, the runtime returns `null` (§4).

**B4. `SDK_VERSION` equals this package's own `package.json` version.** The single assertion proving
the shipped constant, the shipped decoder and the manifest all agree.

**B5. `CONFIG_VERSION` is in `[1_000_000, 99_999_999]` and `parseConfigVersion(CONFIG_VERSION) !== null`** —
cheap, and it fails loudly if someone hand-edits the constant outside the encoding.

### C. `scripts/release.test.mjs` — existing fixtures this change breaks

Not new tests, but they fail unless updated, and one is the real end-to-end proof:
`createWorkspace` (`:41`) seeds `CONFIG_VERSION = 231`; `fakeBump` (`:73-78`) hard-codes `n + 1`;
`:491` asserts `232` (fixture releases `2.1.0` to `2.2.0`, so `2020099`) and runs the **real**
`bump-versions.sh`; `:573` seeds `232` in a `2.1.0` fixture (`2010099`). Derive all four from the
fixture's version rather than re-hard-coding, so they cannot drift again.

---

## 10. Edits the implementation PR will make

| File | Change |
| --- | --- |
| `scripts/config-version.mjs` | **new** — the release-time mirror of the formula, `configVersionForOrThrow`, readers, drift check, CLI (§8.1) |
| `scripts/config-version.test.mjs` | **new** — cases A1–A8 |
| `scripts/bump-versions.sh` | lines 20-26: `NEW_CV=$(node scripts/config-version.mjs "$NEW_VERSION")` replaces `$((CURRENT_CV + 1))` (the CLI is what keeps bash out of the formula); keep `CURRENT_CV` for the log line and the `>` guard. **Anchor both seds** (read at `:20`, write at `:38`) on `^export const CONFIG_VERSION = ` — §5.9, mandatory, not tidying. Have the write emit the version in the comment so it cannot go stale. Tighten its version regex to the strict pattern |
| `.github/CODEOWNERS` | add the release scripts — they gate every publish and are currently unowned |
| `scripts/release.mjs` | import `configVersionForOrThrow`, re-export `parseVersion`; add the assertion to `verifyMutation`; reword the `:355` comment (a stale branch can no longer reuse the number — the remaining reason is wrong base and wrong notes) |
| `scripts/release.test.mjs` | fixtures at `:41`, `:73-78`, `:491` (`232` to `2_020_099`), `:573` (`232` to `2_010_099`) |
| `packages/types/src/index.ts` | the one-time hand-edit of line 23 (§11), plus `configVersionFor`, `parseConfigVersion`, `formatConfigVersion`, `SDK_VERSION` — the canonical implementation of both directions |
| `packages/types/src/config-version.test.ts` | **new** — cases B1–B5 |
| `package.json:22` | add `scripts/config-version.test.mjs` to `test:release-scripts` |
| `.github/workflows/sdks-publish.yml`, `sodax-types-publish.yml` | new check step after `Setup Node.js`, comparing against the tag |
| `packages/types/AGENTS.md:147`, `packages/types/README.md:20`, `packages/RELEASE_INSTRUCTIONS.md:9,24,76` | "increments once per release" becomes "derived from the manifest version"; document the encoding and decode rule; keep "never hand-edit", now backed by a check |
| `packages/skills/` | new public exports — update the consumer-facing docs and run `pnpm check:ai` |

No change to `ConfigService.ts` in this PR — the code is commented out and stays that way. But note
that the commented `response.version < CONFIG_VERSION` on `:166` is **not** the rule to restore: the
selected policy is `!==` (§1), so config-v2 enablement replaces that line rather than uncommenting it.
`ConfigService.test.ts:208`'s commented `CONFIG_VERSION - 1` happens to satisfy either rule, since a
different number is both smaller and unequal — but under equality the `-1` arithmetic no longer means
anything, and that fixture should become an explicitly encoded *different* release.

`.claude/skills/add-token/SKILL.md:196` stays correct — bumping is out of scope for token changes.
`packages/types/README.md` is also what satisfies Docs Drift for the `packages/types/src/` change.

---

## 11. Risks and switchover

### Risks

- **The headline consequence: dynamic config is live only when the API and the consumer run the exact
  same SDK release.** This follows from the two chosen facts together — the API serves `CONFIG_VERSION`
  from the SDK package it imports, and the gate is `!==`. So the moment we publish `2.2.0-rc.7`, every
  consumer who upgrades is on packaged defaults until the API upgrades its own `@sodax/sdk` dependency
  to the same release, and vice versa. With rc releases as frequent as they are, the *normal* state is
  mismatch. That is a deliberate, safe-by-default policy — the fallback is config the SDK shipped with
  and was tested against — but it should be a decision taken with open eyes, not a surprise discovered
  after config-v2 goes live. Worth deciding alongside it: whether the mismatch warns on every
  `initialize()` (noisy) or once per process.
- **No backend coordination is required.** There is no second numbering scheme to agree on: the API
  re-exposes our constant, so it adopts whatever encoding we ship on its next dependency bump. An API
  still on an older SDK serves a legacy counter value such as `235`, which `!==` rejects — the safe
  direction, and self-correcting once it upgrades.
- **The jump from `235` to ~`2_000_000` is safe.** Under `!==` any non-matching number falls back to
  packaged defaults, so the transition period behaves exactly like any other version mismatch. There is
  no direction in which a mismatched number causes the SDK to *adopt* foreign config.
- **Backport inversion stops mattering.** A backported `2.0.2` published after `2.1.0` derives
  `2_000_299`, which is lower than `2.1.0`'s `2_010_099` — an I2 violation, and under an ordering gate
  it would have needed the argument that semver lineage is the right order anyway. Equality does not
  ask. What equality *does* require is that the backport's number is not shared with any other release,
  which is I0, and which holds by construction.
- **`SDK_VERSION` inherits `main`'s staleness.** An app built from a `main` checkout reads
  `'2.0.0-rc.17'` — because that is what `main`'s manifest says. The value is *consistent*, just
  describing a manifest nobody updates. Every published artifact is cut on `release`, where both are
  correct, so npm consumers always see the truth. Second reason to file the "merge `release` back into
  `main`" follow-up.
- **Type surface is unaffected.** The inferred literal type changes from `100` to the new value;
  nothing references `typeof CONFIG_VERSION` and the wire field is `number`.
- **One wart to settle in review: `SDK_VERSION` infers as `string | null`,** because it is computed by
  the same total decoder consumers call on arbitrary numbers. Recommend accepting it — the
  repo's no-escape-hatches rule bars a `!` assertion, and one written literal beats two. The
  alternative, if the `| null` proves annoying in app code, is to have `bump-versions.sh` write
  `SDK_VERSION` as a second literal and let the round-trip test pin it to `CONFIG_VERSION`: a clean
  `string` and a greppable value, at the cost of a second sed and a second switchover edit.

### Switchover

The implementation PR on `main` hand-edits line 23 **once**, to the value derived from `main`'s manifest:

```ts
export const CONFIG_VERSION = 2_000_017; // 2.0.0-rc.17 — derived from packages/types/package.json
```

`2_000_017` and nothing else, because tests A6 and B4 assert the constant against the manifest version
on every branch, and `main`'s manifest is stale at `2.0.0-rc.17`. The number describes the manifest, not
`main`'s content — `main` never receives the version bumps, so its manifests lie. (Merging `release`
back into `main` after each cut would fix that; out of scope.)

Then, once: `git pull --no-ff origin main` into `release` conflicts on line 23 (`2_000_017` vs `235`).
Resolve either way — that it no longer matters is the point. `pnpm release 2.2.0-rc.6` then derives
`2_020_006`, checks `2_020_006 > 235`, `verifyMutation` asserts it, and the tag push re-derives from
`@sdks@2.2.0-rc.6` and refuses to publish on mismatch. Afterwards `main`'s line 23 is frozen again, so
later `main` to `release` merges carry no change to it.
