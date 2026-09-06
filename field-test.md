---
title: "Field test of the server"
doc_kind: process
doc_function: canonical
purpose: "The field test of mcp-memorybank in live work — the plan it ran to, the six numbers it collected, the twenty-four defects it found, and the experiment that compared the server against instructions alone."
derived_from:
  - backlog.md
  - implementation-plan.md
status: active
audience: humans_and_agents
---

# Field test

Closes [backlog.md](backlog.md) A-04. The plan below was written before the test; what it found is in
[the second half](#what-it-found), and the running record is [field-test-journal.md](field-test-journal.md).

The subject is `__my/modules/ebook_parser`: right now it holds one `specification.md` and nothing
else. That is the best possible test bed, because the bank has to be **built from nothing**, which
exercises both halves of the server: writing first, then navigating what was written.

## What is actually being tested

Not "do the tools work" — that is covered by the test suite (140 at the time; 271 now). Three things the tests cannot show:

1. **Does `bank_route` land on what is needed in real work**, rather than on the control questions I
   invented myself.
2. **Does `bank_create` get in the way more than it helps.** The gates either catch real mistakes or
   annoy for nothing — on a live project that shows within a day.
3. **What ends up in `_inbox` and how much of it is junk.** If there is nothing to review, or
   everything gets thrown away, automatic capture is not needed.

## Step 0. The bank skeleton

```bash
cd <projects>/ebook_parser
node ../../mcp/memorybank/dist/cli.js --root "$PWD/memory_bank" --init "ebook_parser"
```

One command: 14 directories, `dna/` with seven governance documents, `flows/` with 23 templates, a
`README.md` per section, a root index carrying the project name, and two drafts —
`product/context.md` and `engineering/testing-policy.md` — which the templates and the feature
closure gate both point at.

*(That was 50 files. The seeded shape is 24 now — three sections build on first use and the templates
are pointed at rather than copied. See [architecture.md](architecture.md); the numbers below were
taken against the shape described here.)*

Check immediately after: `--validate` must give **0 findings**. A bank created by the server is clean
by construction — which is exactly why we seed rather than copy someone else's bank: a copy would
bring its defects along — in the bank that would have been the donor, a broken edge and a reference
to a nonexistent rule.

## Step 1. Wiring it up

`ebook_parser/.mcp.json`:

```json
{
  "mcpServers": {
    "memorybank": {
      "command": "node",
      "args": [
        "<projects>/memorybank/dist/cli.js",
        "--root",
        "<projects>/ebook_parser/memory_bank"
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
without it. That half of the server can only be exercised on a bank that has years of history in it,
and it is already covered by tests. Here we are looking at navigation and writing.

---

# What it found

*Written 5 September 2026, after the test ran. The session-by-session record is
[field-test-journal.md](field-test-journal.md).*

The test outgrew its own plan. It was designed for one new project and a day of work; it ran for
three weeks across four — `ebook_parser` and `tasman/research` built from nothing,
`readtolearn/frontend` an existing hand-written bank of 88 documents, and `idelo` a bank built
backwards out of a released Flutter app. That was not scope creep for its own sake: the single-project
plan could not answer the question it was built around, and the reason is finding F-13.

## The six numbers

| What was measured | Failure | Result |
|---|---|---|
| `README.md` opened by hand to find a path | more than twice a day | **1**, and it was checking an index after a write |
| `bank_route` misses | right document outside the top 3 more than a quarter of the time | **not measurable** — see F-13 |
| `bank_create` refusals worked around by hand | even one | **0** across every session |
| notes in `_inbox` per day | zero, or more than ten | **2–3**, after the cadence fix in F-14 |
| of those, how many kept | fewer than a third | **all of them**, over three reviews |
| `bank_validate` grows on a bank built through the server | any growth | **0**, held through 67 and 89 documents |

The last row is the one the plan called the main result, and it held in real work rather than in a
fixture. `idelo` reached 67 documents at zero findings; `readtolearn/frontend`, hand-written and
never governed, went from six findings to zero once the server was pointed at it. `bank_validate`
was called ten times in the first session alone without anyone asking for it — used as a checkpoint
after each batch of writes, which is a tool earning its place without a rule telling anyone to run it.

## The number that could not be measured, and why that is the finding

`bank_route` was called twice in the first three working sessions. Not because ranking failed — because
after the opening `cat` of every bank document there was nothing left to route to. A bank of 68
documents fits in context by turn two.

Routing was never competing with the section indexes it was designed to replace. It competes with
"already in context", and against that it loses by default. The metric this test was designed around
cannot be taken on a young bank at all; it needs a bank too large to read, which is a later test on a
different corpus. What the test *can* say is that once the CLAUDE.md paragraph named `bank_route`,
it started being called on a 88-document bank — two calls where there had been none in nine hours.

## What the test was actually good for

Twenty-four findings, F-10 through F-33, none of which 212 unit tests could have reached — every one
was a capability that did not exist rather than a behaviour that was wrong. The ones that changed the
server:

| Finding | What was missing | What it became |
|---|---|---|
| F-11 | `bank_read` cost more than `cat` for ten documents | `bank_read` takes an array of paths |
| F-2, F-16 | `bank_create` wrote frontmatter and left the prose to the shell | a `body` parameter, then `bodyFile` |
| F-18 | `review-inbox` offered three outcomes, two were supported | `bank_discard`, reason required |
| F-20 | a quarantined note could not be amended | `bank_update_section` accepts `_inbox/` |
| F-21 | promotion left relative links pointing at the old home | `bank_promote` rewrites them |
| F-22, F-23 | most edits are smaller than a section | `bank_edit`, one exact fragment, unique match |
| F-24, F-26, F-27 | a batch read could overflow the caller, and the ceiling was set from a bad measurement | a budget that cannot be opted out of |
| F-25 | `bank_changed` refused a ref older than the repository | a walking-ref fallback, and one for no repository at all |
| F-29 | a status transition had no governed path — `sed -i` did it | `bank_set_status` |
| F-30, F-31 | bulk generated content failed JSON serialisation client-side | `contentFile` and `bodyFile` |
| F-32 | the bilingual layer answered about the bank and fell silent about the product | a second dictionary layer, 129 → 192 entries |
| F-33 | archiving a document silently kept its `canonical_for` keys | `releaseCanonical`, refusal by default |

The pattern is one thing repeated: **the shell wins whenever the governed call is more expensive than
the ungoverned one.** Every fix above is the same fix — make the governed call cheap. Measured across
one bank, shell calls went 85 → 129 → 6 as those landed.

## The experiment: the server, or a paragraph of instructions?

Halfway through, the obvious objection arrived — `readtolearn/frontend` has an 88-line `CLAUDE.md`
that already tells an agent where everything is. Why does a server need to exist?

Pre-registered, two arms, same server, same week. Arm A added seven lines to `frontend/CLAUDE.md` and
measured two working sessions against a baseline. Arm B was `idelo`, with no `CLAUDE.md` at all.

```
                              baseline    round 1      round 2
                                          (5 named)    (rewritten)
writes into the bank, shell        20          0            0
bank_edit                           0         19           14
bank_route                          0          0            2
bank_search                         0          0            2
bank_read                           0          0            1
shell searches of the bank         18         11            8
bank_validate findings            3→5          6            0
```

The first version of the paragraph named five tools and got exactly five tools used. The second one
names the prefix and says to go look — *"its tools all begin with `bank_`; load them at the start of
a session and look at what is there"* — then groups the ones worth knowing by job rather than
reciting them. Every tool the rewrite newly named appeared, and none had before.

Arm B is what makes the answer legible. `idelo`, with no instructions, still found the whole tool
family alone — `bank_edit` 30 times, `bank_create` 18, `bank_promote` 7 — and reached 67 documents at
zero findings. And it still made **seven shell writes into its own bank**, every one of them
`bank_edit` or `bank_update_section` shaped, by an agent using both tools heavily in the same session.

So the two effects separate cleanly:

- **The server is what makes the bank hold.** Instructions cannot check anything. No paragraph takes a
  hand-written bank from six findings to zero, or builds 67 documents that validate clean.
- **The paragraph is what makes the choice consistent.** With it, zero shell writes across two
  sessions. Without it, the same agent that called `bank_edit` thirty times still reached for python
  six times, on edits those tools were built for.

"The server or `CLAUDE.md`" is the wrong question. They fail in different ways: without the lines the
mechanism sits unused — nine hours with `bank_route` loaded and never called, measured 2 September;
without the mechanism the lines have nothing to point at.

## What is still untested

Routing on a bank too large to read, for the reason in F-13. `bank_graph down` on a bank with years of
history — the blast radius of a ten-document bank is visible without it. And whether `_inbox` capture
stays useful past the three-week mark, or silts up.
