# Architecture Decision Records

This directory records the decisions behind session-monitor — what was decided, why, the
alternatives rejected, and the consequences, **including behaviour that looks like a bug but is
intentional**.

ADRs exist so reviewers and contributors (human or agent) don't re-litigate or "fix" a deliberate
decision. If a review flags behaviour that an ADR marks as intentional, link the ADR instead of
changing the code — or, if the decision should genuinely change, supersede or amend the ADR.

Each ADR names the part it concerns in its title or context: **outputs**, **state**, **notes**,
**analysis**, or the plugin as a whole.

## When to write one

Write an ADR for a decision that is non-obvious, affects more than one part of
the system, or produces behaviour a future reviewer would reasonably question.
Routine, self-evident choices don't need one.

## Format

Lightweight [MADR](https://adr.github.io/madr/)-style. Copy `template.md`, number
it sequentially (`NNNN-kebab-title.md`), and fill in the sections. Keep it short:
context, the decision, consequences, alternatives. Status is one of `proposed` /
`accepted` / `accepted, amended by NNNN` / `superseded by NNNN`.

One decision per ADR. If a part of it could change on its own, make that part its
own ADR: a later change then replaces a whole ADR, which is a single Status line
to follow, instead of a section a reader has to be pointed to.

## Reading one

The Status line is the authority, not the text below it. Before acting on an
ADR — as a reviewer, a contributor or an agent — check its Status, and follow
every `amended by` and `superseded by` to the ADR that replaced it. An amended
ADR also marks the replaced section itself, so a reader who arrives at that
section directly still sees it.

## Changing a decision

Accepted ADRs are not rewritten. Editing one for clarity or typos is fine; the
test is whether a reader following the old text would now do something
different — if so, it is a new ADR, in one of two forms:

- **Supersede** — the new decision replaces the whole of an old one. The new ADR
  declares `- Supersedes: NNNN`; the old one's Status becomes
  `superseded by <new>`.
- **Amend** — the new decision replaces part of an old one, which otherwise
  stands. The new ADR declares `- Amends: NNNN, § "<section>"` (one line per
  amended ADR); the old one's Status becomes `accepted, amended by <new>`, and
  the replaced section opens with one line, leaving its text as it was:

  ```markdown
  > **Amended by [ADR NNNN](NNNN-title.md):** what changed, in one sentence.
  ```

Both halves of a link, and the index row below, land in the same commit.
`scripts/check-adrs.py` checks they agree; run it before committing:

```bash
python3 scripts/check-adrs.py
```

### Doing it

The order matters, and two steps are easy to miss:

1. **Pick the next free number** — against `main`, and against any open PR's files if there are
   any: a number held by an unmerged PR is taken.
2. Write the new ADR, with **one `- Amends:` line per amended section**.
3. Flip the old ADR's Status to `accepted, amended by NNNN`.
4. Insert the `> **Amended by …**` marker at the top of each amended section, **leaving
   that section's text as it was** — a reader arriving mid-document has to see it too.
5. Add the new index row **in numeric order**, and **update the old ADR's index row
   status** — the index mirrors the Status line, so both rows change.
6. Run `python3 scripts/check-adrs.py` until it reports consistent.

**Re-check the number before you commit, not just when you write the file.** A number picked
correctly goes stale while the file sits uncommitted.

## Index

The Status column mirrors each ADR's Status line.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-a-mod-not-a-status-line-or-a-skill.md) | The session's outputs are recorded by a mod, not a status line or a skill | accepted |
| [0002](0002-outputs-are-grouped-by-directory.md) | Outputs are grouped by directory, and what was used is kept with what was produced | accepted |
| [0003](0003-line-counts-come-from-the-sessions-own-edits.md) | Line counts come from the session's own edits | accepted |
| [0004](0004-command-text-backs-up-the-engines-reports.md) | Command text and git back up the engine's git and GitHub reports | accepted |
| [0005](0005-a-commands-directory-is-read-from-its-cd-chain.md) | A command's directory is read from its cd chain, heredoc bodies excluded | accepted |
| [0006](0006-branch-switches-are-not-edits.md) | Branch switches are not edits | accepted |
| [0007](0007-deleted-branches-are-followed.md) | Deleted branches are followed, locally and on the remote | accepted |
| [0008](0008-collapsed-by-default-outputs-first.md) | The Outputs tab is collapsed by default, with outputs first | accepted |
| [0009](0009-recording-never-affects-the-tool-call.md) | Recording never affects the tool call | accepted |
| [0010](0010-one-plugin-with-parts-in-its-own-repository.md) | One plugin with parts, in its own repository | accepted, amended by 0012 |
| [0011](0011-installed-through-claude-code-plugin-dirs.md) | The plugin is installed through CLAUDE_CODE_PLUGIN_DIRS | accepted |
| [0012](0012-one-pane-with-a-tab-per-part.md) | One pane with a tab per part | accepted, amended by 0014 |
| [0013](0013-blocked-calls-are-shown-first-in-red.md) | Blocked calls are shown first, in red | accepted, amended by 0015 |
| [0014](0014-outputs-has-no-command-reset-is-a-button.md) | Outputs has no command of its own; Reset is a button | accepted |
| [0015](0015-blocked-folds-like-every-section.md) | Blocked folds like every other section | accepted |

## Why it works this way

Researched when these rules were set:

- Accepted ADRs are immutable and a changed decision gets a new one:
  [Nygard](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions),
  [Fowler](https://www.martinfowler.com/bliki/ArchitectureDecisionRecord.html),
  [AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html).
  The "would a reader now act differently" test for editing in place follows
  [GOV.UK's GDS Way](https://gds-way.digital.cabinet-office.gov.uk/standards/architecture-decisions.html).
- "Amends" for a partial change comes from
  [adr-tools](https://github.com/npryce/adr-tools/blob/master/src/adr-new), whose
  link types include `Amends` / `Amended by`. No tool we found enforces links at
  section level, hence the section pointer and our own check.
- For agent readers, the sources we found converge on a status stated up front
  rather than inferred from prose, links in both directions, and an index that
  says what is current
  ([example](https://dev.to/naman_here/adrs-for-ai-coding-agents-how-to-make-every-agent-read-architecture-decisions-3he4)).
  This part is recent practitioner opinion, not an established standard.
- Considered and left out at this size: an archive directory for superseded
  ADRs (breaks links; the Status line does the job), a generated index, and a
  separate current-state architecture document (duplicates `CLAUDE.md` and drifts).
