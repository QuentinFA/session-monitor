# Decisions — session-monitor

Small ADRs: one per issue raised against the plugin and settled. Before acting on an issue with it,
check here — if it has come up before, the answer and its reasoning are below. Add an entry whenever
an issue is settled, including when the answer is "leave it as is". Supersede rather than delete.

Entries name the part they concern — **outputs**, and later **state**, **notes**, **analysis** —
or none when they concern the whole plugin.

## Its own repository, one plugin with parts

*2026-10-09 · accepted; "each part with its own pane" superseded by "One pane with a tab per part"*

**Issue:** it began as one mod, `session-outputs`, inside a repository of skills. Three more were
planned beside it — the session's state, notes for later, and an analysis of what went wrong — all
watching the same session, sharing path and git handling, and feeding the `reflect` skill.

**Decision:** one plugin, `session-monitor`, in its own repository. Each part is a module under
`src/` that `hooks/register.tsx` composes, with its own pane, so the panes show as tabs. Shared code
goes in `src/lib/` as it appears.

**Rejected:** a mod per part in the skills repository — four plugins to install, version and load,
duplicating the shared code, in a repository whose subject is skills. One module for everything —
the parts are independent enough to test, and to break, separately.

**Consequences:** the link to `reflect` becomes a contract across repositories: this plugin writes
what `reflect` should read to a known file, and the skill reads it when present.

## One pane with a tab per part

*2026-10-09 · accepted; "`/outputs` stays" superseded by "outputs: no command of its own; Reset is a button"*

**Issue:** with a pane per part, the parts show as the engine's own tabs: mixed with other plugins'
panes, drawn only while more than one pane is open, and reached through a command per part.

**Decision:** one pane, opened by `/session-monitor [tab]`, with its own tab row — a button per
part, its digit as hotkey — and the tab on show kept in state. The monitor's render hook draws the
row and asks the chain for the body; each part's render hook answers on its own tab and passes on
the others. `/outputs` stays, as a shortcut to its tab. A tab appears once its part exists.

**Rejected:** a pane per part — the layout above, which the plugin does not control. Each part
exporting a draw function for the monitor to call — the validator follows `$` only into functions
of the same file, never across an import.

**Consequences:** the plugin's one unmatched `session.start` is in `hooks/register.tsx`, which
declares every part's commands; a part does its own start-up lazily, on first use.

## outputs: a mod, not a status line or a skill

*2026-10-08 · accepted*

**Issue:** seeing what a session produced — branches, line counts, issues and PRs opened — across
work that spans several repositories.

**Decision:** a mod that records from tool calls as they happen and draws a pane, with a one-line
status entry beside it.

**Rejected:** a status-line script — its input describes the current directory's repo only, so
multi-repo work is invisible. A skill — it would have to reconstruct the session after the fact
from the transcript, spending model turns on what event hooks see for free.

## outputs: group by directory, and record what was used as well as produced

*2026-10-08 · accepted*

**Issue:** a list of edits alone does not say what a session *did*: the commands it ran and the
files it read are half the picture, and they mean little without where they happened.

**Decision:** one group per git root, or per directory outside any repo, holding its commands,
reads, edits, branches, commits and pushes. Paths are resolved through symbolic links before
grouping, since git reports roots that way (`/tmp` is `/private/tmp` on macOS).

**Rejected:** one flat timeline — it buries the per-repo answer the pane exists for.

## outputs: line counts come from the session's own edits

*2026-10-08 · accepted*

**Issue:** counting lines changed when other sessions may be working in the same worktree.

**Decision:** count from what each tool call reports: Edit and Write patches, the engine's per-file
diff on Bash results, and each commit's own `numstat`. When a Bash command carries no diff — the
engine does not always attach one — compare the repo's `git diff --numstat HEAD` and untracked
files before and after the command.

**Rejected:** diffing each repo against the HEAD it had when the session first touched it — it
catches everything, but counts another session's work in a shared worktree as this one's.

**Consequences:** the before/after comparison costs three git calls before each Bash command,
capped at two seconds. A file already changed in the session gets approximate counts, a change
another session makes *during* the command is counted, and a command that edits and commits at
once has its commit recorded but not its edits. Outside a repo, only the engine's diff is seen.

## outputs: command text backs up the engine's git and GitHub reports

*2026-10-08 · accepted*

**Issue:** a hook that rewrites command output (to save tokens, say) changed `git commit`'s output
to a one-line summary. The engine's structured report of the commit went missing, and with it the
commit; `gh` output lost its URLs the same way.

**Decision:** the engine's `gitOperation` stays the first source. Behind it: a `git commit` command
that moved HEAD records the new HEAD; branches, deletions and worktrees are read from the command
text; and a PR or issue URL missing from the output is rebuilt from the repo's GitHub remote and the
number. A `gh` write whose command exited with an error is still recorded, marked as such —
`gh pr close --delete-branch` can close the PR and then fail on the local branch switch.

**Rejected:** parsing command output — it is exactly what the rewriting hook changes.

**Consequences:** the engine reports one commit per command — the last. A command that commits
more than once had its earlier commits dropped, so when a `git commit` command moved HEAD, every
commit between the HEAD before and after it is recorded, the engine's report labelling the one it
names.

## outputs: how a command's directory is read

*2026-10-08 · accepted*

**Issue:** commands were filed under the wrong directory: `cd /a && git -C b …` went to the session's
directory instead of `/a/b`, a trailing `cd ..` was resolved against the session's directory, and a
heredoc's body was parsed as if its `cd`, `git` and `gh` lines ran.

**Decision:** heredoc bodies are removed before any parsing; `cd`s are followed in order, each from
the last; a `git -C` is resolved from the `cd`s before it; `~` expands to the home directory.

**Rejected:** asking the shell — the mod sees the command before and after it runs, not the shell's
state, and running it again is not an option.

## outputs: branch switches are not edits

*2026-10-08 · accepted*

**Issue:** `checkout`, `switch`, `pull`, `merge`, `rebase`, `stash` and `worktree` rewrite the working
tree without the session writing anything.

**Decision:** their working-tree changes are not counted as edits.

**Rejected:** counting them — a branch switch would show as hundreds of lines the session never
wrote.

## outputs: deleted branches are followed

*2026-10-08 · accepted*

**Issue:** a branch created and then deleted still read as created, and deleting a branch the
session did not create left no trace — though a deletion is as much an output as a creation.

**Decision:** `git branch -d/-D/--delete` and `git push --delete` / `push <remote> :name` are
recorded. A deleted branch the session created is struck through in place; others are listed under
*deleted* and *deleted on remote*.

## outputs: collapsed by default, outputs first

*2026-10-08 · accepted*

**Issue:** fully expanded, the pane overflowed its height and pushed the GitHub section — the outputs
that matter most — out of view.

**Decision:** GitHub, services and scheduled work come first; each directory collapses to one summary
line; directories where only commands ran come last, dimmed. **Expand all / Collapse all** and
**Copy all** sit at the top; the copy is the full record as markdown, with multi-line commands
shortened to their first line.

## outputs: recording never affects the tool call

*2026-10-08 · accepted*

**Issue:** the mod runs git and reads state around every tool call; a failure there must not fail the
call it is observing.

**Decision:** each recorder is caught inside its hook, and each hook is registered with a `.catch`
that replays the call's result. A failed recording loses that entry, never the tool call.

## outputs: blocked calls are shown first, in red

*2026-10-09 · accepted*

**Issue:** a call refused before it ran — by a hook, a permission rule or check, or the person at
the prompt — left no trace: the recorders returned on a refusal, so a blocked `git push --force`
looked like nothing happened.

**Decision:** a refused call is recorded under **Blocked**, at the top of the tab in red, with its
tool, what it would have touched, the reason and its directory; a refused command or read is also
marked red in its directory's list — a refused edit is not, since nothing changed — and the status
line counts them. Three routes report a refusal — a
`deny` result, `classic.PermissionDenied`, and an error result whose text says the person declined
— and the call's id keeps a refusal reported twice once.

**Rejected:** treating every error as blocked — a command that ran and failed is a failure, shown
as one, not a refusal.

**Consequences:** a decline at the prompt is recognised by its wording ("doesn't want to proceed",
"was rejected"), not by a field: if core rewords it, those declines read as ordinary failures until
the pattern follows.

## outputs: no command of its own; Reset is a button

*2026-10-09 · accepted*

**Issue:** `/outputs` opened what `/session-monitor outputs` opens, and its other job, `/outputs
reset`, was out of reach from the pane where the record is read.

**Decision:** `/outputs` is gone, and the summary it printed with it. The Outputs tab's toolbar has
**Reset**, which asks once more — **Confirm reset** or **Cancel** — before clearing the record.

**Rejected:** keeping `/outputs` as an alias — a command per tab is what the single pane replaced.
A one-press Reset — a button with a hotkey sits one stray key from wiping the session's record.

## Installed through `CLAUDE_CODE_PLUGIN_DIRS`

*2026-10-09 · accepted*

**Issue:** how the plugin is installed so that edits in a clone are live while developing it.

**Decision:** `install.sh` adds the clone's folder to `env.CLAUDE_CODE_PLUGIN_DIRS` in
`~/.claude/settings.json`. Claude Code loads and watches every listed folder. The script keeps every
other entry, writes the file in place so a symlinked `settings.json` stays one, and replaces the
plugin listed from another clone only with `--force`, since both would load.

**Rejected:** a skills folder — a plugin under `.claude/skills/<name>` is described as auto-loaded,
but a headless test from a project's skills folder did not load it. A marketplace entry — not yet
tested for a plugin of function hooks, and a plugin install copies the folder, so edits would not be
live.

**Consequences:** the script needs `jq`, and a headless `claude -p` also needs
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
