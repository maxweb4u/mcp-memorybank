---
title: "mcp-memorybank — backlog"
doc_kind: project
doc_function: canonical
purpose: "What is left after the implementation plan closed: rollout into the banks, optional server work, preparation for publishing."
derived_from:
  - implementation-plan.md
status: active
audience: humans_and_agents
---

# Backlog

The implementation plan is closed: [implementation-plan.md](implementation-plan.md), E0…E5 plus the
quarantine. This is what fell outside it.

Not included here: fixing the 321 validator findings across nineteen banks — that is separate work.
A-04 no longer blocks it, but it stays queued behind the owner's word: the existing banks are not
touched on this server's initiative.

## A. Rollout — work in the banks, not in this repository

Agreed while going through the specification and comparing against bulletproof, but not carried out.

### A-01. karpathy-guidelines into the global CLAUDE.md

Copy `CLAUDE.md` from `multica-ai/andrej-karpathy-skills` into `~/.claude/CLAUDE.md` (or wire it in
as a skill). Four behavioural rules: do not over-engineer, do not touch neighbouring code, name your
assumptions, state a checkable definition of done.

There is nothing to integrate: no artifacts, no state, no seams with the server. It is background.

**Done when:** the rules are in CLAUDE.md. Ten minutes of work.

### A-02. Four additions to `flows/feature-flow.md`

From the comparison with bulletproof: of its twelve stages, eight are already covered by your flow,
and on six of them your flow is stricter. Genuinely new — four items.

| What | Where | Why |
|---|---|---|
| A research finding: who has solved this before, and why this approach was chosen | the `Draft Feature → Problem Ready` gate predicate | the one bulletproof stage that has no counterpart at all; grounding exists, but only about your own codebase and only on the `Plan required: yes` path |
| At least two `ALT-*`, rejected with a reason | the same gate, regardless of the Design Requirement | today alternatives are only required when `Design required: yes`; for a compact or no-plan feature nobody asks whether a better solution exists |
| "A bug without a reproduction is not a bug; cosmetic edits are forbidden" | `engineering/testing-policy.md` | a direct continuation of the `NS-*` principle, one level down at the code |
| An anti-rationalization Stop hook | the project's `.claude/settings.json` | not a document; blocks completion on "pre-existing issue", "out of scope", "follow-up" |

Three of the four become checkable predicates once written down, which means `bank_create` picks
them up automatically as part of the gate.

**Done when:** `feature-flow.md` and `testing-policy.md` are updated in one reference bank and the
hook is in settings; the other banks follow separately.

### A-03. Define the simplify review, or drop the predicate — **done**

The `Done` gate in `feature-flow.md` (line 352) requires that "the separate simplify review defined
by `testing-policy.md` is complete and its verdict is recorded". The word *simplify* does not appear
in `testing-policy.md` at all — a mandatory condition for closing a feature rests on a rule that does
not exist.

That is exactly what `unresolved-rule-reference` catches, and it finds it in **five banks** —
`feature-flow.md` spread across the projects together with the error.

Two ways out: define the rule in `testing-policy.md`, or drop the predicate from the gate. The second
is more honest if the review is de facto not happening.

**Done.** The section was ported from the one bank that had it into the two that did not; in the
other three the rule was already there and only the path needed fixing. `unresolved-rule-reference`
went to 0 everywhere.

*(Note: these edits were subsequently reverted at the owner's request. The finding and the fix stand;
A-04 is now closed, so applying them waits only on the owner saying which banks may be touched.)*

### A-04. Connect the server to a project and live with it — **done**

Ran 14 August – 5 September on four projects, not the one that was planned: `ebook_parser` and
`tasman/research` built from nothing, `readtolearn/frontend` an existing hand-written bank of 88
documents, and `idelo` a bank built backwards out of a released app.

Twenty-four findings, F-10 through F-33, none reachable by the test suite — each was a capability
that did not exist rather than a behaviour that was wrong. `bank_read` taking a list, a `body` on
`bank_create`, `bank_update_section`, `bank_discard`, `bank_edit`, `bank_set_status`,
`contentFile`/`bodyFile`, the read budget, two `bank_changed` fallbacks and the second dictionary
layer all come from it. One pattern underneath all of them: **the shell wins whenever the governed
call costs more than the ungoverned one.** Shell calls on one bank went 85 → 129 → 6 as the fixes
landed.

Five of the six numbers came back inside their thresholds. The sixth — whether `bank_route` lands on
what is needed — **could not be measured**, and that is itself the finding (F-13): on a bank small
enough to `cat` whole, routing competes with "already in context" and loses by default. It needs a
corpus too large to read.

The test also answered the objection it raised — that an 88-line `CLAUDE.md` might do the same job.
Pre-registered, two arms, same week: the server is what makes a bank hold (instructions cannot check
anything), and the paragraph is what makes the choice consistent (without it, an agent calling
`bank_edit` thirty times still made seven shell writes into its own bank).

Full write-up — [field-test.md](field-test.md); the session-by-session record —
[field-test-journal.md](field-test-journal.md).

### A-05. Verify the Stop hook actually loads — **done**

The logic had been checked across all four branches and the config schema came from the official
documentation, yet 0 hooks registered. That was read as an untrusted-directory problem. It was not:
two defects sat on a path nobody had ever executed.

The documented config was flat — `"Stop": [{ "type": "command", … }]` — where a wrapping object with
an inner `hooks` array is required; a flat entry registers nothing and reports no error. And the
script returned `hookSpecificOutput`, which `Stop` does not read at all: its decision fields go at the
top level, `continue` to keep the turn alive and `instruction` for what the agent is shown.

**Done.** With both fixed, a live session carries `hook_success`, `hookEvent: Stop`, `exitCode 0` and
the payload. The hook loads and fires.

A third defect only a live session could show: asking once per session meant asking at the *first*
stop, which is orientation rather than decision. It fired four minutes in, the agent correctly had
nothing to record, and the nine decisions taken an hour later were never asked about. The marker now
carries a fingerprint of the working tree and the time of the last ask, so the question returns once
the tree has moved and a cooldown has passed.

## B. Server code — all of it optional

Nothing here blocks use.

### B-01. A narrow slot for writing into an existing document — **done**

The original entry proposed `bank_append { path, section, content }` and left the shape undecided,
because the boundary in §8 of the spec says the server does not edit existing documents. The field
test decided it, and widened it.

Two measurements. `bank_init` seeds `product/context.md` and `engineering/testing-policy.md` as
drafts precisely so they will be filled, and `bank_create` refuses an occupied path — correctly — so
the two documents the server asks for were the two it could not write. And `bank_create` had no body
parameter at all: over one working session it produced nine governed creations while every word of
prose arrived through six shell writes into the same bank.

**Done.** `bank_create` takes a `body`. `bank_update_section` writes the body of one named level-two
section of an existing document, leaving the frontmatter, the title and every other section
untouched; a section that does not exist is refused with the list of the real ones rather than
appended, and templates and quarantined notes are refused outright. The frontmatter block is
preserved byte for byte rather than re-serialised, so a body edit cannot requote a string three
sections away.

The §8 boundary stands where it matters: nothing rewrites a document wholesale, and nothing edits a
document the server did not first refuse to overwrite.

**Second round, from the session after.** Section-level writing was the wrong grain for most edits.
Of eleven shell writes into the bank in one session, five changed a few lines inside a long section
and a sixth renamed a heading — replacing a whole section means resending everything unchanged around
the edit, so the agent used a string replace instead, every time. `bank_edit` is that string replace
with the guards: exact match, refused unless unique, count reported rather than the first occurrence
guessed at, frontmatter out of reach.

Three smaller things came from the same session. `bank_update_section` refused a quarantined note and
pointed at promotion, which was wrong — a draft under review is exactly what gets amended before the
decision — so it no longer refuses. `bank_promote` kept the captured body verbatim including relative
links that only resolved from `_inbox/`, and now rewrites the ones that resolve inside the bank,
reporting each as a warning. And a section index kept its "Empty. A first document of this kind is
registered here." line after documents had been registered in it; registration clears it.

### B-01a. `bank_append` — the original proposal, for the record

Right now automatic capture creates a separate document in `_inbox/`. But most of what gets captured
is a single line into an existing owner: a new gotcha in `engineering/gotchas.md`, a new term in
`domain/glossary.md`.

`bank_append { path, section, content }` — **appends one item to the end of a named section** of the
owning document, and cannot rewrite a single line. Noticeably lower risk than free editing, and it
covers most cases.

Undecided: this moves the "the server does not edit existing documents" boundary from §8 of the spec.

### B-02. Updating statuses from git automatically — **parked until November 2026**

`delivery_status: done` when a commit mentioning `FT-XXX` merges, a plan moved to `status: archived`
when it closes. Mechanical work with no judgement involved, but it needs a link to the PR.

The motive was a number: `archived` is set on about **4% of documents**, so de facto nobody performs
the archiving step even though `feature-flow.md` prescribes it. That number was measured **before
`bank_set_status` existed** — at the time archiving meant `sed -i`, which is exactly why it was not
being done. In the measured sessions afterwards `idelo` called `bank_set_status` four times
unprompted. The manual path started being used the moment it stopped costing more than the
ungoverned one, which is the same law every other finding in the field test obeys.

Against building it: automation here needs a link to the PR, which means pulling a forge into a
server that so far knows only git and the filesystem.

**Revisit on 5 November 2026**, and only on this measurement: run `--stats` across the banks and look
at the share of `archived`. If it is still under 5% with a governed transition available, the
transition is not the obstacle and automation earns its place. If it has moved, this stays closed.

### B-03. A code-versus-document drift detector — **done**

An anchor field in the header: "the fact `filter_thresholds` lives in `src/filter/config.ts`". The
server then surfaces suspicious pairs: the code was touched, the owning document has not been touched
in three months. It invents nothing, it only shows. On usefulness this was the most valuable item in
list B: the main failure of a knowledge base is not that something went unwritten — `bank_validate`
already catches that — but that what was written went quietly stale, which no rule inside the bank
can see, because nothing inside the bank knows the code exists.

**Done.** `anchors:` in the frontmatter, `bank_drift` reading it. One pass over `git log` for every
anchor and every anchored document at once, then two dates and the gap between them. Default
threshold 90 days, `scope` to narrow it.

Three decisions worth keeping straight:

- **It never guesses the pairing.** No path heuristics, no name matching, no reading the prose for
  file references. The annotation is the input; without it a document is invisible to the tool.
  A detector that guesses is a detector nobody trusts, and false drift is worse than no drift.
- **It reports `unanchored` next to `anchored`.** An unannotated bank would otherwise return a clean
  empty result, which reads as "no drift" and means "no data".
- **A missing anchor is always reported**, whatever the threshold. Code that was deleted or moved out
  from under a document is not a matter of degree.

### B-04. Syncing `dna/` between banks

The contract in `dna/frontmatter.md` matches byte for byte in only five of the fourteen banks that
have a `dna/` at all. The server could show the diff: "governance in this bank is three months newer
than in that one". Not migrate silently — show.

**Measured 6 September, and the framing in the paragraph above is wrong.** Byte-for-byte agreement
is the wrong test: two banks can differ by whitespace while permitting exactly the same things, and
agree in shape while permitting different ones. `parseContract` already extracts what actually
matters — the enums, whether `derived_from` is required, whether cycles are forbidden — so the
comparison should be of parsed contracts, and the answer should read "this bank allows four
`status` values, that one three" rather than a diff of table formatting.

What the real corpus shows: in a 378-document bank of the same lineage as the starter, 30 of 36
governance and flow files are still byte-identical and 6 have diverged — one of them
`dna/governance.md`. It lists 10 `doc_kind` values against the starter's 14, and 3 `doc_function`
against 9. **118 documents, 31% of that bank, carry values its own law does not permit**, and 91 of
those would be resolved by refreshing one file. See [architecture.md](architecture.md).

Roughly forty lines and one CLI flag: two bank roots in, the difference between their parsed
contracts out. Show, never migrate — the same rule `bank_drift` follows.

### B-05. Russian-language queries to `bank_route` — **done**

The banks are in English and ranking ran on English tokens, so a hand-typed Russian question returned
nothing at all — not a bad answer, an empty one.

**Done.** `src/lang.ts` carries a domain dictionary keyed by Russian stem prefixes, built from the
most frequent terms in `title` / `purpose` / `canonical_for` across the corpus. Both `bank_route` and
`bank_search` expand a query word into its equivalents in the other language and score the concept
once, so width cannot beat a literal match; a translation is discounted so the word actually typed
wins a tie. A verbal prefix is stripped only when what remains lands on a known stem, which is what
carries `задеплоить` to `deployment`.

The doubt in the original entry was about payoff, and the measurement settled it: on a real bank all
five Russian control questions now return the same first document as their English counterparts,
where before they returned nothing.

Two things came out of it that were not the point. `searchTokens` treated Cyrillic as a separator, so
any Russian text quoted in a document was silently absent from the search index — fixed. And field
scoring now works per concept rather than per token, which also removes double counting when a query
repeats a word in two forms.

**Addendum from the field test.** Two further defects, both invisible until the server met a project
outside the corpus it was built from.

The server's own `instructions`, the `bank_route` description and the `question` parameter all told
the agent to route in English. Written before the bilingual work and never revisited, they made an
obedient agent translate the question itself and hand English to a server built to do that
translation — the dictionary was dead code on the documented path, and the wording it was tuned
against never reached the ranker. Fixed: pass the question in the words it was asked in.

And the dictionary carries the subject matter it was drawn from. On a project about parsing books the
Russian side went silent on `корпус`, `книга`, `прогон` — an empty answer, while the same question in
English landed three ways out of three. Fixed with an optional `dna/vocabulary.md` the bank owner
writes: a two-column table of Russian stems and their English equivalents, re-read on every refresh.
On the field-test bank, four of five previously failing questions now return the right document
first; the fifth misses in English too, which makes it a ranking question rather than a language one.

### B-07. `bank_init` — creating a bank from nothing — **done**

The server could not stand a bank up on an empty directory, and [field-test.md](field-test.md) used
to begin by copying `dna/` and `flows/` out of someone else's bank. That was not a principle, it was
a hole.

The cause was circular: `bank_create` takes the contract from `dna/` and the templates from
`flows/templates/` — that is, from a bank that does not exist yet. The decision "the server enforces
the bank's rules, not its own" is right for validation, but it has nothing to do with seeding: the
starter set becomes the bank's property immediately, and the first commit can rewrite it.

What `bank_init { root, name }` had to do: lay out the 14-directory skeleton, drop in `dna/` (7
documents) and `flows/` with the templates, generate a `README.md` for every section and the root
index. After that the bank lives on its own.

The starter set was not to be invented: `dna/frontmatter.md` matches byte for byte across five banks
— that is already a de facto template, just not packaged.

Why this matters more than it looks: copying from an existing bank **would have spread into a sixth**
the `feature-flow.md` defect we are fixing in five. Seeding from a versioned set does not do that.

**Done.** The starter set is in `starter/`, the tool is `bank_init`, the CLI flag is `--init`. A fresh
bank was 50 files at the time and validated with zero findings — B-09 and B-10 later cut it to 24,
which still validates with zero findings. Along the way, three defects inherited from the
donor were found and fixed in the set: the broken edge to `developer-docs-commands-safety.md`, the
reference to a nonexistent `testing-policy.md`, and the `doc_kind`/`doc_function` tables in
governance lagging behind what the set itself uses (`process`, `prompt`, `epic`, `feature-support`
and `reference` were not declared).

### B-06. Graph traversal across the bank boundary — **done**

The "not multi-project" decision from §8 of the spec stays right for indexing and validation, but it
had a cost that only the field test made visible: **`bank_graph` stopped at the bank boundary**, and
in the nested banks of a monorepo the answer to "what breaks" was knowingly incomplete. Across the
banks I measured there are 35 such edges; `readtolearn` alone has 15, six of them pointing at the two
ADRs that decide what its server is.

**Done.** `resolveNeighbours` follows an external edge exactly one hop and reads the target's
frontmatter — title, `doc_kind`, `status`, `purpose`, `canonical_for`. Nothing else happens to it: it
is not indexed, not validated, not searchable, and its own edges are not walked. `bank_graph` returns
these under `neighbours` by default; `neighbours: false` skips the reads, and an empty `external`
costs nothing at all.

Two limits keep it from becoming a workspace crawler by accident: it will not read above three
directory levels from the bank root, and it stops after 25 targets. A path that resolves to nothing
comes back marked broken rather than external — which is a distinction the old output could not
draw, since both looked like a bare string.

### B-08. Let the bank declare its own layers — **done**

`layerOf()` read the first path segment against `BY_DIR`, a fixed table in `layer.ts`. It was the
only place where "the bank declares its own rules" was untrue, and it failed silently: a bank naming
a section `scenarios` instead of `use-cases` dropped to layer `other`, lost the 1.2 ranking weight,
and produced no finding, because validation never looked at layers.

**Done.** `dna/governance.md` now carries a `Directory | Layer | Weight` table, parsed the same way
the enum tables already are. Anything it declares is overlaid on the built-in map; a bank that
declares nothing behaves exactly as before, which matters because every existing bank is that bank.
The seeded table is deliberately identical in effect to the built-in one, so seeding it changes no
behaviour — there is a test asserting exactly that. A row naming a layer that does not exist is
skipped and reported as `unknown-layer-value` rather than throwing, so one bad row cannot void a
table.

One regression, caught by the acceptance suite rather than by me: the "why" question adjustment used
to *lower* knowledge from 1.5 to 1.2 while lifting decision to 1.6, and my first version raised both
with `Math.max`. It is now expressed as multipliers on whatever the bank declares — 4/3 and 0.8 —
which reproduce the old numbers exactly against the built-in weights and preserve the relationship
against declared ones.

### B-09. Stop seeding `epics`, `prd` and `prompts` — **done**

Measured across four banks — `ebook_parser`, `tasman/research`, `idelo`, `focusreminder` — these
three sections were index-only in **all four**, while four sections carried nearly everything.

**Done.** `bank_init` writes eight sections. The property that justified seeding the other three is
kept rather than dropped: `bank_create` builds a missing section, its index, and its entry in the
root index in the same operation, and says so in a warning. A dry run reports what it would create
without creating it. Nothing else changes — `layerOf` still knows the three, the templates still
ship, `bank_create` still accepts the kinds.

The root-index registration needed its own function. `registerLine` appends after the last markdown
link in a file, which in a root index is a row of the task-routing table at the bottom; a section
listed there would read as a task.

### B-10. Seed the templates by reference rather than by copy — **done, and narrower than proposed**

The item said to point at all of `flows/`. The first full test run said what that costs, and it was
more than the note anticipated: with the prose flows absent, `bank_route` could no longer answer a
question about the project's own procedure — it returned `features/README.md` for "how a feature
package moves through its gates" — and a person cloning the repository could not read the flow at
all. The 44 KB feature flow is not machinery; it is the procedure people follow.

So the line falls **inside** `flows/`:

```
flows/*.md            4 files,  58 KB  copied — read by people, ranked by routing
flows/templates/     24 files,  91 KB  pointed at — read by bank_create and nothing else
```

Templates are the right half to reference: routing skips them by construction
(`doc_function: template`), nobody reads one as prose, and none of the four measured banks had
customised one. A seeded bank is now **24 files instead of 50**.

Three things had to be built for it to be invisible:

- **`templateSource`** checks the bank first and falls through to the set the server ships, so a
  bank that never customised anything behaves exactly as if the files were there. A bank that *did*
  customise always wins.
- **`materializeFlows`** — `--materialize-flows`, `bank_materialize_flows` — copies the templates in
  when a project genuinely means to change one. It refuses to overwrite templates the bank already
  customised unless forced, and leaves the prose flows alone.
- **`shippedTemplateNames`** restores evidence that `unresolved-rule-reference` used to get from the
  bank. That rule excuses a bare mention of a template filename — the feature flow says a fact is
  recorded in `design.md`, which is prose about package shape, not a reference to one file — and it
  recognised those names by finding them in the bank. With the templates pointed at, the names are
  just as real but the file is not there, so the rule asks the server instead.

**What is not solved by this.** The drift measured in B-04 was worst in `dna/governance.md`, and
`dna/` is still copied — deliberately, because it is the law the bank is judged by and it has to
travel with the corpus. Volume is now handled; divergence of the law still needs the parsed-contract
diff in B-04, which after this is the most valuable unbuilt item in the list.

Full analysis — [architecture.md](architecture.md).

## C. Publishing

Target — mcpservers.org.

### C-01. Fill in the copyright holder and the package fields — **done**

`LICENSE` carries the holder; `package.json` has `author`, `repository.url`, `homepage` and a `bugs`
url. MIT stays: the whole MCP ecosystem is MIT or Apache-2.0, and anything stricter would make the
server awkward to put inside a closed project, which is the case it was written for.

### C-02. What the catalogue needs — **verified, not submitted**

A public repository, a README with wiring instructions, a LICENSE, a working `bin`. All four exist,
and `github.com/maxweb4u/mcp-memorybank` is public and current.

`npm pack` was checked the only way worth checking it — build the tarball, install it into an empty
project, and run the result. **Measured 5 September 2026, before B-09 and B-10**; the seed is 24
files now, and the tarball is correspondingly smaller. The check itself still stands.

```
files 61 · 112 kB packed · 380 kB unpacked
bin linked, starter templates resolved from the installed package,
--init seeded 50 files, --validate returned 0, the hook kept its executable bit
```

Two things that check turned up. **Source maps were being shipped without their sources** — 18 files
and a third of the unpacked size, all of it inert, since the maps point at a `src/` the tarball does
not contain. `files` now excludes them and keeps `sourceMap: true` for local work. And the archive
carries `starter/` as well as the four entries this item originally listed; that is correct rather
than a mistake, because `bank_init` copies the governance set out of it and the server is useless
without it.

**`main` is gone.** It pointed at `dist/server.js`, which exports one function — `startServer(bank)` —
taking a `Bank` the package root does not hand out. The only way to obtain one was a deep import into
`dist/`, which worked by accident of there being no `exports` map. A front door onto a room you cannot
use is worse than no front door, so the package is now what it is: a `bin`, not a library.

Emitting declarations instead was the alternative, and it builds clean (18 files, 80 KB). It was not
chosen for a reason that has nothing to do with size: `.d.ts` turns `GraphResult`, `DriftPair`,
`BankDoc` and the rest into public API, and renaming a field becomes a major version. Six tools
arrived in the last two weeks; the shapes are still moving. Adding `main` with declarations later is
ten minutes. Withdrawing a contract someone already depends on is not.

Three things were fixed on the way out. `prepublishOnly` runs the build and the tests, because
`dist/` is gitignored and nothing otherwise stopped `npm publish` from shipping a stale build or none
at all — silently, and unrecoverably after 72 hours. The README's install section leads with
`npx mcp-memorybank` and keeps the clone-and-build path below it, labelled as what it is: fine while
developing, wrong for anything you intend to keep. And the `CLAUDE.md` block in the README was still
the superseded five-tool version — the one the experiment beat — which is the version every new user
would have copied. It now carries the measured wording and the numbers behind it.

**Not done:** actually submitting to the catalogue, and the separate question of whether to publish
to npm at all. `npm whoami` returns 401 — there is no account logged in on this machine, which is a
step only its owner can take. The name `mcp-memorybank` is free. The argument for npm is not the catalogue; it is that four projects on this machine
wire the server with an absolute path to `dist/cli.js`, which breaks the moment the repository moves
and has never worked on any other machine.

### C-03. Remove the tie to the author's machine — **done**

`test/acceptance.test.ts` looked in an absolute path on my own machine by default. The tests
skipped correctly when the banks were absent, but that is exactly the problem: in a public
repository, and in CI, the whole acceptance tier skipped and the build went green having verified
nothing.

**Done.** The default is gone; the corpus suite reads `MEMORYBANK_TEST_ROOTS` and skips when it is
unset, but **fails** when it is set and the banks are missing — a typo in a path should not read as
a pass. `npm run test:corpus` runs that tier on its own.

The tier that has to stay green is now `test/acceptance-generated.test.ts`: it seeds a bank with the
current `bank_init`, fills it through `bank_create` only, and runs the same readiness criteria
against what this build actually produces. It needs nothing but a temp directory and git.

That change paid for itself immediately — see the `bank_changed` defect recorded under E4 in
[implementation-plan.md](implementation-plan.md), which no test against the real banks could have
found.

## D. Revisited "deliberately not doing this" decisions

All five were taken before implementation. Below is what the measurements showed, and the condition
under which each decision changes. The condition matters more than the verdict: without one, "no"
turns into "never".

| Decision | Verdict | Revisit when |
|---|---|---|
| `bank_owner` as a separate tool | **no**, and more confidently than before | `canonical_for` passes 70% in some bank, or conflicts pass a dozen. Today: 29% and a single conflict across every bank I measured |
| Embeddings | **no**, but the criterion changed | Not "a thousand documents" (the maximum is 368, the counter is useless) but misses on a control set: the right document regularly outside the top 3. Lexical works because `purpose` is filled on 1147 of 1149 — a signal an embedding would not have |
| Multi-root | **partly revisited** → B-06 | Indexing and validating several banks is not needed; traversing the graph across the boundary is |
| Editing existing documents | **no** for full editing | The real decision is B-01 (`bank_append`), and it needs making: the shape of automatic capture depends on it |
| A watcher | **no**, and there is no revisit condition | Measured on the largest bank: a cold build of 368 documents is 199 ms, an empty `refresh` before every call is 11–13 ms. A watcher would add state and an error class of "the index diverged from disk" to save ten milliseconds |

Of the five, two are worth touching: B-06 and the B-01 decision. Three are confirmed by numbers.
