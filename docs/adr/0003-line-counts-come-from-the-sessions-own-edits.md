# 0003. Line counts come from the session's own edits

- Status: accepted
- Date: 2026-10-08

## Context

Several sessions can share a worktree, so the repository's diff is not one session's work. Counting
lines changed has to tell this session's edits from anyone else's. A shell edit — `sed -i`, a
formatter, a redirect — reaches the engine as a Bash call, and its per-file diff is not always
attached: in testing, a `sed` edit in a second repository arrived with none.

## Decision

Count from what each tool call reports: Edit and Write patches, the engine's per-file diff on Bash
results, and each commit's own `numstat`. When a Bash command carries no diff — the engine does not
always attach one — compare the repo's `git diff --numstat HEAD` and untracked files before and
after the command.

## Consequences

The before/after comparison costs three git calls before each Bash command, capped at two seconds.
A file already changed in the session gets approximate counts, a change another session makes
*during* the command is counted, and a command that edits and commits at once has its commit
recorded but not its edits. Outside a repo, only the engine's diff is seen.

## Alternatives considered

- Diffing each repo against the HEAD it had when the session first touched it — it catches
  everything, but counts another session's work in a shared worktree as this one's.
