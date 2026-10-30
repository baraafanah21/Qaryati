# ADR-003: Claims data model

- **Status:** Accepted
- **Date:** 2026-10-31
- **Deciders:** Baraa (platform lead); Yahya (curation owner) reviews it in #26.
- **Issue:** #26

## Context

- Every fact about a village (names, origin, affiliation, location, measures, relations, population, history, events, landmarks, culture, products, facilities: 13 kinds) needs the same things: a source, a review state, an author, a reviewer, and room for several values when sources disagree.
- Sources disagree, and the brief forbids hiding it: overwriting a value when a new one arrives is not allowed.
- The 13 kinds belong to four modules (village, population, heritage, economy). Copying provenance and review into each means 13 copies of the same columns, constraints, indexes, queue queries and endpoints.
- Business rules (allowed statuses, value ranges, the review workflow) will change during the project. A rule change must not need a migration.
- The kernel had a soft-delete habit (`deleted_at`, `softDeleteWithVersion`). Every unique index and query then needs `WHERE deleted_at IS NULL`, and "deleted" competes with the statuses that already say why a row is gone (archived, disabled, withdrawn, rejected).

## Decision

Every fact is a **claim**: one shared `claim` table (curation) holds provenance and review for every fact, and one small typed fact table per kind holds only the value (class-table inheritance). Each claim answers a question (`group_key`); a question has at most one preferred claim, and the preferred claims are what the public sees. The full model is in [docs/data-model.md](../data-model.md).

- **Minimal database rules.** The database enforces keys, foreign keys with an explicit `ON DELETE`, `NOT NULL`, uniqueness the code cannot guarantee under concurrency, indexes for known queries, the composite foreign key that ties a fact row to a claim of its own type, and two rules that never change: a preferred claim is verified, and a verified claim has a source. Allowed values, ranges, lengths, formats and the workflow live in `domain/` as `as const` arrays and validators with unit tests. No other `CHECK`.
- **No soft delete anywhere.** Villages are archived through `publication_status`, accounts are disabled through `status`, claims are withdrawn or rejected. Removing spam or personal data is an admin-only, audited hard delete (`deleteWithVersion` in the kernel).

## Alternatives considered

| Option                                                | Pros                                                        | Cons                                                                                                       | Why rejected                                                |
| ----------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Copy source and review columns into each fact table   | No join on reads; each module fully independent             | 13 copies of the same columns, constraints and indexes; review queue and conflicts become a 13-table UNION | Easy to forget one copy; review logic duplicated            |
| One generic `claim` table with a JSON value           | One table, no fact tables                                   | No typed columns, no real queries or indexes on values                                                     | Values could not be queried, sorted or constrained          |
| Edit facts in place and keep an audit log             | Simplest tables                                             | Only one value per fact; disagreement lives only in the log                                                | Hides disagreement between sources, which the brief forbids |
| **Shared `claim` table + typed fact tables (chosen)** | Provenance, review and conflicts in one place; typed values | Every fact read joins `claim`; raw-SQL cross-module FKs                                                    | —                                                           |

## Consequences

- **Positive:** the rules that must never break live in the database (one published answer per question, published means verified, verified means sourced, no duplicate entries, a fact belongs to its own type); every other business rule lives in tested domain code that changes without migrations; one set of curation endpoints (`POST /claims/{id}/verify`) serves every module; the review queue and conflict detection are one query each; no `deleted_at` filters anywhere.
- **Negative:** every fact read joins `claim` (one-to-one on the primary key); `group_key` and `value_hash` must be built consistently (one pure, unit-tested function per type); cross-module foreign keys are raw SQL in custom migrations; reviewed facts are immutable, so corrections are new claims.
- **Follow-up:** `claim`, its constraints and the `ClaimWriter` facade (#16); review actions and the queue (#35, #40); fact tables with their endpoints (#17, #22, #27, #28, #34); sources without value CHECKs or `deleted_at` (#13).
