#!/bin/bash
# ============================================================
# BODHI PreCompact checkpoint (Claude Code)
# ------------------------------------------------------------
# When context compacts, the native summary keeps task intent but loses
# working detail: which files were mid-edit, the branch, recent commits.
# This hook runs before compaction and writes a small DETERMINISTIC
# working-state note for THIS session only. Its partner, postcompact-recall.sh,
# re-injects the note on the SessionStart that fires with source "compact",
# and only when the session and working directory match.
#
# It records only Git state and a timestamp. It never copies user messages
# or transcript text: BODHI must not become a second conversation history.
#
# Output: ${BODHI_CHECKPOINT_DIR:-$HOME/.bodhi/compaction}/<session_id>.md
#         plus <session_id>.json (session_id and cwd, used for matching).
# Notes older than 14 days in that directory are removed.
# Disable: remove the PreCompact entry from ~/.claude/settings.json.
# ============================================================

set +e  # never block compaction

INPUT=$(cat 2>/dev/null)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
TRIGGER=$(printf '%s' "$INPUT" | jq -r '.trigger // "unknown"' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# The session id names the file, so accept only a plain token.
[[ "$SID" =~ ^[A-Za-z0-9._-]{1,128}$ && "$SID" != .* ]] || exit 0
[ -n "$CWD" ] || CWD="${CLAUDE_PROJECT_DIR:-$PWD}"

DIR="${BODHI_CHECKPOINT_DIR:-$HOME/.bodhi/compaction}"
umask 077
mkdir -p "$DIR" 2>/dev/null || exit 0
chmod 700 "$DIR" 2>/dev/null
find "$DIR" -maxdepth 1 -type f \( -name '*.md' -o -name '*.json' \) -mtime +14 -delete 2>/dev/null

NOW=$(date '+%Y-%m-%d %H:%M:%S %Z')
BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
# Tracked changes only: the work in progress, not untracked scratch files.
GIT_STATUS=$(git -C "$CWD" status --short -uno 2>/dev/null | head -40)
GIT_LOG=$(git -C "$CWD" log -5 --oneline 2>/dev/null)

{
  echo "# CURRENT TASK — working-state checkpoint"
  echo ""
  echo "> Written by the PreCompact hook just before context compaction"
  echo "> (trigger: ${TRIGGER}). Re-injected after compaction by postcompact-recall.sh."
  echo "> Captured: ${NOW}  ·  cwd: ${CWD}"
  echo ""
  echo "## Git working state"
  echo ""
  echo "- branch: \`${BRANCH:-unknown}\`"
  echo ""
  echo "Files mid-edit (\`git status --short\`):"
  echo '```'
  echo "${GIT_STATUS:-<clean working tree>}"
  echo '```'
  echo ""
  echo "Recent commits:"
  echo '```'
  echo "${GIT_LOG:-<no git log>}"
  echo '```'
  echo ""
  echo "_On resume: re-read the files listed above before continuing; the diff"
  echo "in progress is on disk in the working tree, not in the compacted summary._"
} > "$DIR/$SID.md" 2>/dev/null

jq -n --arg session_id "$SID" --arg cwd "$CWD" --arg captured_at "$NOW" \
  '{session_id: $session_id, cwd: $cwd, captured_at: $captured_at}' > "$DIR/$SID.json" 2>/dev/null

exit 0
