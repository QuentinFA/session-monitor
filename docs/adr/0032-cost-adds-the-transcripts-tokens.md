# 0032. Cost adds the transcript's tokens, and the transcript is found at once

- Status: accepted
- Amends: 0030, § "Decision"
- Date: 2026-10-15

## Context

The engine gives the session's cost but no token totals. The transcript has every response's usage,
written once per content block, so a response appears on several lines; summing every line counts
it two or three times (what a status line that does so shows). Subagents keep transcripts of their
own, under `<session>/subagents/`. ADR 0030 learned the transcript's path at the next prompt, so a
plugin reloaded mid-session showed no countdown until then.

## Decision

- The Cost row adds the session's tokens — in (new and written to cache), read from cache, out —
  summed over the transcript and its subagents', each response once, by its message id. A file is
  read from where the last reading stopped, 3 MB at a time, after each turn.
- Until a prompt reports the transcript's path, it is found by the session's id under
  `~/.claude/projects`, and kept in memory: a drawing may not write state.
- The 30-second redraw starts from the prompt and turn hooks, not from a drawing.

## Consequences

- The first reading of a long session's transcript takes a moment; later ones read only what was
  added.
- A configuration folder other than `~/.claude` is not searched; the path then comes with the next
  prompt.

## Alternatives considered

- Summing every line — counts most responses more than once.
