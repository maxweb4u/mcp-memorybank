---
title: "memorybank-mcp — backlog"
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

Not included here: fixing the 321 validator findings across nineteen banks — that is separate work,
and it is on hold until the field test is done.

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

*(Note: these edits were subsequently reverted at the owner's request — nothing in the existing banks
changes until the field test is done. The finding and the fix stand; applying them is queued behind
A-04.)*

### A-04. Connect the server to a project and live with it

The server has never run in a live session. Until it has, we do not know whether `bank_route` lands
on what is actually needed in real work, as opposed to the control questions from the plan.

The test bed is chosen: `__my/modules/ebook_parser` — a new project where the bank has to be built
from nothing. Detailed plan and criteria — [field-test.md](field-test.md).

**Done when:** the six numbers from the "What counts as a result" section are collected over a day of
work.

### A-05. Verify the Stop hook actually loads

The logic of `hooks/capture-to-inbox.sh` has been checked across all four branches and the config
schema comes from the official documentation, but **Claude Code actually loading the hook is not
confirmed**: in the development sandbox, 0 hooks registered both from `.claude/settings.json` and via
`--settings` (which looks like an untrusted directory).

**Done when:** `/hooks` in an interactive session of a trusted project shows the hook, and one real
session actually leaves a note in `_inbox/`.

## B. Server code — all of it optional

Nothing here blocks use.

### B-01. `bank_append` — a narrow slot for appending

Right now automatic capture creates a separate document in `_inbox/`. But most of what gets captured
is a single line into an existing owner: a new gotcha in `engineering/gotchas.md`, a new term in
`domain/glossary.md`.

`bank_append { path, section, content }` — **appends one item to the end of a named section** of the
owning document, and cannot rewrite a single line. Noticeably lower risk than free editing, and it
covers most cases.

Undecided: this moves the "the server does not edit existing documents" boundary from §8 of the spec.

### B-02. Updating statuses from git automatically

`delivery_status: done` when a commit mentioning `FT-XXX` merges, a plan moved to `status: archived`
when it closes. Mechanical work with no judgement involved, but it needs a link to the PR.

The motive in numbers: `archived` is set on about **4% of documents** — de facto nobody performs
the archiving step, even though `feature-flow.md` prescribes it.

### B-03. A code-versus-document drift detector

An anchor field in the header: "the fact `filter_thresholds` lives in `src/filter/config.ts`". The
server then surfaces suspicious pairs: the code was touched, the owning document has not been touched
in three months.

It invents nothing, it only shows. On usefulness this is, in my view, the most valuable item in list
B: the main failure of a knowledge base is not that something went unwritten, but that what was
written went quietly stale. Requires the anchors to be annotated.

### B-04. Syncing `dna/` between banks

The contract in `dna/frontmatter.md` matches byte for byte in only five of the fourteen banks that
have a `dna/` at all. The server could show the diff: "governance in this bank is three months newer
than in that one". Not migrate silently — show.

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
bank is 50 files and validates with zero findings. Along the way, three defects inherited from the
donor were found and fixed in the set: the broken edge to `developer-docs-commands-safety.md`, the
reference to a nonexistent `testing-policy.md`, and the `doc_kind`/`doc_function` tables in
governance lagging behind what the set itself uses (`process`, `prompt`, `epic`, `feature-support`
and `reference` were not declared).

### B-06. Graph traversal across the bank boundary

The "not multi-project" decision from §8 of the spec stays right for indexing and validation, but it
has a cost that is only visible now: **`bank_graph` stops at the bank boundary**, and in the nested
banks of a monorepo the answer to "what breaks" is knowingly incomplete. Across the banks I measured there are 35 such edges, and one project alone has three nested banks
whose links to each other are real.

A full multi-root is not needed. The cheap intermediate step: resolve an external edge into the
neighbouring bank **for graph traversal only** — read the target file's header, without indexing or
validating it. One directory up, one read.

On usefulness this ranks above B-04 and B-05.

## C. Publishing

Target — mcpservers.org.

### C-01. Fill in the copyright holder and the package fields

- `LICENSE` — replace `FILL-IN-COPYRIGHT-HOLDER` with a name or handle.
- `package.json` — empty `author`, `repository.url`, `homepage`.

### C-02. What the catalogue needs

A public repository, a README with wiring instructions, a LICENSE, a working `bin`. The first three
exist. Check `npm pack` before submitting: the archive should contain only `dist`, `hooks`,
`README.md`, `LICENSE`.

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
