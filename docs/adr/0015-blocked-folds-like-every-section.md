# 0015. Blocked folds like every other section

- Status: accepted
- Amends: 0013, § "Decision"
- Date: 2026-10-09

## Context

ADR 0013 put refused calls at the top of the Outputs tab, always open. Every other section of the
tab folds — each directory, its reads, its commands, the services used — and opens with Expand all
(ADR 0008). Blocked was the one section that could not be folded away, so once a session had a few
refusals they held the top of the pane whatever the person was reading.

## Decision

Blocked folds like the rest: a red header — ▸, **Blocked**, and the count — collapsed by default,
opened by its own toggle or by Expand all. It stays first, and stays red.

## Consequences

- A refusal no longer shows its detail at a glance; the red header and its count, and the status
  line's `· N blocked`, are what signal it.
- The copied report lists every refusal whatever is folded, as it does for every section.

## Alternatives considered

- Open by default, foldable on request — the one section behaving unlike the others, which is the
  inconsistency this replaces.
