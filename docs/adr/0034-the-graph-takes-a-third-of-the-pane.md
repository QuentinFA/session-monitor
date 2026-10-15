# 0034. The graph takes at most a third of the pane

- Status: accepted
- Amends: 0022, § "Consequences"
- Date: 2026-10-15

## Context

ADR 0022 left the graph's width uncapped: in a repository with many branches, **All branches** opens
a lane for each, and in a pane docked beside the conversation the lanes took the room the subjects
needed.

## Decision

The graph takes at most a sixth of the pane's columns in lanes — a third of its width, two
characters a lane — and never fewer than three lanes. What lies past the last lane kept folds into
its cell: `…●` when the row's commit is out there, `… ` when only lanes are, in the color of the first
lane cut away. An opened commit's gutter is cut the same way.

## Consequences

- A commit in a folded lane is drawn at the edge, not in its own column: where several are, their
  lanes cannot be told apart. Widening the pane brings them back.

## Alternatives considered

- Scrolling the graph sideways — the pane has no horizontal scroll to give.
