---
"@sodax/sdk": patch
"@sodax/dapp-kit": patch
"@sodax/skills": patch
---

Describe the solver protocol fee as up to 0.1%, not a fixed 0.1%. The actual fee is 0.01% to 0.1% depending on the solver's route and is already included in the quote. `sodax.swaps.getSolverFee`, `sodax.api.swaps.getSolverFee`, `sodax.api.leverageYield.getSolverFee`, `useSwapsApiSolverFee` and `useLeverageYieldApiSolverFee` now say they return the maximum. Documentation only, no behavior change.
