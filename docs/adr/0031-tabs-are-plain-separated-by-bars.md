# 0031. The tabs are plain labels separated by bars, without hotkeys

- Status: accepted
- Amends: 0012, § "Decision"
- Date: 2026-10-15

## Context

Docked beside the conversation the pane is some 45 columns wide, and the tab row — a bracketed
button per tab, then "session monitor" — took most of it. A `plain` Button drops the brackets, but
draws its hotkey before its label (`1: Outputs`), which would take back the room saved.

## Decision

The tabs are plain buttons separated by `|`: the tab on show at full strength, the others dim. They
have no hotkeys, and the row no "session monitor" label: the pane's title says it. A tab is reached by
a click, the focus ring, or `/session-monitor <tab>`.

## Consequences

- A digit no longer switches tabs.

## Alternatives considered

- Plain buttons with their hotkeys — `1: Outputs | 2: Git | …` is wider than the brackets were.
