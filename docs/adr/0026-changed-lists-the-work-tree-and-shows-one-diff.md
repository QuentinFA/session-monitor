# 0026. Changed lists what is not committed, and shows one file's diff at a time

- Status: accepted
- Date: 2026-10-15

## Context

The Git tab shows what was committed; what the session changed and has not committed yet is the
other half, and the one a person reviews before a commit. A desktop client shows it as a list of
files above the selected file's diff. The pane's `Code` element draws unified-diff hunks itself —
gutters, markers, colors, syntax — and its `Link` is a terminal hyperlink, opened with a
modifier-click.

## Decision

- The tab lists the files of the shared repository (the Git tab's choice, ADR 0023) in git's three
  sections — **Staged**, **Unstaged**, **Untracked** — with `+/−` lines; a file staged then edited
  again is in both, each with its own diff. Untracked files are counted against nothing, the first 30.
- One file's diff is drawn below the list, through `Code` in diff format: the first file's until
  another is chosen. Its status letter selects a file; **p** and **n** step to the previous and next,
  around the ends.
- A file's path is a link to `file://<path>`: Ctrl/Cmd-click opens it with what the terminal opens
  it with. A deleted file is struck through, without a link.
- The Git tab's "N uncommitted" opens this tab.
- Git is read again after a Bash, Edit, Write or NotebookEdit call, on ↻, and when what is shown is
  more than 30 seconds old (as ADR 0024, edits added: they are what this tab shows). Git runs with
  colors off, whatever the config says: a drawing holding an escape sequence is refused whole.
- Nothing in the tab stages, discards or commits.

## Consequences

- Renames are shown as a deletion and an addition (`--no-renames`), so the two halves keep their
  own lines and diffs.
- A diff is cut at a hunk past about 90,000 characters, the most a `Code` draws, and says how many
  hunks it left out.
- What a click on a link opens is the terminal's: some open the file in an editor, some in the
  system's default application, and a terminal without hyperlinks draws the path with the URL after.

## Alternatives considered

- Every file as a fold opening to its diff, as Outputs folds — no stepping from file to file, and
  many open diffs bury the list.
- One list, each file's diff against HEAD — simpler, but hides what is staged.
- A row pressed as a whole to select it — a `Button`'s label is one style, and the path is the link.
