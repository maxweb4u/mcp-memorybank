---
title: "Field test of the server on ebook_parser"
doc_kind: process
doc_function: canonical
purpose: "Exactly what to do to test memorybank-mcp in live work on a new project, and which numbers decide whether it passed."
derived_from:
  - backlog.md
  - implementation-plan.md
status: draft
audience: humans_and_agents
---

# Field test on ebook_parser

Closes [backlog.md](backlog.md) A-04.

The subject is `__my/modules/ebook_parser`: right now it holds one `specification.md` and nothing
else. That is the best possible test bed, because the bank has to be **built from nothing**, which
exercises both halves of the server: writing first, then navigating what was written.

## What is actually being tested

Not "do the tools work" — that is covered by 140 tests. Three things the tests cannot show:

1. **Does `bank_route` land on what is needed in real work**, rather than on the control questions I
   invented myself.
2. **Does `bank_create` get in the way more than it helps.** The gates either catch real mistakes or
   annoy for nothing — on a live project that shows within a day.
3. **What ends up in `_inbox` and how much of it is junk.** If there is nothing to review, or
   everything gets thrown away, automatic capture is not needed.

## Step 0. The bank skeleton

```bash
cd /Users/admin/Documents/docs/__projects/__my/modules/ebook_parser
node ../../mcp/memorybank/dist/cli.js --root "$PWD/memory_bank" --init "ebook_parser"
```

One command: 14 directories, `dna/` with seven governance documents, `flows/` with 23 templates, a
`README.md` per section, a root index carrying the project name, and two drafts —
`product/context.md` and `engineering/testing-policy.md` — which the templates and the feature
closure gate both point at.

Check immediately after: `--validate` must give **0 findings**. A bank created by the server is clean
by construction — which is exactly why we seed rather than copy someone else's bank: a copy would
bring its defects along (from AgentUpwork that would be a broken edge and a reference to a
nonexistent rule).

## Step 1. Wiring it up

`ebook_parser/.mcp.json`:

```json
{
  "mcpServers": {
    "memorybank": {
      "command": "node",
      "args": [
        "/Users/admin/Documents/docs/__projects/__my/mcp/memorybank/dist/cli.js",
        "--root",
        "/Users/admin/Documents/docs/__projects/__my/modules/ebook_parser/memory_bank"
      ]
    }
  }
}
```

`ebook_parser/.claude/settings.json` — the Stop hook from [hooks/README.md](hooks/README.md). The
project has to be under git, otherwise the hook cannot fire by construction.

Check before starting work:

```bash
node dist/cli.js --root .../ebook_parser/memory_bank --stats
```

Expected: contract found (`dna/frontmatter.md` in the list), `doc_kind` and `doc_function`
enumerated, no parse errors. If the contract is `ABSENT`, the seeding failed.

Separately: `/hooks` in an interactive session of the project must show the hook. That also closes
A-05, which is still unconfirmed.

## Step 2. Filling the bank through the server

Everything below is created **only** through `bank_create`, not a single file by hand. The point is
to catch the places where the server makes you do extra work.

The source is `specification.md` — it already contains the decisions, the model and the boundaries:

| Document | From | What it tests |
|---|---|---|
| `product/context.md` | §2 "What the package is worth" | the basic path, no template |
| `domain/model.md` | §3 "Public API" | `canonical_for` on the document model |
| `engineering/architecture.md` | §3 and the `src/` layout | `derived_from` on two documents at once |
| `adr/ADR-<ts>-package-name.md` | §1, the naming options table | the `record-adr` prompt on a ready-made alternatives table |
| `adr/ADR-<ts>-two-formats-one-model.md` | §2, the key decision | a second ADR, and a check of `bank_graph up` |
| `features/FT-01-extract-package/brief.md` | the whole extraction plan | the feature template, `delivery_status` |

Worth doing separately: **deliberately violate** a gate and look at the refusal text — create a
document with a `canonical_for` that is already taken and a `derived_from` pointing into nothing. The
message either explains what to do, or it does not.

## Step 3. A day of real work

After that: ordinary work on the package — extracting the code from TeaderBook, the README,
publishing to pub.dev. One rule: **for every question about the project, `bank_route` first, reading
only after.**

Notes accumulate in `_inbox` on their own. At the end — `review-inbox`.

## What counts as a result

Kept as I go, in free form, but against these six numbers:

| What to measure | Failure |
|---|---|
| How often I had to open a `README.md` by hand to find a path | more than twice in a day |
| `bank_route` misses: question → what I expected → what came back | the right document outside the top 3 more than a quarter of the time |
| `bank_create` refusals: justified or gratuitous | even one refusal I had to work around by hand |
| Notes in `_inbox` per day | zero (capture is not needed) or more than ten (noise) |
| Of those, how many I would keep | fewer than a third |
| `bank_validate` on the new bank | it grows, even though everything was created through the server |

The last row is the important one. A bank built entirely through `bank_create` is obliged to stay
clean by construction: path taken — refusal, `derived_from` into nothing — refusal, index
registration in the same operation. If findings show up anyway, the gates are insufficient, and that
is the main result of the test.

## What the test will not show

`bank_graph down` on a ten-document bank is close to meaningless — the blast radius is visible
without it. That half of the server can only be tested on showmojo or AgentUpwork, and it is already
covered by tests. Here we are looking at navigation and writing.
