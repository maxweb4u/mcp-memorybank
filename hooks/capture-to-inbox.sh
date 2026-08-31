#!/usr/bin/env bash
# Stop hook: once per session, after real work, ask the agent to capture what it learned
# into the bank's quarantine (`_inbox/`) through bank_create.
#
# It deliberately stays quiet unless all four are true:
#   1. this is not a re-entry from another Stop hook   (stop_hook_active)
#   2. the project actually has a memory_bank
#   3. the working tree changed, so something happened  (a read-only session captures nothing)
#   4. it has not asked recently about this same state  (see below)
#
# On (4): asking once per session sounds right and is not. `Stop` fires at the end of every turn, so
# a one-shot marker lands on the FIRST turn — which is usually reading and orientation, before the
# session has decided anything. Measured in a real session: the hook fired four minutes in, the agent
# correctly had nothing to record, and the nine decisions that followed an hour later were never
# asked about. So the marker holds the working tree's fingerprint and the time of the last ask, and
# the hook asks again once the tree has moved on and a cooldown has passed.
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

# Fingerprint of what is uncommitted right now. The porcelain lines alone are not enough: an
# untracked file reads as `?? path` however many times it is rewritten, and rewriting the same files
# is exactly what a working session does. So the contents of the dirty files are hashed too.
fingerprint=$(
  {
    git -C "$cwd" status --porcelain 2>/dev/null
    git -C "$cwd" status --porcelain 2>/dev/null | awk '{print $NF}' | while read -r f; do
      [ -f "$cwd/$f" ] && shasum "$cwd/$f" 2>/dev/null
    done
  } | shasum | cut -c1-12
)
cooldown_min="${MEMORYBANK_CAPTURE_COOLDOWN_MIN:-30}"
now=$(date +%s)

marker="${TMPDIR:-/tmp}/memorybank-capture-${session:-unknown}"
if [ -e "$marker" ]; then
  read -r last_time last_print < "$marker" 2>/dev/null || { last_time=0; last_print=""; }
  [ "$fingerprint" = "$last_print" ] && exit 0
  [ $(( (now - ${last_time:-0}) / 60 )) -lt "$cooldown_min" ] && exit 0
fi
printf '%s %s\n' "$now" "$fingerprint" > "$marker"

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

# Two shapes, because the documentation and the installed client disagree and the observable one wins.
# `decision: "block"` with a `reason` is what actually reaches the agent: measured over three firings
# in one session, `{continue: true, instruction: ...}` alone was accepted (exit 0, hook_success) and
# injected nothing — the client recorded `content: ""` and the turn ended. `continue: true` reads to
# it as "yes, stopping is fine", which is the opposite of the intent. `instruction` is kept for
# clients that do read it. The recursion guard on `stop_hook_active` at the top is what makes
# blocking safe.
jq -n --arg r "${reason}${remind}" \
  '{decision: "block", reason: $r, continue: true, instruction: $r}'
exit 0
