# 0008. The Outputs tab is collapsed by default, with outputs first

- Status: accepted
- Date: 2026-10-08

## Context

Fully expanded, the pane overflowed its height and pushed the GitHub section — the outputs that
matter most — out of view.

## Decision

GitHub, services and scheduled work come first; each directory collapses to one summary line;
directories where only commands ran come last, dimmed. **Expand all / Collapse all** and **Copy
all** sit at the top; the copy is the full record as markdown, with multi-line commands shortened
to their first line.

## Consequences

- Opening the pane shows one line per directory; the detail is a click, or Expand all, away.
- The copied report is complete whatever is folded.

## Alternatives considered

- Leaving it expanded and scrolling — the pane scrolls only while it has the keyboard, and the point
  is to see the outputs at a glance.
- Keeping only the last entries of each list — what a session produced early is often what matters.
