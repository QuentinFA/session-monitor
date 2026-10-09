# 0012. One pane with a tab per part

- Status: accepted, amended by 0014
- Amends: 0010, § "Decision"
- Date: 2026-10-09

## Context

With a pane per part, the parts show as the engine's own tabs: mixed with other plugins' panes,
drawn only while more than one pane is open, and reached through a command per part.

## Decision

> **Amended by [ADR 0014](0014-outputs-has-no-command-reset-is-a-button.md):** `/outputs` is gone; its tab is reached through `/session-monitor`.

One pane, opened by `/session-monitor [tab]`, with its own tab row — a button per part, its digit
as hotkey — and the tab on show kept in state. The monitor's render hook draws the row and asks the
chain for the body; each part's render hook answers on its own tab and passes on the others.
`/outputs` stays, as a shortcut to its tab. A tab appears once its part exists.

## Consequences

The plugin's one unmatched `session.start` is in `hooks/register.tsx`, which declares every part's
commands; a part does its own start-up lazily, on first use.

## Alternatives considered

- A pane per part — the layout above, which the plugin does not control.
- Each part exporting a draw function for the monitor to call — the validator follows `$` only into
  functions of the same file, never across an import.
