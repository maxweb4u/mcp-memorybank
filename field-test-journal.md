---
title: "Field test journal"
doc_kind: reference
doc_function: canonical
purpose: "The running record of the field test — every session measured, every defect it found, and the experiment that compared the server against instructions alone."
derived_from:
  - field-test.md
status: active
audience: humans_and_agents
---

# Field test journal

The raw record behind [field-test.md](field-test.md). Kept as it happened, in order, so the numbers
can be checked rather than taken on trust. Findings are numbered from F-10 because F-1 to F-9 came
out of the dry runs before the server ever ran in a live session.

## Condition change before step 5

`ebook_parser/CLAUDE.md` now carries a Memory bank section — route before reading, create only
through `bank_create`, validate before committing, never promote out of `_inbox/`. Project-scoped on
purpose: the owner declined putting it in the global file, so it cannot reach any other bank.

This changes what the rest of the test measures, deliberately. "Does the model remember to reach for
an MCP tool" is a property of the model, not of the server; letting it read `README.md` half the time
would smear the one number worth having — whether `bank_route`, once called, returns the document
that was needed. Steps 0–2 ran without the instruction, so the two halves are not directly
comparable.

### F-10. The server told the agent to undo the bilingual layer

Asked what it knew, the fresh session reported, among the server's own instructions: "route with
English terms — bank documents are English-only, even when the conversation is in Russian."

That is exactly what the server said, in three places: the `instructions` field, the `bank_route`
description, and the `question` parameter description ("What you need to know, in English"). All
three were written before the bilingual work of the previous commit and were never revisited.

An agent that obeys them translates the question itself and passes English to a server built to do
that translation. `src/lang.ts` is then dead code on the documented path — and the user's own wording,
which the dictionary was tuned against, never reaches the ranker.

Nothing was broken; a feature was simply unreachable, and the only thing that revealed it was reading
what a real session had been told. **Fixed** — all three now say to pass the question in the words it
was asked in.

### Two observations that are not defects

The agent listed schemas for four `bank_*` tools and said the other five were deferred, names only.
That is the harness deferring MCP tool schemas until needed, not the server. It does mean the tools
whose schemas are not loaded are less likely to be reached for, `bank_graph` and `bank_changed` in
particular.

It also noted that the `/loadmemory` skill had it read an entry index directly, against the
route-first rule it had just been given. Two instructions in the same session pulling opposite ways —
worth knowing when the routing numbers come in.

## Step 5, first session — the tools lost to `cat`

One question opened it: "let's carry on with planning and architecture — first say what you know,
where we stopped, and what questions are open."

Tool calls in the whole session: `bank_route` ×1, `bank_validate` ×1, `Bash` ×15. **`bank_read` ×0.**

The "Failed to read core bank documents" the owner saw was a shell `cd` into a directory the shell
was already in. The agent dropped the `cd` and the same command worked. Nothing to do with the
server.

### F-11. `bank_read` reads one document, and `cat` reads ten

Having routed, the agent read every bank document through a Bash loop — ten files, ~30 KB, one call.
`bank_read` would have been ten calls for the same material, so it was never going to win. Section
scoping, the feature that exists to keep large documents out of the context window, loses on
arithmetic before it is ever considered.

The fix is not exhortation in `CLAUDE.md`. It is `bank_read` taking a list of paths, each with an
optional section, and returning them together. Then the cheap call is also the governed one, and
section scoping becomes the default rather than a discipline.

Not implemented: the rest of the test should run against the server as it is.

### F-12. The first real question was one the server cannot answer

"What do you know, where did we stop, what is open" is a state question, not a routing question.
`bank_route` answers "what should I read about X". Nothing answers "what is the state of this
project", so the agent did the only thing available and read everything.

This is the gap noticed an hour earlier while comparing against the owner's `/loadmemory` skill,
except it was a guess then and it is data now: it was the *first* question asked in real work, before
any question about a specific topic.

A `session-start` prompt over `memorybank://index` plus `bank_changed` would cover it. Recording the
shape, not building it yet.

### What did work

The single `bank_route` call was made in Russian, unprompted, and returned the right documents. The
bilingual path is exercised in real use, not only in tests — and the instructions that used to tell
the agent to translate the question itself were removed just before this session.

## Step 5 — a full working session, measured

Seven turns of real architecture work: open questions answered, decisions taken, nine ADRs written.
The bank went from 59 documents to 68, 206 KB to 309 KB.

| Tool | Calls |
|---|---|
| `Bash` | 85 |
| `bank_validate` | 10 |
| `bank_create` | 9 |
| `bank_route` | 1 |
| `bank_read`, `bank_search`, `bank_graph`, `bank_changed` | 0 |

### The six numbers

| What was measured | Threshold for failure | Result |
|---|---|---|
| `README.md` opened by hand to find a path | more than twice | **1**, and it was verifying the ADR index after a write, not navigating |
| `bank_route` misses | right document outside top 3 more than a quarter of the time | **no data** — one call all session |
| `bank_create` refusals worked around by hand | even one | **0** — nine writes, nine successes |
| notes in `_inbox` | zero, or more than ten | **0** so far; the session has not ended, so the hook has not had its chance |
| of those, how many kept | fewer than a third | not applicable yet |
| `bank_validate` grows | any growth | **0 throughout**, five clean runs while nine documents were added |

The last row is the one that mattered most, and it held in real work rather than in a test fixture:
nine documents written through the server, none of them hand-registered, and the bank never left zero.

`bank_validate` was called ten times unprompted. Nobody asked for it; it was used as a checkpoint
after each batch of writes. That is the tool earning its place without a rule telling anyone to run it.

### F-13. Front-loading defeats routing

One `bank_route` call, at the very start, and never again — not because ranking failed but because
after the opening `cat` of every bank document, there was nothing left to route to. The agent had the
whole bank in context by turn two.

F-11 and F-12 combine into this. The session opens with a state question the server cannot answer, so
the agent reads broadly; reading broadly is cheap through `cat` and expensive through `bank_read`, so
it reads everything; and having read everything, it never needs the router again.

Routing is not competing with the section indexes it was built to replace. It is competing with
"already in context", and against that it loses by default. A bank of 68 documents still fits. The
value shows up when it does not — which means the metric this test was designed around cannot be
measured on a young bank at all.

### F-2 confirmed in the wild

Six Bash writes into the bank, one of them labelled "Write remaining ADR bodies". `bank_create` laid
down frontmatter, template and index registration; every word of prose arrived through the shell.
The split is exactly what the missing body parameter predicts, and it is now measured rather than
argued: 9 governed creations, 6 ungoverned body writes.

## A-05 closed, and the defect it exposed

The transcript carries `hook_success`, `hookEvent: Stop`, `exitCode 0`, and the payload we rewrote
yesterday. The hook registers and fires. Both of yesterday's fixes — the nested config shape and the
top-level `continue`/`instruction` — were exactly what was missing. A-05 is closed.

### F-14. Once per session means once at the worst moment

```
12:36  first question
12:40  HOOK FIRED        ← end of turn one: reading and orientation, nothing decided
13:48  first bank_create ← and eight more ADRs after it
14:46  last bank_create
```

It asked four minutes in, the agent correctly stayed silent, the marker was set, and the nine
decisions that followed were never asked about. `Stop` fires every turn, so a one-shot marker always
lands on the first one. The guard against nagging had become a guarantee of asking before there is
anything to ask about.

**Fixed.** The marker now holds the time of the last ask and a fingerprint of the working tree; the
hook asks again once the tree has moved and `MEMORYBANK_CAPTURE_COOLDOWN_MIN` (default 30) has
passed. First attempt used `git status --porcelain` alone as the fingerprint, which does not work: an
untracked file reads as `?? path` however often it is rewritten, and rewriting the same files is what
a session does. The fingerprint hashes the dirty files' contents. Six branches exercised in a scratch
repository — first stop, unchanged state, edit inside cooldown, edit after cooldown, unchanged after
a second ask, clean tree.

The two `_inbox` rows of the results table are measurable from the next session onwards.

## Second working session — the cadence fix works, the payload did not

Session 08fed639: 8 turns, 109 Bash calls, `bank_create` ×8, `bank_validate` ×13, `bank_route` ×1,
`bank_read` ×0. The same shape as the first session, which settles F-13 as reproducible rather than
incidental: route once at the start, then everything through the shell.

The cadence fix did what it was meant to. The hook fired three times — 16:36, 17:39, 18:21 — instead
of once at minute four, each after real work and a cooldown.

### F-15. Three asks, nothing asked

`_inbox` is still absent. Not because the agent judged there was nothing to record: because the
question never reached it. After each firing the transcript goes straight to the user's next message.
The attachment says it all — `hook_success`, `exitCode 0`, empty stderr, and `"content": ""`. The
client parsed the output and derived nothing to inject.

The payload was `{"continue": true, "instruction": …}`, taken from the documentation. Read literally,
`continue: true` tells the client that stopping is fine — the opposite of the intent — and this build
ignores `instruction` entirely.

**Fixed** by emitting `decision: "block"` with a `reason`, the pair this client acts on, alongside
the documented fields for clients that read those. Blocking is safe only because of the
`stop_hook_active` guard, which was already there.

Twice now the documentation has been wrong about this hook and the transcript right. The first time
cost the config shape; this time the payload. Worth stating plainly: **a hook can exit 0, be logged
as a success, and do nothing at all.** The only proof it worked is a change in what the agent did.

## A-05 closed in full: the hook reached the agent and it wrote

At 22:02:58 the hook asked with the corrected payload, and two notes landed in `_inbox` a minute
later — without a session restart, because the script is re-read on every invocation while only its
registration comes from settings.

```
0d  _inbox/teaderbook-source-location.md
    Where The TeaderBook Source Lives — the absolute path to the app the package is extracted
    from, which no document in this repository records.
0d  _inbox/verify-current-behaviour-before-recording-it.md
    Verify Current Behaviour Before An ADR Rests On It — two accepted ADRs had to be amended
    because their premise about the source was never checked.
```

Both are durable in the sense the prompt asks for: neither is re-derivable from the code, and the
second is a process lesson that cost real work. Two notes for a full afternoon is neither zero
("capture is not needed") nor more than ten ("noise"), so that row of the results table comes back
inside its bounds on the first honest measurement.

`bank_validate` stays at 0 with the quarantine populated — a document in `_inbox` correctly does not
trip `unregistered-doc`.

### F-17. Routing returns quarantined notes

`memorybank://inbox` describes the quarantine as "nothing here is part of navigation until it is
promoted or deleted". `bank_route` returns `_inbox/` documents anyway, damped by the `inbox ×0.2`
layer weight but present — both notes came back in the top three for the question they answer.

Damping is not exclusion, and on a young bank a note reaches the visible ranks easily. Either the
resource's promise is wrong, or routing should filter the layer out. The promise is the one worth
keeping: the point of a quarantine is that unreviewed material is not served as an answer.

## Third session — the fixes measured

First session after `bank_read` took a list, `bank_create` took a body, `bank_update_section`
appeared, the quarantine left routing, and the bank got its own vocabulary.

| | session 1 | session 2 | session 3 |
|---|---|---|---|
| `Bash` | 85 | 129 | **6** |
| `bank_read` | 0 | 0 | **5**, four of them with an array of paths |
| `bank_update_section` | — | — | 1 |
| `bank_promote` | 0 | 0 | 2 (dryRun, then the write) |
| `bank_route` | 1 | 1 | 0 |

Two of the six shell calls touched the bank at all: one read the agent's own `MEMORY.md` index,
one deleted a consumed note. Everything else went through the tools. Three documents that would have
been three calls came back in one: `["domain/model.md", "engineering/public-api.md",
"engineering/architecture.md"]`.

F-11 and F-2 are answered by measurement rather than argument. The economics were the whole problem:
make the governed call the cheap one and it gets used.

The quarantine also completed a full circuit for the first time — hook writes two notes, the owner
reviews them, one is folded into the implementation plan with `bank_update_section`, one is promoted
into `processes/`, and the hook writes a third at the end of the session.

### F-18. The review offered three outcomes and the server supported two

`review-inbox` names promote, fold in, or drop. Folding in became possible with
`bank_update_section`; dropping never was. So the agent folded a note into the plan and then ran
`rm _inbox/teaderbook-source-location.md` in a shell, because nothing else could clear what it had
just consumed.

**Fixed** — `bank_discard { path, reason }`. `_inbox/` only, a reason is required so nothing goes
silently, and the note's title and purpose come back in the result. It will not touch a document in
the bank proper: deleting canonical documents is not something this server should learn.

### Still not measured

`bank_route` has been called twice across three working sessions. The design's central claim —
that routing lands on what is needed — remains the one thing the field test has not tested, for the
reason recorded in F-13: on a bank this size, nothing needs routing that reading the index has not
already answered.

## Fourth session — where the shell still wins

Five turns, heavy editing: six ADRs written, five documents amended, two notes promoted.

| Tool | Calls |
|---|---|
| `Bash` | 29 — of which **11 wrote into the bank** |
| `bank_update_section` | 8 |
| `bank_validate` | 6 |
| `bank_create` | 6 |
| `bank_read` | 5 (multi-path) |
| `bank_promote` | 4 (two dryRun, two writes) |
| `bank_route` | 1 |

Eight governed section writes against eleven ungoverned ones. Better than the 0-vs-85 of session
one, but the split is now roughly even, and the eleven fall into five clear shapes.

### F-22. Most edits are smaller than a section (5 of 11)

"Add STEP-00d and update STEP-01d and STEP-02", "Update SC-10, SC-12, SC-13", "Update STEP-03 and
STEP-07", "Record DEC-19..DEC-23", "Record symmetric parseMetadata cost in the Port section" — every
one is a few lines inside a section that is dozens of lines long. `bank_update_section` replaces the
whole section, so using it means resending everything unchanged around the edit. The agent chose a
Python string replace instead, every time.

The tool solved the wrong grain. Replacing a section is right for filling a placeholder and wrong for
amending a table row.

### F-23. A heading cannot be renamed (1 of 11)

`sed -i 's|^## Equality Is Settled For One Type And Open For The Rest$|## Equality Is Settled For
Every Type|'`. Nothing in the server renames a heading, and a heading is the addressing scheme every
section tool depends on — a stale one is worse than stale prose.

### F-20. A note in quarantine cannot be amended (1 of 11)

`bank_update_section` refuses `_inbox/` and points at `bank_promote`. That was my rule and it was
wrong: a draft under review is exactly what gets amended before the decision to keep it. The agent
rewrote the note with Python.

### F-21. Promotion leaves the body's relative links pointing at the old home (1 of 11)

A note in `_inbox/` linking `](../processes/verify-source-behaviour-before-recording-it.md)` still
says that after landing in `processes/`, where the correct link is the bare filename. `bank_promote`
rebuilds the frontmatter against the contract and leaves the body untouched, deliberately — but
"untouched" includes paths that only made sense from the old directory. Not caught by validation:
`unresolved-rule-reference` only fires on prose that claims a rule, not on every link.

### F-19. Cosmetic damage after `append` (2 of 11)

Two defensive `perl -0pi -e 's/## Heading\n\n\n/## Heading\n\n/'` runs. I could not reproduce a
triple newline in three shapes, so this is either a shape I have not found or a precaution that was a
no-op. Cheap insurance either way: trim the kept content at both ends, not just the end.

### The eleventh

"Replace the stale Empty placeholder in the process registry" — a section index still said the
section was empty after documents had been registered in it. `bank_create` and `bank_promote` add
their line; neither clears the "(nothing here yet)" line the starter writes.

### Fixed, second round

- **F-22 / F-23 — `bank_edit`.** One exact fragment, refused unless the match is unique, with the
  count reported rather than the first occurrence taken. `section` narrows an ambiguous search.
  Renaming a heading is an ordinary edit under the same tool. The search runs on the body, so the
  frontmatter is unreachable by construction. Six of the eleven shell writes were this shape.
- **F-20** — `bank_update_section` no longer refuses a quarantined note. A draft under review is
  exactly what gets amended before the decision to keep it, and refusing sent a real session to a
  Python heredoc.
- **F-21** — `bank_promote` rewrites the body's relative links for the new directory, but only the
  ones that resolve inside the bank; each rewrite comes back as a warning. Guessing at a link that is
  already broken would be worse than moving it unchanged.
- **F-19** — the kept content of an `append` is trimmed at both ends.
- **The eleventh** — registering the first document in a section index removes the line claiming the
  section is empty. It never did, so an index could carry entries under a claim of emptiness.

184 tests. `bank_read`'s error for a missing section, seen in the same session, needed nothing: it
already answers with the list of real sections.

## Fifth session — the shell stopped being used

Nine turns of architecture review and correction: twenty-one edits across ADRs, the model, the public
API, the brief and the plan; two documents created; the bank at 87 documents, validating at zero.

| Tool | Calls |
|---|---|
| `bank_edit` | 21 |
| `bank_read` | 7 (multi-path) |
| `bank_validate` | 3 |
| `bank_create` | 3 (one dryRun) |
| `bank_changed` | 2 |
| `bank_route` | 1 |
| `Bash` | **1** — `ls` on a corpus directory outside the bank |

**Zero shell writes into the bank**, against eleven in the session before and no governed edits at
all in the first. The whole arc, in one column each:

| | s1 | s2 | s3 | s4 | s5 |
|---|---|---|---|---|---|
| `Bash` total | 85 | 129 | 6 | 29 | 1 |
| shell writes into the bank | 6 | ? | 1 | 11 | **0** |
| governed writes | 9 | 12 | 10 | 18 | 24 |

Nothing was said to the agent about preferring the tools; `CLAUDE.md` has carried the same four lines
since session three. What changed each time was whether the governed call was cheaper than the shell
one. It was never a discipline problem.

### The prompts do reach the client

`<command-message>mcp__memorybank__session-start</command-message>` — invoked from the slash menu,
not typed as text, which is why the same word typed plainly in the previous session produced only a
greeting. And it did its job: `bank_changed` was called for the first time in the whole field test,
twice, followed by a three-path `bank_read`. F-12 is answered.

### `bank_edit` behaved as designed

Twenty-one calls, one failure — and that failure was the agent mistyping the tool name
(`mcp__memorykbank__bank_edit`), retried successfully. No ambiguous-match refusals, no not-found
refusals: with `section` to narrow the search, every edit matched uniquely on the first try.

### Two things left

The placeholder fix only applies going forward. Six section indexes in this bank still carry "Empty.
A first document of this kind is registered here." under entries that exist — the line is only
removed when a document is registered, and these were registered before the fix. Nothing false is
being claimed about a section that is genuinely empty, but the six that are not empty need a sweep.

`bank_route` has now been called five times across five sessions. On a bank the agent can hold in
context, nothing needs routing. That claim remains untested, and only a bank with history will test
it.

## Fifth session, continued — 44 edits, one shell call

The session ran on to fourteen turns. Final shape:

| Tool | Calls |
|---|---|
| `bank_edit` | 44 |
| `bank_read` | 10 |
| `bank_validate` | 5 |
| `bank_create` | 4 |
| `bank_changed` | 2 |
| `bank_route` | 1 |
| `Bash` | 2 — an `ls` and a `curl` to pub.dev, neither touching the bank |
| native `Edit` | 1 |

Forty-four governed edits against a single ungoverned one, and that one used the harness's own file
editor rather than a shell heredoc. The bank ended at 88 documents, 511 KB, validating at zero.

### F-24. A batch read can overflow the caller

A five-path read returned 106,864 characters and the caller truncated it to a file — the answer
became a file path instead of an answer. The documents were 56 KB of markdown; JSON escaping and a
repeated frontmatter per document nearly doubled that.

The multi-path read fixed the wrong economics and inherited a new failure at the other end: one call
is cheap to make and unbounded in what it returns.

**Fixed.** A batch has a byte budget (60 KB by default, `maxBytes` to override), spent in the order
asked. What the budget does not reach comes back under `skipped` with its title, size and section
list, so the caller asks for those by section instead of repeating the whole read. Degrading with a
named remainder beats answering with a file path.

### Not a defect

One `bank_edit` was refused with `Not found`, correctly: the `find` text did not match. The agent
re-read and retried. Another failed on the agent's own typo in the tool name. Neither is ours.

## Fifth session, final — 66 edits, two shell calls

Twenty turns. Final shape:

| Tool | Calls |
|---|---|
| `bank_edit` | 66 |
| `bank_read` | 14 |
| `bank_validate` | 8 |
| `bank_create` | 4 |
| `bank_changed` | 2 |
| `bank_route` | 1 |
| `Bash` | 2 — an `ls` and a `curl`, neither touching the bank |
| native `Read`/`Edit` | 1 each |

Sixty-six governed edits against one ungoverned. `bank_validate` was called eight times, none of them
asked for.

Three tool results were not successes, and none is a defect of the server: one `Not found` from
`bank_edit`, where the `find` text had gone stale under an earlier edit and the agent re-read and
retried; one `No such tool available: mcp__memorykbank__bank_edit`, the agent's own typo; and one
`InputValidationError` from the harness's `AskUserQuestion`.

The read overflow that produced F-24 happened at 22:06, and the agent recovered by itself — it
reissued the same read with three paths instead of five. The budget fix landed after that session's
server process started, so it has not been exercised in the field yet; it is covered by tests only.

### F-25. `bank_changed` refused a ref older than the repository

Reported from a live session, and the report was right on both counts: `HEAD~20` failed outright in a
repository with eight commits, and `session-start` names exactly that ref, so the first call of the
procedure fails on any project younger than twenty commits — which every new project is.

Walking off the end of history should land on the beginning of it. A ref of the form `<rev>~N` or
`<rev>^` that does not resolve now falls back to the first commit reachable from its base, and the
result says so in `note` while keeping the `since` the caller asked for. A ref that names nothing at
all — a misspelled branch — still fails, as it should.

## Session 6 — c5001551 (31 Aug 23:26 → 1 Sep 08:47 local, 14 user turns)

A real working session: implementation of STEP-01..05 of FT-001, then two rounds of adversarial
bug review. 62 Bash, 46 Edit, 43 Write, 30 Read, 9 server calls.

**Writes into the bank behind the server's back: zero.** First session with a clean record on that
axis. The four Bash calls that touched `memory_bank/` were all `grep`/`sed -n` reads of one fact out
of `corpus-findings.md` — cheaper than a tool call and harmless.

Verified live, not only in tests:
- `bank_changed since: "HEAD~20"` on an 8-commit repository — the F-25 fallback, no error.
- `bank_update_section` replacing `Work Order` in a 35.9 KB plan: 35899 → 36446 bytes.
- `bank_validate` over 65 documents: 0 findings.
- `bank_create` into `_inbox` fired by the Stop hook, with a usable purpose line.
- The Stop hook fired twice, 5 hours apart (00:15, 05:35), tree moved in between — the fingerprint
  and cooldown behave. The second was declined because the work was genuinely unfinished.

**F-26 — `maxBytes` let the agent opt out of the budget, and it did, twice.** Both multi-path reads
passed `maxBytes: 200000`. The five-path read returned 55,705 content bytes as 61,564 JSON chars and
the caller persisted it to a file; the seven-ADR read produced 91,073 chars and was refused outright.
Both times the answer was a file path. The budget added after session 5 was a default, so it was
worth exactly nothing against an agent that names a bigger number.

Fixed: `maxBytes` may lower the budget, never raise it, and a request above the ceiling comes back
with a `note` saying why. A document whose indexed size would overshoot is now skipped *before* it is
read, instead of being read whole because a byte of budget was left; the first document is always
returned so a batch never answers with nothing.

**F-27 — the ceiling itself was set from a bad measurement.** The comment in `read.ts` claimed JSON
roughly doubles the markdown. Measured here: 55,705 → 61,564, about a tenth. The old 60,000 budget
would therefore have produced ~66 KB and been persisted to a file anyway — the fix would not have
fixed it. Ceiling lowered to 40,000, and the comment now carries the measured ratio.

**`bank_route`: zero calls, sixth session running.** Navigation went through `memorybank://index`
and paths quoted from the implementation plan. The routing claim is still untested in the field.

### Session 6, second half (05:48 → 11:01 UTC) — the lifecycle finally ran

23 server calls: `bank_update_section` ×6, `bank_route` ×5, `bank_promote` ×4, `bank_discard` ×4,
`bank_validate` ×3, `bank_create` ×2, `bank_read` ×1. Zero writes into the bank outside the server.

**`bank_route` was used for the first time in the field, and it was right five times out of five.**
Triggered by the `review-inbox` prompt, not by instruction. Top hit correct on every question, and in
four of the five it was earned by `canonical_for` ownership rather than word overlap — `owns
canonical_for: required_test_coverage` for the testing question, `format_extraction_boundary` for the
new-format question, `parallel_decision_review_rule` for the review-process one. The claim the design
rests on is no longer untested.

**The dry-run-first pattern appeared on its own.** Three `bank_update_section` calls and two
`bank_promote` calls ran with `dryRun: true`, were shown to the user, and were executed unchanged
four hours later once the answers came back. Nothing in `CLAUDE.md` or the prompts asks for this.

**The quarantine emptied.** `_inbox` went from five notes to none: two promoted into `engineering/`
with `derived_from` back-links, four discarded with a written reason naming the section each was
folded into. `bank_validate` returned zero findings after every step, including after promotions
whose `derivedFrom` was a bare `public-api.md` resolved relative to the destination directory. Both
captures used `inbox: true` together with the path where the note eventually belonged, which is the
intended shape.

**F-28 — two stopword lists had drifted apart.** Asked for "improvements deferred from review, API
hardening ideas that are not defects", the router scored `corpus-findings.md` on the word `not` and
ranked it third with `why: purpose matches "not"`. `search.ts` had filtered `not`, `from`, `can` and
`must` from the start; `route.ts` never got them. Fixed by bringing route's list up to search's, with
a tokenizer test that fails without it — the first version of that test passed on the unfixed code,
because the 17-document fixture has no document to score on `not` at all.

**F-27 confirmed a second time.** The 45,000-byte read returned 35,397 bytes of markdown as 41,100
characters of JSON — a ratio of 1.16, not the 2.0 the old comment claimed. Under the new 40,000
ceiling that same call still returns all six documents.

## Session 7 — ebook_parser c2821073 (1 Sep 14:03 → 16:12, 12 turns)

32 server calls against 33 Bash, and **zero writes into the bank outside the server**. The bank was
touched from a shell once, by `grep`.

`session-start` → `bank_route` with a Russian question → sectioned reads. Bilingual routing exercised
in the field for the first time: three routes asked in Russian, all landing on the right document.

Two section names missed (`Status`, `Verify Contract`); both errors listed the real sections and both
were recovered on the next call, which is the refusal working as designed rather than a defect.

Two Stop-hook captures into `_inbox`, both later folded into the document that owns the fact —
`architecture.md § Package Metadata` and `public-api.md § No Flutter` — and discarded with a reason
naming the destination. Inbox 2 → 0. The dry-run-first pattern repeated: every `update_section` and
`discard` ran with `dryRun: true`, waited for the user, then executed unchanged.

## Session 8 — tasman.research 6bc7016a (1 Sep 14:22 → 16:06, 33 turns)

A bank being built rather than read: `bank_init`, then **18 `bank_create` calls carrying bodies of
2–6 KB**. The `body` parameter added after session 5 is doing exactly what it was added for — not one
of those documents was written by hand.

But three shell writes into the bank, each pointing somewhere different.

**F-29 — a status transition has no governed path.** `sed -i '' 's/^status: draft$/status: active/'`
on `product/context.md`. `bank_create` takes a status and `bank_promote` sets one, but nothing can
change the status of a document already in place, and `bank_edit` cannot reach frontmatter by
construction. This is the worst possible edit to leave to a shell: `status: active` is precisely the
gate in `checkGovernance` — "Governance requires every active non-root document to declare
derived_from" — so the one edit the gate exists for is the one edit that skips it. No damage here
(the seeded document already had `derived_from`, and `bank_validate` is clean), but only by luck.

**F-30 — programmatic bulk content, which the server probably cannot win.** A python script read the
Feature Inventory tables of 19 domain documents, generated a 610-row aggregate, and wrote two
sections of `product/trim-decisions.md` directly. `bank_update_section` could have done the write,
but only by shipping the whole generated table through the tool call as a string — tens of KB the
agent never had to materialise otherwise. A second script normalised capability IDs across six
documents with one regex. Neither is a defect to fix by adding a tool; both are worth naming as the
class of write where the shell is genuinely cheaper, and deciding deliberately whether the bank wants
to know it happened.

**F-31 — `bank_create` bodies failed client-side JSON serialisation twice in one day**, once in each
project, both on multi-KB bodies, both retried successfully within ten seconds. The server never saw
either call. Not a server defect, but a cost of carrying a document body as a JSON string argument,
and worth watching now that `body` is the main path for creating documents.

### F-29, F-30 fixed

`bank_set_status` — the 13th tool. The transition runs `checkGovernance` with the new status, so
activating a document without `derived_from` is refused on the way in rather than found by
`bank_validate` afterwards. Frontmatter is otherwise untouched byte for byte; a note in `_inbox/` is
refused and sent to `bank_promote`.

`contentFile` on `bank_update_section` and `bodyFile` on `bank_create`. The reason the generated
table bypassed the server was never that the server could not do the write — it was that the write
wanted the table as a string argument, and the table had never been in context. Content computed
rather than composed no longer has to be recited to be governed. Capped at 1 MB, and passing both
forms is refused rather than resolved.

This also closes the reachable half of F-31: a body that does not travel as a JSON string cannot fail
to serialise as one. The other half — an agent's own prose failing serialisation — stays unfixable
from this side; both field cases self-corrected within ten seconds.

Left undone deliberately: the cross-document regex rename (six documents, one `sed -E`). One
occurrence, during first assembly, on identifiers the agent had invented minutes earlier — and the
guarantee that makes `bank_edit` safe, exactly one occurrence, does not carry across documents in any
obvious way.

## Session 9 — readtolearn/frontend, the first existing bank (1 Sep)

Wired local-only, at the user's instruction: `claude mcp add --scope local`, so the server definition
lives in `~/.claude.json` and nothing enters the repository — no `.mcp.json` with absolute paths in a
project under version control. The Stop hook was merged into the existing
`.claude/settings.local.json` with `jq`, keeping its seven `permissions.allow` entries.

The bank itself: 77 documents, 667 KB, written by hand over months, and `bank_validate` finds three
warnings and no errors — one document no index links to, two `delivery_status` values not declared in
`dna/`. No broken `derived_from`, no frontmatter problems. It also declares no `canonical_for` at
all, so routing here runs without its strongest signal, by the bank's own design rather than by
defect.

**F-32 — the bilingual layer answered questions about the bank and fell silent on questions about
the product.** Measured:

```
"как устроен разбиение книги на страницы"   → no matches
"что известно про домашний экран"           → no matches
"how is a book split into pages"            → engineering/architecture.md
"home screen and library"                   → engineering/architecture.md
```

The router was fine; the dictionary was the failure. `книга`, `страница`, `экран`, `библиотека`,
`текст`, `глава`, `перевод`, `список`, `кнопка` all expanded to nothing, and `словарь` expanded to
`glossary, vocabulary` — the wrong word entirely for a project whose feature is an offline
dictionary. The 129 entries had been taken from the vocabulary of the banks themselves, so the layer
worked on bank-shaped questions and had nothing to say about the thing a bank documents. Every
Russian question in the ebook_parser sessions happened to be bank-shaped, which is why five sessions
never found this.

Fixed by a second layer: 63 entries of ordinary product vocabulary, 192 in total. Homonyms are split
by key length rather than blurred, since `RU_KEYS` is sorted longest-first — глава/главный,
удаление/удалённый, ответ/ответственность, жест/жёсткий. All four field questions now route, and the
offline-dictionary question improved from `adr/README.md` at 7.2 to `ADR-007-opus-mt-offline-nmt.md`
at 11.52. No regression on ebook_parser.

## Session 10 — readtolearn/frontend, a full working day (1 Sep 20:35 → 2 Sep 16:58, 54 turns)

The first session on an existing bank, and it inverts every measurement before it.

```
Bash                              294
writes into the bank from a shell  20
calls to the server                 3   (all three from the Stop hook)
bank_route                          0
bank_read / bank_edit / bank_update_section / bank_validate   0
```

Nothing here is a defect of the server. Two separate causes, and neither is economics.

**Routing lost to redundancy, not to cost.** `CLAUDE.md` in this project is 88 lines written long
before the server existed, and it navigates by path: "Read `memory_bank/README.md`, then
`memory_bank/processes/session-handoff.md`", with ADR paths named inline throughout, and "when a
decision changes, update the relevant `memory_bank/` doc". That is precisely the walk `bank_route`
replaces — so the agent already had the answer routing exists to give. The proof it was not a cost
question: the one `ToolSearch` of the session, at 07:49, loaded `bank_create` **and** `bank_route`.
The router was in hand for the following nine hours and was never called once.

**The write tools lost to invisibility.** That same `ToolSearch` selected exactly the two tool names
the Stop hook message mentions. `bank_edit`, `bank_update_section` and `bank_read` were never loaded,
because nothing in the session ever named them and an agent cannot search for a tool it does not know
exists. Meanwhile the twenty shell writes are, almost item for item, what `bank_edit` was built from:
insert a row into the backlog table (×4), prepend an entry to `session-handoff.md` (×4), rename a
heading, replace a passage inside a long section (×6). Two of the twenty wrote into
`readtolearn/backend`, a different bank with no server wired, where the shell was simply correct.

**And the day ran its own controlled experiment.** Four documents were added to the bank. The two
written with `cat > … <<EOF` are now the two new `unregistered-doc` warnings — validate went from 3
to 5. The two written through `bank_create` are clean, because registering a document in its section
index is the same operation as creating it. Nobody arranged that comparison; a day of real work
produced it.

The hook itself worked exactly as designed: fired twice, produced two well-formed quarantined notes,
each `dryRun` first, one of them correcting its own `doc_kind` after the warning.

The lever here is not server-side. It is the project's `CLAUDE.md`, which is the user's to change —
`ebook_parser` got a "Memory bank" section and behaves accordingly; this project never did.

## The experiment — result, 4 September

### Arm A — readtolearn/frontend, seven lines added (10:47 → 18:49, 40 turns)

```
                                     baseline (1–3 Sep)   after
writes into the bank from a shell            20             0
bank_edit                                     0            19
bank_validate                                 0             5
bank_create                                   3             5   (baseline: all hook-provoked)
bank_route                                    0             0
shell searches of the bank                   18            11
new unregistered-doc                          2             0
```

Criterion 1 — **passed.** The three `unregistered-doc` warnings are the same three as before; nothing
created in this run is unreachable. (A third `unknown-enum-value` appeared, `delivery_status:
blocked`, but git dates it to the baseline day's commit f14570c, not to this run.)

Criterion 2 — **failed.** `bank_route` was called zero times against eleven shell searches. But the
criterion was mis-specified, and the transcript says why: of the eleven, only about three are
routing-shaped questions ("which document mentions devicectl"). The rest read a *known* document —
grep an anchor in `backlog.md`, pull a recipe out of a named brief. Those are `bank_read` and
`bank_search` questions, and the seven lines name neither.

Criterion 3 — **passed, completely.** Seventeen edits to `backlog.md` and `session-handoff.md`, all
seventeen through `bank_edit`. The baseline was zero of ten.

**The sharpest result is not in the criteria.** The agent used every tool the seven lines named —
`bank_edit` 19, `bank_create` 5, `bank_validate` 5 — and no tool they did not name. `bank_read` and
`bank_search` were never called, and eleven greps stand where they would have gone. Naming a tool is
what makes it exist.

### Arm B — idelo, no CLAUDE.md at all (19:45 → 18:49, 19 turns)

A bank built backwards out of a finished, released app: 0 → 62 documents, `bank_validate` **total 0**.

```
bank_edit 29 · bank_create 13 · bank_validate 12 · bank_update_section 10
bank_promote 7 · bank_set_status 3 · bank_read 3 · bank_init 2
one write into the bank from a shell
```

`bank_promote` ran for the first time in the field, seven times; `bank_set_status`, shipped the day
before, three. Both arrived without any document telling the agent they exist.

The confound is worth stating: the opening instruction named `bank_init`, and one named tool is
enough — `ToolSearch` finds the family from there. So arm B is not "uninstructed", it is "one tool
named instead of five". Which makes the cross-arm comparison the real finding: arm A named five tools
and used exactly those five; arm B named one, discovered thirteen, and used eight. Discovery, not
preference, is what the seven lines bought — and they bought exactly as much of it as they spelled
out.

**F-33 — frontmatter beyond `status` still has no governed path.** The single shell write in arm B
stripped `canonical_for` from a document being archived, with a python regex. `bank_set_status`
closed the `status` half of this on 3 September; releasing an ownership key when a canonical document
is retired is the same gap one field over, and it matters more — an archived document that still owns
a key blocks the successor that should own it.

### F-33 fixed, and the lines rewritten

`bank_set_status` now refuses to archive a document that still owns `canonical_for`, naming the keys,
and drops them as part of the transition when `releaseCanonical` says so. The refusal caught an
existing test on its first run — one that archived `engineering/testing-policy.md`, owner of four
keys — which is the behaviour arriving rather than a regression. 212 tests.

The CLAUDE.md block was rewritten around what the experiment actually showed. The first version
listed five tools and got exactly five tools used. The second one names the prefix and says to go
look — "its tools all begin with `bank_`; load them at the start of a session and look at what is
there" — and then groups the ones worth knowing by the job rather than reciting them: finding,
changing, creating, checking. `bank_read` and `bank_search` are in it now, since eleven greps in the
measured run stood exactly where they belonged.

## Round two, 4–5 September — and the comparison is finished

The rewritten paragraph ("its tools all begin with `bank_`; load them and look at what is there",
then four jobs instead of five names) got its own working session.

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

Every tool the rewrite newly named appeared, and none had before: `bank_route`, `bank_search`,
`bank_read`. Searches fell 18 → 11 → 8. And the bank finished at **89 documents, zero findings** —
the three orphaned documents and the three invented `delivery_status` values are gone, which is the
first time this bank has validated clean since we started measuring it.

### idelo, the control, is what makes the answer legible

idelo has no CLAUDE.md and never got one. Over the same days it reached 67 documents, `bank_validate`
zero — built backwards out of a released app — using `bank_edit` 30 times, `bank_create` 18,
`bank_update_section` 10, `bank_promote` 7, `bank_set_status` 4. It found the whole family alone.

And it still made **seven shell writes into the bank**: a `sed` fixing a stray character, and six
python rewrites of an ADR, the testing policy, an ops document and the root index. Every one of them
is `bank_edit` or `bank_update_section` shaped — by an agent that was using both tools heavily in the
same session.

So the two projects separate the two effects cleanly, in the same week, on the same server:

- **The server is what makes the bank hold.** 67 documents built from nothing with zero findings, and
  a hand-written bank of 89 that went from six findings to none. No paragraph of instructions does
  that; instructions cannot check anything.
- **The paragraph is what makes the choice consistent.** With it, zero shell writes into the bank
  across two sessions. Without it, the same agent that called `bank_edit` thirty times still reached
  for python six times, on edits those tools were built for.

The question "the server or CLAUDE.md" is answered by being the wrong question. They fail in
different ways: without the lines the mechanism sits unused (nine hours with `bank_route` loaded and
never called, measured 2 September); without the mechanism the lines have nothing to point at.
