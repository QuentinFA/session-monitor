# 0001. The session's outputs are recorded by a mod, not a status line or a skill

- Status: accepted
- Date: 2026-10-08

## Context

A session that works across several repositories leaves its outputs scattered: a branch in one, a
commit in another, a pull request on GitHub, a file edited outside any repository. Claude Code's
status line is given line counts for the current directory's repository only, and reconstructing the
rest after the fact means a model turn spent reading the transcript. What a session produced should
be visible while it runs, across every repository, at no cost in tokens.

## Decision

A mod that records from tool calls as they happen and draws a pane, with a one-line status entry
beside it.

## Consequences

- Recording starts when the plugin loads: work done earlier in the session is not in it.
- The record lives in the session's state. It survives a reload of the plugin, not the end of the
  session.
- Only tool calls are recorded. What the person does in their own terminal is not in it — this is the
  session's record, not the machine's.

## Alternatives considered

- A status-line script — its input describes the current directory's repo only, so multi-repo work
  is invisible.
- A skill — it would have to reconstruct the session after the fact from the transcript, spending
  model turns on what event hooks see for free.
