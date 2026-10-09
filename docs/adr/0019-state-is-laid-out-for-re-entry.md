# 0019. State is laid out for re-entry: exceptions first, the last activity as the cue

- Status: accepted, amended by 0020
- Amends: 0018, § "Decision"
- Date: 2026-10-09
- References: research below

## Context

State has to make `/recap` unnecessary: a person returning to a session must be able to carry on
from the pane alone. The first layout listed sections of equal weight, and summarised each turn by
the first line of Claude's answer — "Steps 1 and 2 behaved as expected" — which says nothing about
what was done.

What the research says a returning person needs:

- **Cues from just before the interruption** cut the time to resume (Altmann & Trafton, *Task
  interruption: resumption lag and the role of cues*). Developers given cues completed resumed
  tasks twice as often as with notes alone, and preferred a **chronological trail of their recent
  activity**; a main failure on return is forgetting to do something critical (Parnin & DeLine,
  CHI 2010; Parnin & Rugaber, 2011).
- **Agent interfaces**: name the state explicitly (working, waiting on you, interrupted, error), make
  a request for input say the decision, show elapsed time rather than invented progress, and
  surface the few things that mattered rather than every step (agent UX pattern write-ups, 2026).
- **Dashboards**: what needs attention first, colour only for exceptions, normal kept quiet, detail
  left to drill-down, readable in about five seconds (dashboard design guides).

## Decision

> **Amended by [ADR 0020](0020-needs-you-lists-only-what-asks-for-a-decision.md):** blocked calls are not listed under Needs you; they stay in Outputs.

From the top:

1. **The state label** — working (for how long, on which tool), waiting on you (since), interrupted,
   or stopped — with the position on the same line, quiet: branch, ahead/behind, changed count or
   clean, the PR and a check mark.
2. **Needs you**, only when something does: Claude's question in flight, the question its last
   answer ended on, failing checks by name, merge conflicts, requested changes, commits behind the
   upstream, blocked calls. Red for failures, yellow otherwise.
3. **You asked** — the person's last request in their own words, and whether it was answered,
   interrupted or is in progress.
4. **Last activity** — the last four things done, oldest first: edits, created files, commands that
   changed something, commits, pushes, branches, GitHub writes; another repository's name shown when
   it is not the working one. Outputs keeps this trail, timestamped.
5. **Running** — background commands not yet finished.

Turn summaries are gone. Commands that only look (`ls`, `cat`, `grep`, `git status`, `gh pr view`,
…) are not activity.

## Consequences

- The pane is usually six to ten lines; an empty section is not drawn.
- "Only looks" is a list of commands: one missing from it shows as activity. A step that writes
  through a redirect to a file (`cat > notes`, `echo x >> log`) counts whatever command it starts
  with; `2>&1` and `>/dev/null` do not.
- The trail holds forty entries; Outputs keeps the full record.

## Alternatives considered

- The first layout, a section per kind of fact with turn summaries — sections of equal weight hide
  what needs the person, and the summaries were not informative.
- Asking a small model to summarise each turn — a cost per turn, and a cue the person did not see
  happen; the trail is what actually happened.
