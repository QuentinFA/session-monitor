# 0018. State shows what already exists, and guesses nothing

- Status: accepted, amended by 0019
- Date: 2026-10-09

## Context

The State tab answers "where does this session stand, and what needs me?" — the question the
`recap` skill answers on request, at the cost of a model turn. A first idea gave the model tools to
report what it had done, what it needed and what came next.

An attempt at the same shape for follow-ups was set aside: giving the model a tracking tool builds a
new system beside the ones it already uses (memory, task tools, scheduled work), and Claude Code had
just removed its own task-tracking tools from current models because they track their steps
unaided. The monitor's job is to make the session visible, not to change how the model works.

## Decision

> **Amended by [ADR 0019](0019-state-is-laid-out-for-re-entry.md):** the sections are reordered for re-entry, turn summaries replaced by the activity trail and the request in the person's words.

State reads only what the engine, git and GitHub already hold, and gives the model no tool:

- **Position** — the working directory's branch, upstream, ahead/behind and tree counts from
  `git status`, and its branch's pull request from `gh pr view`: state, draft, review decision,
  mergeability and a check summary with the failing checks named.
- **Now** — Claude working (since when, which tool) or waiting on the person, from `prompt.submit`,
  `tool.call` and `turn.complete` on the main loop.
- **Needs you** — each item derived from a source it names: an `AskUserQuestion` in flight, a last
  answer whose final line ends in a question, failing checks, changes requested, merge conflicts,
  calls blocked this session.
- **Recently done** — the last six finished turns: time, duration as the engine measured it, how
  the turn ended, and the first line of the answer.

There is no **Next**: nothing in the session records it, and the tab does not guess.

It refreshes when a main-loop turn ends, after a Bash command running `git` or `gh`, every 60
seconds, and on its Refresh button — never while drawing.

## Consequences

- "Ends on a question" is a heuristic on the answer's last line: a rhetorical question shows as one,
  and a question asked mid-answer does not. The item quotes the line so the person can judge it.
- A permission prompt waiting on the person is not listed: the hooks cannot tell a call waiting on
  the prompt from one running.
- Position follows the session's working directory only. Other repositories the session touched are
  in Outputs.
- `gh` takes about a second, so a PR change shows up to a minute late unless a turn ends or Refresh
  is pressed. A `gh` that fails for any reason but "no pull request" is shown as "PR unknown", never
  as "no pull request".
- The plugin may hold one unmatched `tool.call` hook (Outputs' catch-all); State observes every tool
  through a pattern matcher, `{ tool: /^/ }`.
- The periodic refresh starts on the first event State sees after a load, so a freshly reloaded,
  idle session shows "not read yet" until then or until Refresh.

## Alternatives considered

- Tools for the model to report done / needs / next — a second tracking system the model must
  remember to feed, the shape set aside for follow-ups.
- A small model summarising each turn — a cost per turn, and a summary of a summary; the answer's
  own first line is what the model chose to lead with.
- Reading the PR on every redraw — a second of `gh` per draw.
