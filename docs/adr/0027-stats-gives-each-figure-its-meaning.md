# 0027. Stats shows the status line's figures, each with what it means

- Status: accepted, amended by 0028, 0029
- Date: 2026-10-15

## Context

A status line has one row to share between every figure, so it shows them as numbers and symbols
and leaves most out; a person has to remember what each means. The engine hands a plugin what a
status line gets — the context window, the plan's rate-limit windows, the session's cost and start —
and more: the context broken down as `/context` breaks it, and each turn's time and tokens.

## Decision

> **Amended by [ADR 0028](0028-stats-shows-only-what-the-engine-reports.md):** only the engine's figures are shown; Tokens, Turns, Lines and Git are gone, Prompt cache is added.

> **Amended by [ADR 0029](0029-a-stat-stacks-its-details-and-definition.md):** details and definition go under the value, wrapped; the bar fits the pane's width.

A **Stats** tab shows, one figure a row, a label, the value, its details, and under it a one-line
definition in plain words:

- **Context** — percent of the window, a bar, tokens over the window; a fold opens the breakdown by
  category (`summary`: estimated locally, no request sent), read only while open.
- **Plan limits** — each rate-limit window reported (5-hour, weekly, a gateway's spend limit), with
  a bar and when it resets; "not reported yet" before the first, or on an API key.
- **Cost**, **Tokens** (in, from cache, out), **Turns** (count, average and last answer time),
  **Session** (time since start, model, directory), **Lines** added and removed, and **Git** (branch,
  ahead/behind, uncommitted files) for the working directory.
- Bars go yellow from 50% and red from 80%.
- **Hide definitions** folds every definition once they are known.

## Consequences

> **Amended by [ADR 0028](0028-stats-shows-only-what-the-engine-reports.md):** nothing is counted by the plugin any more.

- Turns and tokens are counted from `turn.complete` while the plugin runs — from when it loaded, not
  from the session's start; a subagent's tokens count, its turns do not. The engine gives no
  session-wide token total.
- A cost across sessions (today, the week) is not shown: the engine counts this session only.
- The tab redraws when a turn ends; time since start moves on each drawing, not every second.
- Git is read again after a command or an edit, or when 30 seconds old (as ADR 0024).

## Alternatives considered

- The status line's segments alone — what it leaves out for room is what a tab has room for.
- Definitions folded behind each figure — less clear; the button that hides them all keeps the
  tab compact for someone who knows them.
