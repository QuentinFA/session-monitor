# 0002. Outputs are grouped by directory, and what was used is kept with what was produced

- Status: accepted
- Date: 2026-10-08

## Context

A list of edits alone does not say what a session *did*: the commands it ran and the files it read
are half the picture, and they mean little without where they happened.

## Decision

One group per git root, or per directory outside any repo, holding its commands, reads, edits,
branches, commits and pushes. Paths are resolved through symbolic links before grouping, since git
reports roots that way (`/tmp` is `/private/tmp` on macOS).

## Consequences

- A command is filed under one directory even when it touches several; the files it changes are
  filed under each file's own directory.
- Directories where only commands ran are kept: they are what the session used.
- Two checkouts of one repository — a worktree beside the main one — are two groups.

## Alternatives considered

- One flat timeline — it buries the per-repo answer the pane exists for.
