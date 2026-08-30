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
# When the quarantine has grown past MEMORYBANK_INBOX_LIMIT notes, or the oldest has been waiting
# more than MEMORYBANK_INBOX_STALE_DAYS, it also asks the agent to say so out loud. A queue nobody
# is told about is a queue nobody empties.
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

inbox="$cwd/memory_bank/_inbox"
limit="${MEMORYBANK_INBOX_LIMIT:-8}"
stale_days="${MEMORYBANK_INBOX_STALE_DAYS:-14}"
waiting=0
stale=0
if [ -d "$inbox" ]; then
  waiting=$(find "$inbox" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')
  stale=$(find "$inbox" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' -mtime +"$stale_days" 2>/dev/null | wc -l | tr -d ' ')
fi

remind=""
if [ "$waiting" -ge "$limit" ] || [ "$stale" -gt 0 ]; then
  remind=$(printf '\n\nSeparately, tell the user plainly: %s notes are waiting in _inbox/' "$waiting")
  [ "$stale" -gt 0 ] && remind="${remind}$(printf ', %s of them older than %s days' "$stale" "$stale_days")"
  remind="${remind}$(printf '. Suggest the review-inbox prompt. Do not review or promote anything now unless asked.')"
fi

reason=$(cat <<'TEXT'
Before finishing: did this session produce a durable fact — an accepted decision, a constraint you
discovered, a gotcha that cost time, or a contract that changed? If yes, call bank_create with
inbox: true, a one-line purpose saying when someone should read it, and derived_from pointing at the
document the fact belongs under. One note per fact; keep it to what a future session could not
re-derive from the code. If nothing durable came up, say nothing about this and finish the turn.
Never promote out of _inbox on your own — that is a review step for a human.
TEXT
)

# Stop takes its decision fields at the top level: `continue` keeps the turn alive and `instruction`
# is what the agent is shown. `hookSpecificOutput` is explicitly not read for this event.
jq -n --arg r "${reason}${remind}" '{continue: true, instruction: $r}'
exit 0
