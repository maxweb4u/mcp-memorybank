# Capturing to `_inbox` at the end of a session

`capture-to-inbox.sh` is a Stop hook: once work has actually happened, it asks the agent to write
down, into the bank's quarantine, whatever is worth remembering. The agent does that through
`bank_create` with `inbox: true`; nothing reaches a canonical layer without your decision.

## When it stays quiet

The hook does nothing unless all four conditions hold:

| Condition | Why |
|---|---|
| `stop_hook_active` is not `true` | recursion guard: a second pass must not block the stop again |
| the project has a `memory_bank/` | otherwise there is nowhere to write |
| the working tree is dirty | an "asked and left" session produces nothing durable |
| the tree has moved since the last ask, and the cooldown has passed | otherwise it would ask on every turn |

## Why not simply once per session

Because `Stop` fires at the end of every turn, and a one-shot marker therefore lands on the *first*
one — which is orientation, not decision. Measured in a real session: the hook fired four minutes in,
the agent correctly had nothing durable to record, and the nine architecture decisions taken an hour
later were never asked about. A guard against nagging had turned into a guarantee of asking at the
least informed moment available.

So the marker — `$TMPDIR/memorybank-capture-<session_id>` — holds the time of the last ask and a
fingerprint of the working tree, and the hook asks again when the tree has moved on and
`MEMORYBANK_CAPTURE_COOLDOWN_MIN` (default 30) minutes have passed. Typically once or twice in an
afternoon, on turns where something was actually produced.

The fingerprint hashes the contents of the dirty files, not just their paths: an untracked file reads
as `?? path` no matter how many times it is rewritten, and rewriting the same handful of files is
precisely what a working session does.

## What it returns, and why two shapes

```json
{ "decision": "block", "reason": "…", "continue": true, "instruction": "…" }
```

`decision: "block"` with a `reason` is the pair that actually reaches the agent. The documentation
describes `continue: true` with an `instruction` instead, and that was tried first — over three
firings in one working session the client accepted it (`exit 0`, `hook_success`, no stderr) and
injected nothing: it recorded `content: ""` and the turn simply ended. Read literally, `continue:
true` tells the client that stopping is fine, which is the opposite of the intent.

Both shapes are emitted, so a client that reads either behaves the same. Blocking is safe here only
because of the `stop_hook_active` guard at the top of the script: without it a hook that prevents the
stop would be invoked again by its own continuation.

The lesson is worth keeping: a hook can return exit 0 and be logged as a success while doing exactly
nothing. Only the transcript shows whether anything arrived.

## Reminding you the queue has grown

Capture is worth nothing if nobody empties the quarantine, and a folder inside the bank is easy not
to look at. So the same hook, in the same message, says how many notes are waiting once the queue
crosses a threshold:

| Variable | Default | Fires when |
|---|---|---|
| `MEMORYBANK_INBOX_LIMIT` | 8 | that many notes are waiting |
| `MEMORYBANK_INBOX_STALE_DAYS` | 14 | any one note has waited longer |

`README.md` in `_inbox/` is not counted. The reminder is a sentence to the user and nothing more —
the hook never asks the agent to review or promote, because emptying the quarantine is a decision
and decisions are yours.

It rides on the capture message, so it inherits the same four conditions: a clean working tree stays
silent, and so does a session that has already been asked. A queue can therefore sit unmentioned
while you are not working in the project — which is the point, not a gap.

## Installation

In a project that has a bank, `<project>/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/memorybank/hooks/capture-to-inbox.sh"
          }
        ]
      }
    ]
  }
}
```

The inner `hooks` array is not decoration: an entry written flat, as
`"Stop": [{ "type": "command", ... }]`, does not register and reports no error. `Stop` takes no
matcher, so the wrapping object carries nothing but that array.

Requires `jq` and `git`. To confirm the hook is registered, run `/hooks` in an interactive session
of that project.

## Working through the quarantine

The hook only fills `_inbox/`. Emptying it is a separate step, and you are in the loop:

```bash
node dist/cli.js --root <bank> --list-inbox
node dist/cli.js --root <bank> --promote _inbox/note.md --to engineering/thing.md --derived ../dna/principles.md --dry-run
```

In a session there is the `memorybank://inbox` resource and the `review-inbox` prompt, which walks
what has piled up and offers one of three outcomes per note: promote it, fold it into an existing
owner by hand, or throw it away as transient. Folding in is preferred: a new document is justified
only when no one covers the fact.

## Why not `type: "prompt"`

A prompt hook is a model call on every stop in every session of the project. Deciding "was there
work here" is cheaper from the state of the working tree, and the judgement "is there a durable fact
here" is made by the main agent anyway, once it receives the `stopReason`.
