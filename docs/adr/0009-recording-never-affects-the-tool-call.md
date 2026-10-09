# 0009. Recording never affects the tool call

- Status: accepted
- Date: 2026-10-08

## Context

The plugin runs git, reads the file system and writes state around every tool call. A failure there
— a git call that times out, a path that cannot be resolved — must not fail the call it is observing:
an observer that breaks the session is worse than none. The validator flags a hook that awaits
`next` without a `.catch` for the same reason.

## Decision

Each recorder is caught inside its hook, and each hook is registered with a `.catch` that replays
the call's result. A failed recording loses that entry, never the tool call.

## Consequences

- A recording that fails loses its entry without a word: the pane can under-report, never break a
  call.
- The git snapshot that precedes a Bash command runs before the call, to see what the command
  changes. It is capped at two seconds (ADR 0003), and its failure only skips that fallback.

## Alternatives considered

- Recording before `next(e)` — the result is not known yet, and a slow recorder delays the call.
- Relying on the engine skipping a failed hook — it does, but a hook that failed after calling
  `next` leaves the call's result to the engine's recovery; a `.catch` replaying `next` makes the
  outcome explicit.
