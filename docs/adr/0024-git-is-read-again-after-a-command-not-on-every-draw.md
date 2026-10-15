# 0024. Git is read again after a command, not on every draw

- Status: accepted
- Date: 2026-10-15

## Context

The pane is drawn again whenever any state it reads changes — Outputs records on every tool call.
ADR 0017 already turned down a process call inside every redraw. Yet the history must not go stale
while the session commits, branches and pushes.

## Decision

The log a drawing reads is kept, per repository, scope and length, and read from git again when:

- a Bash command has run — any one may move a ref or touch the work tree; the tab redraws if shown;
- **↻** is pressed;
- it is more than 30 seconds old when the pane is drawn.

An opened commit's details are kept for the session: a commit does not change.

## Consequences

- What changes a repository outside the session — another terminal, an editor — shows on the next
  draw after 30 seconds, or on ↻.
- An edit through Edit or Write does not reread git: the uncommitted count may lag until the next
  command or ↻.

## Alternatives considered

- Reading git on every draw — a process call per state change anywhere in the plugin.
- Watching each repository's `.git` for changes — not tried; the three triggers above were judged
  enough for a first version.
