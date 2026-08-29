#!/usr/bin/env bash
# Stop hook: once per session, after real work, ask the agent to capture what it learned
# into the bank's quarantine (`_inbox/`) through bank_create.
#
# It deliberately stays quiet unless all four are true:
#   1. this is not a re-entry from another Stop hook   (stop_hook_active)
#   2. the project actually has a memory_bank
#   3. the working tree changed, so something happened  (a read-only session captures nothing)
#   4. this session has not been asked already          (one marker per session id)
#
# Install: see hooks/README.md
set -uo pipefail

input=$(cat)
field() { printf '%s' "$input" | jq -r "$1" 2>/dev/null; }

[ "$(field '.stop_hook_active')" = "true" ] && exit 0

cwd=$(field '.cwd')
session=$(field '.session_id')
[ -n "$cwd" ] && [ -d "$cwd/memory_bank" ] || exit 0
git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ -n "$(git -C "$cwd" status --porcelain 2>/dev/null)" ] || exit 0

marker="${TMPDIR:-/tmp}/memorybank-capture-${session:-unknown}"
[ -e "$marker" ] && exit 0
: > "$marker"

reason=$(cat <<'TEXT'
Before finishing: did this session produce a durable fact — an accepted decision, a constraint you
discovered, a gotcha that cost time, or a contract that changed? If yes, call bank_create with
inbox: true, a one-line purpose saying when someone should read it, and derived_from pointing at the
document the fact belongs under. One note per fact; keep it to what a future session could not
re-derive from the code. If nothing durable came up, say nothing about this and finish the turn.
Never promote out of _inbox on your own — that is a review step for a human.
TEXT
)

jq -n --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"Stop",decision:"continue",stopReason:$r}}'
exit 0
