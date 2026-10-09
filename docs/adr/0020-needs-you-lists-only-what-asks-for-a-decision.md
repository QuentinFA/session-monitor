# 0020. Needs you lists only what asks for a decision, and position is read on first draw

- Status: accepted
- Amends: 0019, § "Decision"
- Amends: 0018, § "Consequences"
- Date: 2026-10-09

## Context

Trying the re-entry layout after a reload, the person saw one line under Needs you — "2 blocked
calls → Outputs" — and judged it noise: a refused call has already happened, and nothing asks them
to decide anything about it. The same try showed the position as "not read yet" until something
happened in the session, though the person had just come back to it.

## Decision

- **Needs you** lists only what asks the person for a decision or an action: Claude's open
  question, the question its last answer ended on, failing checks, merge conflicts, requested
  changes, commits behind the upstream. Blocked calls stay in Outputs.
- **The position is read the first time the tab is drawn** after a load, not only on the first
  event: the drawing schedules the read to run right after it, since a drawing may not write state.

## Consequences

- A session whose only notable fact is a refusal shows no Needs you section at all.
- Opening the tab after a reload shows "not read yet" for the moment the read takes — about a second
  with a pull request to look up.

## Alternatives considered

- Keeping blocked calls, dimmed — still a line asking for attention that requires none.
- Reading the position in the plugin's `session.start` — that hook lives in `hooks/register.tsx`,
  and the read is State's; the validator does not let one file call the other's `$` code.
