# 0030. The cache's lifetime is read from the transcript

- Status: accepted, amended by 0032
- Amends: 0028, § "Decision"
- Amends: 0028, § "Consequences"
- Date: 2026-10-15

## Context

ADR 0028 left the prompt cache without a countdown: the engine reports the cache's lifetime to
plugins only on a model switch. The session's transcript has it for every request: each API response
is kept with its usage whole, cache writes split into `ephemeral_5m_input_tokens` and
`ephemeral_1h_input_tokens`, with the time it was answered. A plugin learns the transcript's path
from any classic hook's envelope (`transcript_path`), and reads its end with `tail`.

## Decision

> **Amended by [ADR 0032](0032-cost-adds-the-transcripts-tokens.md):** the transcript is also found by the session id; Cost adds its tokens.

The Prompt cache row adds the lifetime and how long the cache stays warm: `1h cache · warm until
23:00 (59m left)`, or `expired 7m ago: the next request writes it again`. The time counts from the
main conversation's last request; the lifetime is that of the latest cache write. Subagents' requests
are left out, their cache being their own. The path is recorded at each prompt
(`classic.UserPromptSubmit` — the plugin's one `classic.Stop` is Outputs'); the last 200 lines are
read again after each turn, and the tab is drawn again every 30 seconds while shown.

## Consequences

- Until the first prompt after the plugin loads, the path is unknown and the row has no countdown.
- The transcript's format is the engine's, not an API; if it changes, the row says the lifetime was
  not found rather than guessing.
- A request that only read the cache refreshes it for the lifetime it was written with: the latest
  write's lifetime is taken for the whole cache.

## Alternatives considered

- Both lifetimes as a guess (ADR 0028) — the transcript says which one applies.
