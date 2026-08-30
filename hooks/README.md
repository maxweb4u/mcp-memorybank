# Capturing to `_inbox` at the end of a session

`capture-to-inbox.sh` is a Stop hook: after a session in which work actually happened, it asks the
agent once to write down, into the bank's quarantine, whatever is worth remembering. The agent does
that through `bank_create` with `inbox: true`; nothing reaches a canonical layer without your
decision.

## When it stays quiet

The hook deliberately does nothing unless all four conditions hold:

| Condition | Why |
|---|---|
| `stop_hook_active` is not `true` | recursion guard: a second pass must not block the stop again |
| the project has a `memory_bank/` | otherwise there is nowhere to write |
| the working tree is dirty | an "asked and left" session produces nothing durable |
| the session marker is not set yet | one prompt per session, not per turn |

The marker is a file at `$TMPDIR/memorybank-capture-<session_id>`.

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
