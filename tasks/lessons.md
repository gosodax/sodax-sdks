# Lessons

Patterns to apply on future work in this repo. Added after a correction; each one states the rule, not
the incident.

---

## L1 — Prove arithmetic by running it, never by reasoning about it

**Correction:** asserted that the encoding was monotonic across rc and stable versions without having
executed it. Twice shipped a wrong number in prose: the int32 ceiling stated as major ≤ 2147 when
`encode(2147.99.99) = 2_147_999_999` overflows (real ceiling 2146), and `0.1.0` described as "below
published counter values" when it encodes to `10099`, which is above `235`.

**Rule:** any claim of the form "this ordering holds", "this fits in N bits", "this value is greater
than that one" gets a throwaway script before it gets written down. At *design time*, reach for the
cheapest thing that would actually catch an error — enumerating 4,000,000 cases took under a second and
beat a hand-picked table of eight. Then decide separately what belongs in the suite; the two questions
have different answers (see L10). Every number that survives into the written design should be one the
script printed.

## L2 — State which invariant, when there is more than one

**Correction:** "ensure that at no point can the derived number fail the core invariant of being
properly incremented."

**Rule:** "monotonic" was ambiguous between *semver order* and *publish order*, and the design could
only guarantee the first. Naming them separately (I1/I2) turned a hand-wave into a decision: the drift
gate needs semver order, the backport case breaks publish order, and that is correct rather than a bug.
When a guarantee has an exception, find out whether the exception is the *right* behaviour before
treating it as a hole to plug.

## L3 — Guards that fail silently must throw, and the boundary must be tested

**Rule:** when a scheme has a domain (field widths, sentinels, ranges), check what happens **one past**
each boundary, not just inside it. Here every cap was exactly load-bearing: at the boundary ordering
held, one past it the value collided or inverted with nothing to surface it at runtime. That asymmetry
is the argument for throwing per field with a message naming the remedy, and for a test case per cap.

## L4 — A decoder's input is untrusted; bound it on both ends

**Rule:** a lower bound alone let `decode(MAX_SAFE_INTEGER + 1)` return a plausible-looking object.
Anything parsing a value that arrives over the wire needs both bounds plus an integer check, and must
return `null` rather than throw — a throw inside a config path is the wrong failure mode. Note the
deliberate asymmetry with the write side: writing a bad value must stop a release loudly.

## L5 — Ask who consumes the thing, not just who produces it

**Correction:** "have you taken into account that apps might like to get the current config version?"

**Rule:** the first design covered the release tooling end to end and left consumers with a bare
integer. When changing an exported value's meaning, work out what a consumer now wants to *do* with it
before calling the design complete. Here it added three exports and changed where the decode logic has
to live.

## L6 — Changing a file means re-reading what else touches that file

**Rule:** the release script's `CONFIG_VERSION` seds are unanchored — they match any identifier ending
in `CONFIG_VERSION` and the read takes the file's first hit. A design that adds constants to that same
file would have silently corrupted the release, and every existing check would still have passed. Before
adding to a file, grep for what parses it. Textual tooling (sed, regex codemods) is the usual culprit.

## L7 — Verify the repo's real state; branches lie

**Rule:** `main` and `release` disagree on both the package version and `CONFIG_VERSION`, and `main` has
been stale since August. Reading the checked-out branch and generalising would have produced a design
built on `100` instead of the published `235`. Check the branch that actually ships (`git show
origin/<branch>:<path>`), and check what CI actually runs on — `ci.yml` never runs on `release`, which
is what forced the verification to live in the publish workflow rather than in a test.

## L8 — Ask about system facts outside the repo; do not infer them

**Corrections:** assumed the backend *maintained* its own `version` number (it re-exposes
`CONFIG_VERSION` from the SDK package it imports), and assumed the compatibility rule would stay the
`<` that the commented-out code happens to contain (the selected policy is exact equality, `!==`).

**Rule:** the repo is authoritative about the repo. It is not authoritative about what another service
does with a value, or about a policy that has been decided but not yet written down — commented-out
code is the *old* intent, not evidence of the current one. Both assumptions propagated through several
sections before being caught. When a design depends on a fact that lives outside the tree, ask, and
mark it as assumed until answered. Both corrections here *simplified* the design: no backend
coordination is needed, and equality makes ordering non-load-bearing.

## L9 — Match the invariant to the actual comparison

**Rule:** switching the gate from `<` to `!==` changed which property carries the correctness weight:
ordering became decorative and **injectivity** became the thing that must not break. The same caps
turned out to be load-bearing either way, but for a different reason — a collision under equality means
accepting config built for a different release, which is worse than an inversion. Work out which
property the consuming comparison actually reads before deciding what to prove and what to test.

## L10 — Boundary and property tests beat bulk enumeration

**Correction:** a 4,000,000-case exhaustive sweep was proposed as a permanent test.

**Rule:** enumeration is a fine one-off proof while designing, and a poor suite member — it costs
runtime and maintenance and finds nothing the boundaries do not. For a positional encoding the failure
modes live at the carries, so the durable tests are: successor pairs straddling each field boundary
(asserting the *gap*, not just the order), plus seeded property tests for injectivity, round trip, and
agreement with the existing comparator. Keep the one-off in the design notes, not in CI.

## L11 — Conventional branch names, and the type carries meaning

**Correction:** used `chore/` for work that adds public runtime exports.

**Rule:** `<type>/<few-hyphen-separated-words>`. The type is a claim about impact, not a formality:
new public API is `feat/`, even when most of the diff is tooling and docs. Commit subjects follow
conventional commits; the husky `commit-msg` hook enforces the format.

## L12 — When docs disagree on a backend fact, ask which side is right and fix the other

**Correction:** docs split on whether a partner portal key works for sponsoring; the answer was that
sponsoring requires its own key.

**Rule:** SDK code shows what the client *sends* (the instance key is forwarded to a gateway-rooted
sponsoring call), not what the backend *accepts*. When two docs contradict each other on an
acceptance rule, ask for the source of truth, then correct the losing side in the same change instead
of writing prose that hedges between both.
