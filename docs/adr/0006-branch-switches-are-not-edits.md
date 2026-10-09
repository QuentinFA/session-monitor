# 0006. Branch switches are not edits

- Status: accepted
- Date: 2026-10-08

## Context

`checkout`, `switch`, `pull`, `merge`, `rebase`, `stash` and `worktree` rewrite the working tree
without the session writing anything.

## Decision

Their working-tree changes are not counted as edits.

## Consequences

- `git stash pop` or `git checkout -- <file>` of the session's own edits is not counted again: those
  lines were counted when first written.

## Alternatives considered

- Counting them — a branch switch would show as hundreds of lines the session never wrote.
