# 0011. The plugin is installed through CLAUDE_CODE_PLUGIN_DIRS

- Status: accepted
- Date: 2026-10-09

## Context

A plugin of function hooks loads from a folder. This one is developed in its own repository, so the
clone itself should be what Claude Code loads — with edits live, as a symlinked skill's are — rather
than a copy that has to be refreshed.

## Decision

`install.sh` adds the clone's folder to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.
Claude Code loads and watches every listed folder. The script keeps every other entry, writes the
file in place so a symlinked `settings.json` stays one, and replaces the plugin listed from another
clone only with `--force`, since both would load.

## Consequences

The script needs `jq`, and a headless `claude -p` also needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Alternatives considered

- A skills folder — a plugin under `.claude/skills/<name>` is described as auto-loaded, but a
  headless test from a project's skills folder did not load it.
- A marketplace entry — not yet tested for a plugin of function hooks, and a plugin install copies
  the folder, so edits would not be live.
