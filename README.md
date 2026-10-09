# session-monitor

A Claude Code plugin of panes that follow a session as it runs — no skill to invoke, no model turn
spent: it records from the session's own events and is always there.

`/session-monitor` opens one pane with a tab per part — click a tab, or press its digit while the
pane has the keyboard. `/session-monitor <tab>` opens it on that tab.

| Part | Tab | Status |
| --- | --- | --- |
| **outputs** | everything the session used and produced, by directory and across repos | done |
| **state** | where the session stands: branch, tree, PR and checks; whether Claude works or waits; what needs you; the last turns | done |
| **notes** | the work the model defers, made visible — set aside: it must show what the model already records, not add a tracker | rethinking |
| **analysis** | what went wrong and what you corrected, kept for `reflect` | planned |

## outputs

`/session-monitor outputs` opens the monitor on this tab. The status line keeps a one-line count:
`3 dirs · +120 −30 · 2 commits · 1 blocked`.

### What it shows

At the top, in red, **Blocked**: calls refused before they ran — by a hook, a permission rule or
check, or you at the prompt — with the reason and where they would have run.

Then the outputs that leave the machine or outlive the session:

- **GitHub** — PRs and issues created, commented on, closed or merged, with their URLs
- **Services** — MCP calls that wrote something (a draft, an event, a document); read-only calls and
  web searches fold under *services used*
- **Scheduled & running** — cron jobs, routines, worktrees and background commands, marked *done*
  once they finish

Then one group per directory — a git root, or a plain directory outside any repo — collapsed to a
summary line until opened:

- branches created, deleted locally (struck through) and deleted on the remote; pushes
- commits, each expandable to its files with `+/−` lines
- files changed, with `+/−` lines, new and deleted marked
- files read, and every command run there; a refused read or command is marked red

**Expand all / Collapse all** opens every fold. **Copy all** puts the whole record on the clipboard
as markdown. **Reset** clears it, after a confirmation.

## state

`/session-monitor state` opens it. Everything on it is read, never asked of the model:

- **Position** — the working directory's branch, upstream and ahead/behind, the tree's staged,
  modified and untracked counts, and the branch's pull request: state, review, mergeability, checks
- **Now** — Claude working, for how long and on which tool, or waiting on you
- **Needs you** — a question Claude is asking, a last answer ending on a question, failing checks,
  requested changes, merge conflicts, blocked calls
- **Recently done** — the last turns, each by the first line of Claude's answer

It refreshes when a turn ends, after `git` and `gh` commands, every minute, and on **Refresh**.

## Install

Mods are early access. `install.sh` adds this clone to `env.CLAUDE_CODE_PLUGIN_DIRS` in
`~/.claude/settings.json`, where Claude Code loads and watches it, so edits here are live in every new
session. It needs `jq`.

```bash
./install.sh --dry-run   # show what would change
./install.sh             # install
```

For one session only: `claude --plugin-dir /path/to/session-monitor`. A headless `claude -p` also
needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Develop

```
.claude-plugin/plugin.json   manifest
hooks/register.tsx           the module Claude Code loads: the pane, its tabs, the commands
src/<part>.tsx               one part each: its hooks and its tab's body
src/lib/                     what the parts share
types/index.d.ts             the state each part keeps, declared for the engine
tests/<part>.test.ts         tests, run against stand-ins for the engine
```

```bash
claude plugin validate .
claude plugin test .
python3 scripts/check-adrs.py
```

Decisions are recorded as ADRs in [`docs/adr/`](docs/adr/README.md), including behaviour that looks
like a bug but is intentional.

The tests stand in for the engine — the working directory, the file system, git, and the Bash tool's
results — so they run without a repository or a network. The engine writes the API's type
declarations into `.claude-plugin/types/` when it loads the plugin (or run `/plugin-types`), and
`tsconfig.json` points an editor at them.

## Limits of outputs

- It records from the moment it loads; earlier work in the session is not in it.
- A shell command's edits are seen through the engine's diff, or, when there is none, through git
  around the command — so outside a repo they are only seen when the engine reports them.
- A command is filed under the directory its `cd`s and `git -C` lead to; a `cd` into a shell
  variable is not followed.
- The record lasts for the session, across reloads, and is not kept after it.
