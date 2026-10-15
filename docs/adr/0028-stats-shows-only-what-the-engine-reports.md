# 0028. Stats shows only what the engine reports

- Status: accepted, amended by 0030
- Amends: 0027, § "Decision"
- Amends: 0027, § "Consequences"
- Date: 2026-10-15

## Context

ADR 0027 put beside the engine's figures some the plugin made itself: tokens and answer times
summed from `turn.complete` since the plugin loaded, lines from Outputs, git from a status of its
own. On the tab they read as the session's figures while counting something narrower, and lines and
git repeat the Outputs, Git and Changed tabs.

Asked about the prompt cache: the engine reports its time to live (`5m` or `1h`) and whether it is
warm only to a model switch (`PreModelSwitch`, `PostModelSwitch`); a response's usage does not split
cache writes by lifetime. The last response's cache reads and writes are in the context breakdown's
`apiUsage`.

## Decision

> **Amended by [ADR 0030](0030-the-cache-lifetime-is-read-from-the-transcript.md):** the cache's lifetime and how long it stays warm are read from the transcript.

Stats shows the engine's figures alone: context, plan limits, cost, the prompt cache, and the
session — its time, model, prompts (`$.session.turns()`) and directory. Tokens, Turns, Lines and Git
are gone. **Prompt cache** gives the share of the last request read from cache, and the tokens read,
written and new; its definition names both lifetimes, since the engine does not say which applies.
The breakdown is asked for on every drawing (`summary`: estimated locally, nothing sent), as it
carries `apiUsage`.

## Consequences

> **Amended by [ADR 0030](0030-the-cache-lifetime-is-read-from-the-transcript.md):** the tab now counts the cache down; the lifetime comes from the transcript.

- No row counts from when the plugin loaded: every figure is the session's, as the engine has it.
- The tab cannot say how long the cache stays warm: a countdown would need the lifetime, which the
  engine reports to a model switch only.

## Alternatives considered

- A countdown since the last request against both lifetimes — two guesses where one fact is missing.
- Recording the lifetime from model switches — known only after a switch, and it can change mid
  session without one.
