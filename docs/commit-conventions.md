# Commit conventions

Commits and pull request titles share one format. PRs are squash-merged, so a PR's title becomes
the commit subject and its body the commit body: write both to this standard.

## Format

```
<scope> (<type>): <description>

<body: why the change was made>

Co-Authored-By: <name> <email>
```

## Scopes

One scope per commit: the unit the change is about.

| Scope | Covers |
| --- | --- |
| `<part>` | one part: `src/<part>.tsx`, its tests and its state — `outputs`, `state`, `notes`, `analysis` |
| `lib` | code the parts share, under `src/lib/` |
| `repo` | what no part owns: `hooks/register.tsx`, `README.md`, `CLAUDE.md`, `install.sh`, `.claude-plugin/`, `docs/` |

A change that spans several parts is usually several commits. When it is one change, use `repo` and
name the parts in the body.

## Types

| Type | Use for |
| --- | --- |
| `feat` | a new part, or new behaviour in one |
| `fix` | behaviour that was wrong: something misrecorded, misfiled or misdrawn |
| `refactor` | restructuring with no change in behaviour |
| `docs` | README or `DECISIONS.md` only |
| `test` | tests only |
| `build` | `install.sh`, the manifest, `tsconfig.json` |

A fix or feature carries its test and its `DECISIONS.md` entry in the same commit.

## Description

- Imperative mood: "add", "fix", "route", not "added" or "adds"
- Lowercase, no trailing period
- Under 72 characters, scope and type included

## Body

Explain **why**: the problem, what made it visible, and why this fix over the alternatives. The diff
already shows what changed. Wrap at about 72 characters. Prose paragraphs; bullets when the change
is a list of parallel parts.

End with the `Co-Authored-By` trailer when an agent wrote the change, and `Closes #N` / `Refs #N`
when an issue applies. No "Generated with" line: the trailer is the whole attribution.

## Examples

```
outputs (fix): record every commit a command makes
outputs (feat): follow deleted branches, locally and on the remote
outputs (fix): skip heredoc bodies when reading a command's directory
notes (feat): add notes the model writes on request
lib (refactor): share path resolution between parts
repo (build): add install.sh for CLAUDE_CODE_PLUGIN_DIRS
```

With a body:

```
outputs (fix): record every commit a command makes

The engine's gitOperation reports one commit per Bash command, the
last, so a command that committed twice lost its first commit. When a
`git commit` command moves HEAD, every commit between the HEAD before
and after it is now recorded, the engine's report labelling the one it
names.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
