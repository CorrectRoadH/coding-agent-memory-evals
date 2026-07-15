#!/usr/bin/env bash
set -uo pipefail

input=$(cat)
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cat <<'JSON'
{"decision":"block","reason":"Before stopping, save durable engineering decisions or reusable debugging lessons to mempal, following the mempal-memory skill. Never store benchmark answers, accepted proposal numbers, hidden-test guesses, raw transcripts, or task-specific output that would reveal an answer on rerun. If nothing reusable was decided, just stop."}
JSON
