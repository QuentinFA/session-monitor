# 0033. The plugin writes nothing to the status line

- Status: accepted
- Amends: 0001, § "Decision"
- Amends: 0013, § "Decision"
- Date: 2026-10-15

## Context

Outputs kept a one-line count beside the status line — `1 dir · +1940 −348 · 9 commits`, refusals
added — from before the monitor had tabs. The status line is the person's own, set up with what they
chose to see there; an entry the plugin adds sits in it unasked, warning-marked, and repeats what the
pane shows.

## Decision

The plugin writes nothing to the status line: what it records is drawn in the monitor's pane only.

## Consequences

- Nothing tells that the record grew without opening the pane.

## Alternatives considered

- An option to turn the entry on — nothing has asked for it.
