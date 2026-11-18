# Architecture decision records

Repo-wide engineering decisions that bind more than one package. A decision that concerns one package
belongs in that package's `AGENTS.md`; process rules belong in [`.github/`](../.github/). This directory
is not part of the published docs site, which is built from [`docs/`](../docs/).

Each record is one file, `NNNN-short-title.md`, numbered in order and never renumbered. A record states
its **Status**, the **Context** that forced a decision, the **Decision**, and its **Consequences**. To
change a decision, add a record that supersedes the old one and mark the old one `Superseded by NNNN`;
do not rewrite history in place.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-typed-and-narrowed-public-surface.md) | `@sodax/sdk` and `@sodax/dapp-kit` are strongly typed and narrowed at the call site | Accepted |
