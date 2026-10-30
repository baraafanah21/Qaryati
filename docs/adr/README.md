# Architecture Decision Records

An ADR records one important decision: the context, what we chose, what else we considered and the cost we accepted. It answers "why this, and what else did you consider?" for anyone who joins or reviews the project later.

## Rules

- Use [0000-template.md](0000-template.md). Files are numbered in order: `NNNN-short-title.md`.
- An ADR starts as **Proposed** in its pull request and becomes **Accepted** when merged.
- **Accepted ADRs are not edited.** Fixing a typo or a broken link is fine; changing the decision is not. A later change is a new ADR that supersedes the old one: the new ADR says "Supersedes ADR-NNN", and the old one's status becomes "Superseded by ADR-MMM" (the only edit allowed).
- Keep ADRs short (one to two pages) and link to the detailed docs instead of repeating them.

## Index

| ADR                                                   | Title                                   | Status   | Owner | Issue |
| ----------------------------------------------------- | --------------------------------------- | -------- | ----- | ----- |
| [ADR-001](0001-modular-monolith-hexagonal-modules.md) | Modular monolith with hexagonal modules | Accepted | Baraa | #11   |
| [ADR-002](0002-technology-stack.md)                   | Technology stack                        | Accepted | Baraa | #11   |
| [ADR-003](0003-claims-data-model.md)                  | Claims data model                       | Accepted | Baraa | #26   |
| ADR-004                                               | Token design                            | Planned  | Hamam | #29   |
| ADR-005                                               | Geocoding integration                   | Planned  | Ali   | #46   |
| ADR-006                                               | Village details cache                   | Planned  | Momen | #45   |
