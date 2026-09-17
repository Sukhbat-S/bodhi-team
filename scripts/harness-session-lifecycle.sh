#!/usr/bin/env bash

# Native harness lifecycle adapter — invoked with `codex` (default) or
# `claude-code`. Both Codex and Claude Code SessionStart hooks send the same
# stdin shape (session_id, cwd, hook_event_name) and accept the same
# hookSpecificOutput.additionalContext output.
#
# The active harness owns task lifecycle. This hook therefore performs no HTTP
# writes, keeps no local session mirror, drains no inbox, and never adopts a
# sibling task. SessionStart emits only the native identity needed by the
# $session-start project-identity check to verify project context.
# $session-start owns orchestration and $session-save owns checkpoint
# persistence. Prompt and end events are intentionally no-ops.

PARSED_INPUT=$(jq -er '
  select(type == "object")
  | select(.hook_event_name == "SessionStart"
      or .hook_event_name == "UserPromptSubmit"
      or .hook_event_name == "SessionEnd")
  | select(.session_id | type == "string")
  | select(.session_id | test("^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"))
  | select((.cwd // "") | type == "string")
  | [.hook_event_name, .session_id, (.cwd // "")]
  | @tsv
' 2>/dev/null) || exit 0

[ -n "$PARSED_INPUT" ] || exit 0
IFS=$'\t' read -r HOOK_EVENT NATIVE_TASK_ID HOOK_CWD <<< "$PARSED_INPUT"
[ "$HOOK_EVENT" = "SessionStart" ] || exit 0

PROVIDER=${1:-codex}
# Fail closed with empty stdout, but leave a diagnosable line on stderr.
case "$PROVIDER" in
  codex|claude-code) ;;
  *)
    printf 'harness-session-lifecycle: unknown provider "%s" (expected codex|claude-code)\n' "$PROVIDER" >&2
    exit 0
    ;;
esac

PROJECT_ROOT=""
if [ -n "$HOOK_CWD" ] && [ -d "$HOOK_CWD" ]; then
  COMMON_GIT_DIR=$(git -C "$HOOK_CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || COMMON_GIT_DIR=""
  if [ -n "$COMMON_GIT_DIR" ]; then
    PROJECT_ROOT=$(dirname "$COMMON_GIT_DIR")
  fi
fi

if [ -n "$PROJECT_ROOT" ]; then
  PROJECT=$PROJECT_ROOT
else
  FALLBACK_CWD=${HOOK_CWD:-$PWD}
  PROJECT=$FALLBACK_CWD
fi
[ -n "$PROJECT" ] || exit 0

# This is trusted lifecycle metadata, not retrieved prose. The hook performs no
# routing, checkpoint lookup, or persistence.
CONTEXT=$(printf 'BODHI_PROVIDER=%s\nBODHI_NATIVE_TASK_ID=%s\nBODHI_PROJECT=%s' \
  "$PROVIDER" "$NATIVE_TASK_ID" "$PROJECT")

jq -cn \
  --arg context "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $context}}' \
  2>/dev/null || true

exit 0
