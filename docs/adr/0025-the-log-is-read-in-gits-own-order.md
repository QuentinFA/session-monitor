# 0025. The log is read in git's own order, and a failure says why

- Status: accepted
- Date: 2026-10-15

## Context

The Git tab first read the log with `--topo-order`, which guarantees a commit is listed before its
parents. To do so git walks every commit the refs reach before printing the first one, unless the
repository has a commit-graph file. In a live session, **All branches** — every remote branch's
history to walk — drew nothing, while **Current branch** drew its history. A failed or timed-out read
was drawn as one dim line, easy to take for an empty tab.

## Decision

- The log is read in git's default order, which prints as it walks. The layout opens no lane for a
  parent already listed, the one case that order allows and topological order would not: a commit
  dated before its parent.
- The read has 20 seconds. When it fails, the tab says so in red, with git's own first line of
  error; a failure is not kept, so the next drawing asks again.

## Consequences

- With clocks skewed between commits, a parent can be listed above its child; its lane is not drawn
  from the child down to it. Rare, and the rows stay right.
- Whether the walk was the cause of the empty tab was not confirmed; the error now drawn will say,
  if it happens again.

## Alternatives considered

- `--date-order` — the same full walk as `--topo-order`.
- Writing a commit-graph file for the user — the tab does not write to a repository (ADR 0022).
