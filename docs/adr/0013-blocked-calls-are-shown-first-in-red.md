# 0013. Blocked calls are shown first, in red

- Status: accepted, amended by 0015
- Date: 2026-10-09

## Context

A call refused before it ran — by a hook, a permission rule or check, or the person at the prompt —
left no trace: the recorders returned on a refusal, so a blocked `git push --force` looked like
nothing happened.

## Decision

> **Amended by [ADR 0015](0015-blocked-folds-like-every-section.md):** Blocked folds like every other section, collapsed by default.

A refused call is recorded under **Blocked**, at the top of the tab in red, with its tool, what it
would have touched, the reason and its directory; a refused command or read is also marked red in
its directory's list — a refused edit is not, since nothing changed — and the status line counts
them. Three routes report a refusal — a `deny` result, `classic.PermissionDenied`, and an error
result whose text says the person declined — and the call's id keeps a refusal reported twice once.

## Consequences

- A decline at the prompt is recognised by its wording ("doesn't want to proceed", "was rejected"),
  not by a field: if core rewords it, those declines read as ordinary failures until the pattern
  follows.
- A call refused and later allowed shows twice: the refusal under Blocked, the run in its directory.
  Both happened.
- A read inside the working directory is allowed without a prompt in manual mode, so it is never
  refused there — a read can only be declined outside it.

## Alternatives considered

- Treating every error as blocked — a command that ran and failed is a failure, shown as one, not a
  refusal.
