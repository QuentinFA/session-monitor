#!/usr/bin/env bash
# Add this clone to env.CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json, where Claude Code loads
# and watches it, so edits here are live in every new session.
# Idempotent. Never drops another plugin dir; replaces another clone of this plugin only with --force.
#
#   ./install.sh            install
#   ./install.sh --dry-run  show what would change
#   ./install.sh --force    replace this plugin listed from another clone

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"
NAME="$(basename "$REPO")"

DRY_RUN=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force)   FORCE=true ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null || { echo "jq is needed to edit $SETTINGS" >&2; exit 1; }

current=""
[ -f "$SETTINGS" ] && current="$(jq -r '.env.CLAUDE_CODE_PLUGIN_DIRS // ""' "$SETTINGS")"

case ":$current:" in
  *":$REPO:"*) echo "already installed: $REPO"; exit 0 ;;
esac

updated="$current"
# Another clone of this plugin would load it twice.
other="$(printf '%s' "$current" | tr ':' '\n' | grep -E "/$NAME/?\$" || true)"
if [ -n "$other" ]; then
  if [ "$FORCE" = false ]; then
    echo "already listed from $other; use --force to replace it" >&2
    exit 1
  fi
  updated="$(printf '%s' "$current" | tr ':' '\n' | grep -vxF "$other" | paste -sd: -)"
fi
updated="${updated:+$updated:}$REPO"

echo "add $REPO to env.CLAUDE_CODE_PLUGIN_DIRS in $SETTINGS"
if $DRY_RUN; then echo "(dry run — nothing written)"; exit 0; fi
mkdir -p "$CLAUDE_DIR"
[ -s "$SETTINGS" ] || echo '{}' > "$SETTINGS"
next="$(jq --arg dirs "$updated" '.env.CLAUDE_CODE_PLUGIN_DIRS = $dirs' "$SETTINGS")"
printf '%s\n' "$next" > "$SETTINGS" # in place: a symlinked settings.json stays one
echo "installed; new sessions load it"
