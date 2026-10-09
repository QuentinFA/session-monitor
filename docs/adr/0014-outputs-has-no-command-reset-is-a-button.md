# 0014. Outputs has no command of its own; Reset is a button

- Status: accepted
- Amends: 0012, § "Decision"
- Date: 2026-10-09

## Context

`/outputs` opened what `/session-monitor outputs` opens, and its other job, `/outputs reset`, was
out of reach from the pane where the record is read.

## Decision

`/outputs` is gone, and the summary it printed with it. The Outputs tab's toolbar has **Reset**,
which asks once more — **Confirm reset** or **Cancel** — before clearing the record.

## Consequences

- `/session-monitor` prints only that it opened; the record's text form is Copy all.
- A session that loaded an earlier version may still list `/outputs` until the plugin reloads.

## Alternatives considered

- Keeping `/outputs` as an alias — a command per tab is what the single pane replaced.
- A one-press Reset — a button with a hotkey sits one stray key from wiping the session's record.
