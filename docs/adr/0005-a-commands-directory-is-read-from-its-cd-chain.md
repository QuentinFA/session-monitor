# 0005. A command's directory is read from its cd chain, heredoc bodies excluded

- Status: accepted
- Date: 2026-10-08

## Context

Commands were filed under the wrong directory: `cd /a && git -C b …` went to the session's
directory instead of `/a/b`, a trailing `cd ..` was resolved against the session's directory, and a
heredoc's body was parsed as if its `cd`, `git` and `gh` lines ran.

## Decision

Heredoc bodies are removed before any parsing; `cd`s are followed in order, each from the last; a
`git -C` is resolved from the `cd`s before it; `~` expands to the home directory.

## Consequences

- A `cd` into a shell variable (`cd $DIR`) or `cd -` is not followed: the command is filed under the
  directory before it.
- A command is filed where its `cd`s end, so `cd hooks && … && cd .. && validate` is filed under the
  parent. That is intended: later commands in the chain ran there.

## Alternatives considered

- Asking the shell — the mod sees the command before and after it runs, not the shell's state, and
  running it again is not an option.
