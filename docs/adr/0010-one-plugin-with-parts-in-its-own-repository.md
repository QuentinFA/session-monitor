# 0010. One plugin with parts, in its own repository

- Status: accepted, amended by 0012
- Date: 2026-10-09

## Context

It began as one mod, `session-outputs`, inside a repository of skills. Three more were planned
beside it — the session's state, notes for later, and an analysis of what went wrong — all watching
the same session, sharing path and git handling, and feeding the `reflect` skill.

## Decision

> **Amended by [ADR 0012](0012-one-pane-with-a-tab-per-part.md):** the parts draw in one pane, each on its own tab, not a pane each.

One plugin, `session-monitor`, in its own repository. Each part is a module under `src/` that
`hooks/register.tsx` composes, with its own pane, so the panes show as tabs. Shared code goes in
`src/lib/` as it appears.

## Consequences

- The link to `reflect` becomes a contract across repositories: this plugin writes what `reflect`
  should read to a known file, and the skill reads it when present.
- The parts share `src/lib/`, but neither `$` nor a state reference crosses a file boundary for the
  validator, so what is shared is plain functions and constants (see `CLAUDE.md`).

## Alternatives considered

- A mod per part in the skills repository — four plugins to install, version and load, duplicating
  the shared code, in a repository whose subject is skills.
- One module for everything — the parts are independent enough to test, and to break, separately.
