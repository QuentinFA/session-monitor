# 0022. Git history is drawn in straight lanes, and only viewed

- Status: accepted
- Date: 2026-10-15

## Context

The Git tab is meant to give, inside Claude Code, the picture a desktop git client gives — a commit
graph with branches, tags and the checked-out commit — without leaving the session, and without
becoming a client: nothing in it acts on a repository.

Desktop clients split on how lanes are laid out. `git log --graph` and the clients built like it
shift lanes sideways as branches start and end, so a branch wanders across columns; the clients
known for readable graphs keep a branch in one column from its tip to where it forked (Vigier,
*Commit Graph Drawing Algorithms*, 2019).

## Decision

- The tab lays the graph out itself, in **straight lanes**: a lane keeps its column until it ends,
  and a freed column goes to the next lane that starts. A commit sits in the lane heading to it, the
  leftmost when several are; that lane runs on to its first parent, and each other parent of a merge
  opens a lane or joins the one already heading there. Each lane has a color of its own, from a
  rotating palette. The layout is `src/lib/graph.ts`, pure, and tested apart from the pane.
- One row a commit: graph, short hash, refs, subject, author and age. The checked-out commit is `◉`;
  the branch checked out is bold green, other branches green, remote branches dim, tags yellow `◆`.
  A commit this session made — one Outputs recorded — is marked `✦`.
- **All branches** by default — local, remote and tags — and **Current branch** for HEAD's history
  alone. A line above the graph gives the branch, its upstream, ahead/behind and uncommitted files.
- The hash is the control: pressing it opens the commit under its row — author, date, the whole
  message, and its files with `+/−` lines (a merge's against its first parent), new, deleted and
  renamed ones marked. No diff content.
- The first 50 commits are read; **Show 50 more** reads further.
- Nothing in the tab writes to a repository.

## Consequences

- When two lanes wait for the same commit, the commit takes the leftmost and the others join it on
  its row, so a branch's tip can sit right of its base: intentional, it keeps the columns straight.
- Many branches open many lanes; nothing caps the graph's width yet, and a wide graph leaves less
  room for the subject, which is cut.
- A row is not pressable as a whole: the pane's elements give `Button`s a single-styled label, so the
  hash is the button and the rest of the row stays colored text.

## Alternatives considered

- Parsing `git log --graph`'s output — free, but its lanes shift sideways, and it is drawn for
  ASCII, one character per lane, with extra rows for connectors.
- A diff per file inside an opened commit — closer to a full client, much heavier to draw; files with
  their line counts were judged enough to see what a commit did.
- Buttons that check out, fetch or reset — the tab is for viewing; acting stays with the session.
