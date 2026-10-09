# 0007. Deleted branches are followed, locally and on the remote

- Status: accepted
- Date: 2026-10-08

## Context

A branch created and then deleted still read as created, and deleting a branch the session did not
create left no trace — though a deletion is as much an output as a creation.

## Decision

`git branch -d/-D/--delete` and `git push --delete` / `push <remote> :name` are recorded. A deleted
branch the session created is struck through in place; others are listed under *deleted* and
*deleted on remote*.

## Consequences

- A branch deleted outside the session — by another session, or the person — is not noticed: only
  the session's own commands are read.
- `git branch -m` renames, and is recorded as neither creation nor deletion.

## Alternatives considered

- Dropping a deleted branch from the list — it would hide that the session created it, and a branch
  deleted on a remote is a change other people see.
- Asking git which branches exist when drawing — a git call on every redraw, and it cannot tell a
  branch the session deleted from one it never made.
