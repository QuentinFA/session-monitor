# session-monitor

A Claude Code plugin of function hooks: one module, `hooks/register.tsx`, composing one part per
file under `src/`. Each part draws its own pane.

- **Before changing a part, read `DECISIONS.md`.** If the issue you are about to act on is already
  there, follow the recorded decision rather than deciding it again. Reopen an entry only with
  evidence it didn't have, and say what that evidence is.
- **Once an issue is settled, add an entry** — Issue, Decision, Rejected, Consequences — naming the
  part it concerns, including when the answer is "leave it as is". Supersede, don't delete.
- **Run `claude plugin validate .` and `claude plugin test .` before committing.** A behaviour
  fixed or added gets a test; the tests stand in for the engine, so they need no repository.
- A helper that takes `$` must be declared at the top level of its file, not inside `register`:
  the validator traces `$` through calls and refuses what it cannot follow.
- A hook that observes a tool call records after `next(e)`, catches its own failure, and is
  registered with `.catch(($, e, next) => next(e))`: recording must never fail the call.

Commits and PR titles follow `docs/commit-conventions.md`: `<scope> (<type>): <description>`,
where the scope is a part or `repo`.

The repo is public. Nothing committed here should identify a local setup or another project: no
user- or machine-specific paths, no project names, no examples lifted from other codebases.
