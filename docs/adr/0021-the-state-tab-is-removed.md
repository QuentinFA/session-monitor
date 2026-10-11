# 0021. The State tab is removed

- Status: accepted
- Supersedes: 0018
- Supersedes: 0019
- Supersedes: 0020
- Date: 2026-10-11

## Context

The State tab was meant to make `/recap` unnecessary: a person returning to a session should pick up
from the pane alone. It read only what already existed — git, `gh`, the session's turn events, the
tool calls — and gave the model no tool (ADR 0018). It went through five layouts in two days of live
testing (ADRs 0019, 0020 and the fixes after them).

What held: the state label (working, waiting, interrupted), the position line, and the list of what
asks the person for a decision were accurate in every live check.

What did not: after a real fifty-three-minute break, the pane did not say what the session had been
doing. "You asked" quoted pane text the person had pasted, since the engine passes a prompt with
pastes already expanded and unmarked. The activity trail was accurate and meaningless —
`claude plugin test .`, `git push -q` — at the granularity of tool calls, not of the work. Re-entry
needs a statement of what was being done and what comes next; nothing in the session records that
except the conversation itself.

## Decision

The State tab is removed, with the activity trail Outputs kept for it. The plugin keeps its other
parts. ADRs 0018–0020 stay as the record of what was tried.

## Consequences

- `/recap` stays the way back into a session.
- If re-entry is taken up again, it starts from the conclusion above, not from another layout: the
  options left open were showing Claude's own closing paragraph, a short summary per turn by a small
  model, or a summary on demand — each weighed in the session that ended the tab, none built.

## Alternatives considered

- Keeping only the parts that held (label, position, Needs you) — accurate, but not what the tab was
  for, and the person found nothing usable in it.
- Another layout — the gap was in the data, not the drawing.
