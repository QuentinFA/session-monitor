# session-monitor

A Claude Code plugin of function hooks: one module, `hooks/register.tsx`, composing one part per
file under `src/`. Every part draws in one pane, on its own tab: `hooks/register.tsx` draws the tab
row, and each part's render hook answers on its tab and passes on the others.

- **Before changing a part, read `DECISIONS.md`.** If the issue you are about to act on is already
  there, follow the recorded decision rather than deciding it again. Reopen an entry only with
  evidence it didn't have, and say what that evidence is.
- **Once an issue is settled, add an entry** — Issue, Decision, Rejected, Consequences — naming the
  part it concerns, including when the answer is "leave it as is". Supersede, don't delete.
- **Run `claude plugin validate .` and `claude plugin test .` before committing.** A behaviour
  fixed or added gets a test; the tests stand in for the engine, so they need no repository.
- What the validator refuses, and how to stay inside it:
  - A helper that takes `$` is declared at the top level of the file that calls it — never inside
    `register`, never imported: `$` is followed only into functions of the same file. A part
    registers its own hooks in its own file instead (passing `on` across files is fine).
  - A state reference (`atom(...)`) is declared in each file that reads or writes it, with literal
    `plugin` and `key`.
  - The plugin has one unmatched `session.start`, in `hooks/register.tsx`.
- A hook that observes a tool call records after `next(e)`, catches its own failure, and is
  registered with `.catch(($, e, next) => next(e))`: recording must never fail the call.

Commits and PR titles follow `docs/commit-conventions.md`: `<scope> (<type>): <description>`,
where the scope is a part or `repo`.

The repo is public. Nothing committed here should identify a local setup or another project: no
user- or machine-specific paths, no project names, no examples lifted from other codebases.
