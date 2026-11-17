# 0001. `@sodax/sdk` and `@sodax/dapp-kit` are strongly typed and narrowed at the call site

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** `packages/sdk`, `packages/dapp-kit`. Other packages are out of scope for now.

## Context

One SDK method serves every chain family and both execution modes: the caller's chain key selects the
wallet provider, the raw transaction shape and the result, and `raw: true` selects an unsigned
transaction over a broadcast hash. dapp-kit hooks pass those types through to React code.

When a result is wider than what the call can actually return, the cost lands on every caller. A result
typed as a union of all chains, or as `any` or `unknown`, forces a cast or a type argument at each call
site, and a cast hides the next real mismatch. Nothing checked this: a refactor could widen a result,
`tsc` stayed green because the wider type is still assignable where it is produced, and partners found
out when their code stopped compiling without a cast, or kept compiling over a wrong assumption.

## Decision

1. **Strongly typed.** Every exported function and public method of `@sodax/sdk` and `@sodax/dapp-kit`
   declares an exact result type. `any` and `unknown` are not acceptable in a result unless there is a
   strong reason, stated where the result is asserted. A value the SDK cannot know the type of (an
   opaque third-party payload, a caught error) is such a reason; convenience is not.
2. **Narrowed on usage.** A function whose result depends on what the caller passes returns the type
   that matches the call, inferred from the arguments, with no type arguments and no cast. Typical
   inputs are the chain or chain family, the execution mode, the wallet provider and a variant of the
   params. A call that cannot be valid is a compile error rather than a wide result.
3. **The one exception.** A function whose result type does not depend on its inputs has nothing to
   narrow. It is still strongly typed under point 1.
4. **Verified by type tests.** Each source file with exported functions or public methods has a type
   test beside it, named `<file being tested>.type.test.ts`. It asserts the exact result type of every
   one of them. For a narrowing function it covers each type-level input with its expected result, and
   the invalid combinations as compile errors. For a function under the exception it pins the single
   result type.
5. **Enforced by the type check.** Type tests are compile-time assertions checked by `pnpm checkTs`.
   `scripts/check-type-tests.mjs`, the tail of each package's `checkTs`, fails when an exported function
   has no type test, when a type test has no source file beside it, and when a recorded exemption no
   longer applies. An exemption is an entry with its reason in the package's
   `scripts/type-test-exemptions.json`.

## Consequences

- A change that widens a result, or loses narrowing for one chain family or execution mode, fails
  `checkTs` in the pull request that makes it.
- A deliberate change to a public result type also edits its type test, which makes the change visible
  in review as a public type change.
- A new exported function is not done until it has a type test or a recorded exemption.
- `checkTs` typechecks more files and takes longer.
- The gate checks that a type test names each function, not that its assertions are meaningful. That
  stays a review concern.
