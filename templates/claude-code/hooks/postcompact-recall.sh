#!/bin/bash
# ============================================================
# BODHI post-compaction recall (Claude Code)
# ------------------------------------------------------------
# Partner to precompact-checkpoint.sh. Runs on SessionStart with matcher
# "compact" (Claude Code re-runs SessionStart after a compaction) and:
#   1. re-injects this session's working-state note, only when the note's
#      recorded session_id and cwd match the hook input exactly, and
#   2. re-fires semantic recall: a narrow BODHI memory search built from the
#      branch name and the changed-file names, injecting the top hits.
# Output is hookSpecificOutput.additionalContext. Any mismatch stays silent.
#
# BODHI root: $BODHI_ROOT, otherwise the checkout that contains this script.
# The bearer (if any) is read from that checkout's private .env and passed to
# curl as a quoted header in a configuration read from stdin, so it never
# appears in argv, a child environment, or the hook output.
# Optional: BODHI_RECALL_TAG limits recall to one project tag.
#
# Disable: remove the SessionStart "compact" entry from ~/.claude/settings.json.
# ============================================================

set +e

INPUT=$(cat 2>/dev/null)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[[ "$SID" =~ ^[A-Za-z0-9._-]{1,128}$ && "$SID" != .* ]] || exit 0
[ -n "$CWD" ] || exit 0

DIR="${BODHI_CHECKPOINT_DIR:-$HOME/.bodhi/compaction}"
CHECKPOINT="$DIR/$SID.md"
META="$DIR/$SID.json"
[[ -f "$CHECKPOINT" && ! -L "$CHECKPOINT" && -f "$META" && ! -L "$META" ]] || exit 0

# Only this session's note, captured in this working directory.
NOTE_SID=$(jq -r '.session_id // empty' "$META" 2>/dev/null)
NOTE_CWD=$(jq -r '.cwd // empty' "$META" 2>/dev/null)
[[ "$NOTE_SID" == "$SID" && "$NOTE_CWD" == "$CWD" ]] || exit 0

CTX=$(cat "$CHECKPOINT" 2>/dev/null)
[ -n "$CTX" ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
BODHI_ROOT="${BODHI_ROOT:-$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd)}"
ENV_FILE="${BODHI_ENV_FILE:-$BODHI_ROOT/.env}"

# Read one fixed key from the owner's private .env without echoing it.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -1 | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'
}

PORT_VALUE="${BODHI_PORT:-$(env_value BODHI_PORT)}"
PORT_VALUE="${PORT_VALUE:-$(env_value PORT)}"
[[ "$PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ ]] || PORT_VALUE=4000

# Build the recall query from deterministic signal: the de-slugged branch name
# plus the basenames of the files that were mid-edit.
BRANCH_Q=$(grep '^- branch:' "$CHECKPOINT" 2>/dev/null | sed -E 's/.*`([^`]*)`.*/\1/; s#.*/##; s/[-_]/ /g')
FILES_Q=$(awk '/Files mid-edit/{f=1;next} /^```/{if(f){c++}; if(c==2)f=0; next} f{print}' "$CHECKPOINT" 2>/dev/null \
  | awk '{print $NF}' | sed 's#.*/##' | head -4 | tr '\n' ' ')
QUERY=$(printf '%s %s' "$BRANCH_Q" "$FILES_Q" | tr -s ' ' | cut -c1-120 | sed 's/^ *//; s/ *$//')

RECALL=""
if [ -n "$QUERY" ]; then
  ENC=$(jq -rn --arg q "$QUERY" '$q|@uri' 2>/dev/null)
  URL="http://127.0.0.1:${PORT_VALUE}/api/memories/search?q=${ENC}&limit=5"
  if [ -n "${BODHI_RECALL_TAG:-}" ]; then
    URL="${URL}&tag=$(jq -rn --arg t "$BODHI_RECALL_TAG" '$t|@uri' 2>/dev/null)"
  fi
  CURL_CONFIG=$(printf 'url = "%s"\nmax-time = 5\nsilent\n' "$URL")
  TOKEN="${BODHI_API_TOKEN:-$(env_value BODHI_API_TOKEN)}"
  # A header value cannot carry a line break. Otherwise escape it for a quoted
  # curl configuration string: backslash first, then double quote.
  if [[ -n "$TOKEN" && "$TOKEN" != *$'\n'* && "$TOKEN" != *$'\r'* ]]; then
    ESCAPED=${TOKEN//\\/\\\\}
    ESCAPED=${ESCAPED//\"/\\\"}
    CURL_CONFIG=$(printf '%s\nheader = "Authorization: Bearer %s"\n' "$CURL_CONFIG" "$ESCAPED")
    unset ESCAPED
  fi
  unset TOKEN
  HITS=$(printf '%s\n' "$CURL_CONFIG" | curl --config - 2>/dev/null)
  unset CURL_CONFIG
  RECALL=$(printf '%s' "$HITS" | jq -r '
    (.memories // .results // .)
    | if type=="array" then .[] else empty end
    | "- " + ((.content // .summary // .title // "")|tostring|.[0:200])
  ' 2>/dev/null | grep -v '^- $' | head -5)
fi

if [ -n "$RECALL" ]; then
  CTX="${CTX}

## Recall re-primed after compaction (BODHI memory search on the current task)

${RECALL}"
fi

jq -n --arg ctx "$CTX" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}' 2>/dev/null

exit 0
