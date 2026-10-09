# 0004. Command text and git back up the engine's git and GitHub reports

- Status: accepted
- Date: 2026-10-08

## Context

A hook that rewrites command output (to save tokens, say) changed `git commit`'s output to a
one-line summary. The engine's structured report of the commit went missing, and with it the
commit; `gh` output lost its URLs the same way.

## Decision

The engine's `gitOperation` stays the first source. Behind it: a `git commit` command that moved
HEAD records the new HEAD; branches, deletions and worktrees are read from the command text; and a
PR or issue URL missing from the output is rebuilt from the repo's GitHub remote and the number. A
`gh` write whose command exited with an error is still recorded, marked as such — `gh pr close
--delete-branch` can close the PR and then fail on the local branch switch.

## Consequences

- The engine reports one commit per command, the last. A command that committed more than once lost
  its earlier commits, so when a `git commit` command moved HEAD, every commit between the HEAD
  before and after it is recorded, the engine's report labelling the one it names.
- A URL rebuilt from the remote assumes `origin` is the repository `gh` acted on: a
  `gh --repo other/repo` call whose output lost its URL gets a link into the wrong repository.
- A failed `gh` write is listed as "(command exited with an error)" even when the write itself went
  through — do not drop it: the exit code cannot tell which part of the command failed.

## Alternatives considered

- Parsing command output — it is exactly what the rewriting hook changes.
