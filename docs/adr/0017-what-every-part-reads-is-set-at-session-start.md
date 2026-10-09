# 0017. What every part reads is set when the session starts

- Status: accepted
- Amends: 0012, § "Consequences"
- Date: 2026-10-09

## Context

ADR 0012 left each part to do its own start-up lazily, on first use, since the plugin has one
`session.start`, in `hooks/register.tsx`. Outputs read the home directory that way, on the first
call it recorded. After a reload nothing had been recorded yet, so the pane was drawn — and copied —
with full paths instead of `~/…`, including the paths already in the record.

## Decision

What a part needs before it records anything is read in the plugin's `session.start` — which fires
again on every reload — and kept in state, where every file declares its own reference to it. The
home directory is the first such value. Work that belongs to recording stays lazy.

## Consequences

- `hooks/register.tsx` knows a little of what the parts need at start; the parts read it from state,
  never through an import, which the validator would refuse.

## Alternatives considered

- Reading it while drawing — a process call inside every redraw.
- Keeping it in a module variable set lazily — what failed: module variables start over on a
  reload, and drawing can come before the first recording.
