---
title: "An MCP server over memory_bank — implementation plan"
doc_kind: feature
doc_function: canonical
purpose: "Implementation plan for mcp-memorybank: the order of stages, what each contains, readiness criteria, and how the index and ranking are built."
derived_from:
  - specification.md
status: active
audience: humans_and_agents
---

# mcp-memorybank implementation plan

Derived from [specification.md](specification.md). The spec answers "what and why"; this plan
answers "in what order, and how do we know it works".

Every number below is a measurement across the real banks on my disk — nineteen of them, some
thousand documents, 8 MB — not an estimate. The banks themselves are private; what follows are the
numbers they produced.

## 0. Three decisions that change the spec

Before the plan, three forks the measurements settled. Everything else follows from them.

**Read the schema from the bank, do not hardcode it.** Every mature bank carries a
`dna/frontmatter.md` (the field contract) and a `dna/governance.md` (the SSoT rules). In five banks
`frontmatter.md` matches byte for byte. The server has to read the contract from there: `doc_kind`,
`doc_function` and `status` are open sets with a warning on an unknown value, not a `zod` enum. The
hard enum from the spec would have rejected 101 documents by `doc_kind` and 215 by `doc_function`.

**A document has a layer, and for ranking it matters more than the text.** The layer is derived from
the first directory in the path. In a young bank the delivery journal is 7% of the documents; in the
largest one measured it is 80%. Without a layer weight, `bank_route` on a large bank will
systematically land on closed features instead of knowledge.

**Cross-bank edges are normal, not an error.** 35 `derived_from` edges leave the bank root, spread
over two monorepos with nested banks — 17 in one, 15 across three banks of the other. The server
marks such an edge `external` and does not count it as broken.

## 1. How it works — the mechanics

### The index

At startup: walk `<root>/**/*.md`, parse frontmatter, build the derived structures. 8 MB across a
thousand-odd documents read in hundreds of milliseconds, so no watcher and no SQLite.

```ts
type Layer = 'dna' | 'knowledge' | 'decision' | 'delivery' | 'flow' | 'other'

interface Edge {
  raw: string           // as written in the document
  fit?: string          // the object form { path, fit } — 13 documents in the corpus
  resolved: string|null // resolved RELATIVE TO THE DOCUMENT'S DIRECTORY, not the bank root
  external: boolean     // points outside the root
}

interface BankDoc {
  path: string          // POSIX, relative to the bank root
  title: string         // frontmatter → first H1 → basename (74% of the corpus has a title)
  docKind: string       // a string, not an enum
  docFunction: string
  purpose: string
  status: string
  layer: Layer          // computed from the path
  derivedFrom: Edge[]
  canonicalFor: string[]
  mustNotDefine: string[]
  deliveryStatus?: string
  decisionStatus?: string
  sections: { title: string; line: number }[]  // H2, for section-scoped reads
  registeredIn: string[]
  mtime: number
  bytes: number
}
```

Directory-to-layer mapping:

| Directory | Layer | Meaning |
|---|---|---|
| `dna/` | `dna` | the bank's constitution |
| `product/ domain/ engineering/ ops/ system/ services/` | `knowledge` | lives for years |
| `adr/ use-cases/ prd/` | `decision` | decisions and scenarios |
| `features/ epics/ tasks/` | `delivery` | the delivery journal |
| `flows/ processes/ prompts/` | `flow` | how documents get produced |

**Invalidation.** On every call, `stat()` across all paths. Only files whose `mtime` changed are
re-indexed. Files appearing and disappearing are caught by comparing the path sets.

**Degraded mode.** If the bank has no `dna/` — 5 banks of the 19, all of them either a stub or the
outer shell of a monorepo — the server comes up with `bank_route`,
`bank_read` and `bank_search`, and `bank_validate` returns a single warning: contract not found.

### `bank_route` ranking

The question is tokenized, and every document is scored:

```
score = Σ (match × field weight) × layer multiplier × status multiplier
```

| Field | Weight | Why |
|---|---|---|
| `canonical_for` | 5 | a direct declaration of owning the fact |
| `purpose` | 3 | written by hand as a navigation hint |
| `title` | 2 | present on 74% of documents |
| H2 headings | 1 | catch the specific section |

| Multiplier | Value |
|---|---|
| `layer: knowledge` | ×1.5 |
| `layer: decision` | ×1.2 |
| `layer: dna`, `flow`, `other` | ×1.0 |
| `layer: delivery` | ×0.6 |
| `status: active` | ×1.0 |
| `status: draft` | ×0.7 |
| `status: archived` | ×0.2 |
| `delivery_status: done` or `cancelled` | ×0.5 |

**Hard filter:** `doc_function: template` never appears in results — that is 123 documents like
`ADR-ID.md` which would otherwise flood the top.

The document body plays no part in ranking — prose is what `bank_search` is for.

Every result carries a `why` field ("matched `canonical_for: filter_thresholds`"), otherwise the
agent cannot tell an exact hit from an accidental one.

## 2. Stages

The order follows dependencies, not convenience: validation comes before the graph because it fixes
the very broken edges the graph then walks.

### E0 — Index skeleton (~0.5 day)

The walk, frontmatter parsing (`gray-matter`), **both forms of `derived_from`** — a flat string and
an object `{ path, fit }` — resolution relative to the document's directory, layer computation,
reading the contract from `dna/`.

CLI: `mcp-memorybank --root <path> --stats` prints statistics without starting MCP.

**Readiness:** `--stats` gives 95 documents on the mid-sized bank and 368 on the largest, zero parse
errors anywhere, 15 edges with `fit` recognised as the object form.

### E1 — Reads (~1–2 days)

- `bank_route { question, limit?, docKind?, layer? }` → `{ path, title, purpose, docKind, layer, status, why }[]`
- `bank_read { path, section? }` → `{ path, frontmatter, content }`
- resource `memorybank://index`
- resource `memorybank://schema/frontmatter` — serves the bank's `dna/frontmatter.md` as is

**Readiness:** five control questions against a mid-sized bank and five against the largest.
The first control set, on a bank whose subject is a job-application agent:

| Question | Expected first result |
|---|---|
| where are the filter thresholds | `domain/rules.md` |
| why is collection done through an extension | `adr/ADR-...-collection-via-chrome-extension.md` |
| how do I deploy the backend | `ops/deployment.md` |
| frontmatter rules | `dna/frontmatter.md` |
| what to do when the session is blocked | `ops/account-safety.md` |

Plus: no result set contains a document with `doc_function: template`; on the delivery-heavy bank at
least 3 of the top 5 results are not from `features/`.

`bank_read` with `section` on a 192 KB task journal returns one section, not the whole file.

### E2 — Validation (~1–2 days)

`bank_validate { scope? }` → `{ severity, rule, path, message }[]` and the `memorybank://health`
resource.

Rules in order of measured productivity. The numbers are an actual run of the implemented validator
across all 19 banks (321 findings), not an estimate:

| Rule | Severity | Findings | In the spec? |
|---|---|---|---|
| `unknown-enum-value` (a value outside what `dna/` declares) | warning | **212** | no |
| `broken-derived-from` | error | **38** | yes |
| `invalid-frontmatter` (YAML does not parse) | error | **22** | no |
| `cycle-in-derived-from` (governance: cycles forbidden) | error | **15** | no |
| `unregistered-doc` | warning | **13** | yes |
| `unresolved-rule-reference` (a document cites a rule by a path that does not resolve) | warning | **13** | no |
| `no-contract` (the bank has no `dna/`) | warning | **6** | no |
| `ssot-conflict` | error | **1** | yes |
| `missing-derived-from` (governance: every `active` non-root document must have one) | error | **1** | no |
| `must-not-define-violated` | error | **0** | yes |
| `dangling-index-entry` | error | **0** (out of 1670 links) | yes |
| `stale-draft` | — | dropped | yes |

Corrections to earlier estimates, produced by the implementation:

- `broken-derived-from` — 38, not 43. In the draft measurement the object form
  `- path: ... / fit: ...` resolved as the path `path: ../x.md` and produced five false positives.
- `missing-derived-from` — 1, not 39. The rule applies only where governance declares it ("Every
  `active` non-root document must define `derived_from`" — 7 banks out of 19). One bank has 37
  documents with no `derived_from`, but its governance does not require one, so that is not a
  violation.
- `cycle-in-derived-from` — 15 unique cycles. The typical shape: a section index derives from its own
  documents, and they derive from the index (`ops/README.md` ↔ `ops/config.md`).
- `dangling-rule-reference` from the earlier plan was replaced with `unresolved-rule-reference`.
  Checking by words produced false positives and missed the real defect; checking path resolution is
  exact and suggests the correct path.

**Two of those counts were inflated by the validator, not by the banks.** Recorded here as measured,
and corrected later once the causes were found:

- `broken-derived-from` 38 — of which 35 were the external edges above, counted as broken before the
  `external` outcome existed. What remains is a handful.
- `invalid-frontmatter` 22 — `gray-matter` memoises by input text and, after throwing, returns a
  cached object whose entire frontmatter sits inside `content`. Documents parsed after a failing one
  looked broken too. Once parsing went through a single call site, the count fell to exactly the
  number of documents with an unquoted colon in `purpose`.

The lesson is not about the numbers. A validator's own defects read as findings, and nothing in the
output distinguishes them: both counts looked entirely plausible for months.

**Rules split into structural and contract rules.** Structural ones (broken edges, invalid YAML, a
second owner, orphans, unresolvable references) work even in a bank with no `dna/`. Contract ones
(`missing-derived-from`, cycles, unknown values) apply only where the bank declared them itself — the
server enforces the bank's rules, not its own.

**Readiness:** a run across the banks finds both defects known in advance — the broken
`derived_from` on `engineering/developer-docs-commands-safety.md` in `flows/feature-flow.md`, and the
`Done` gate citing `testing-policy.md` by a path that does not resolve from `flows/` — and gives
**zero** false positives on the 35 external edges, covered by a test against the monorepo that
carries 17 of them.

### E3 — Graph (~1 day) — **done**

`bank_graph { path, direction: 'up'|'down'|'both', depth?, limit? }` → `{ nodes, edges, external, broken, byLayer, truncated }`.

Breadth-first. The three edge outcomes are separated: an internal one becomes a node, an external one
goes to `external`, a broken one to `broken`. `fit` is carried on the edge. A node ceiling (60 by
default) keeps a hub document from dragging in the whole bank, and cycles are safe — a visited node
is not expanded twice.

**Verified:** `down` on a `domain/rules.md` returns exactly the 8 documents that rest on the
thresholds — 3 knowledge, 2 decisions, 3 features. `up` on a feature brief in the largest bank
returns 9 nodes and preserves all 4 `fit` values. `down` on `dna/governance.md` hits the ceiling and
honestly sets `truncated: true`. On a bank of 49 documents with no edges at all it returns a single
node without error. In a monorepo, `up` on a document of a nested bank shows the edge under
`external`, not `broken`.

### E4 — Search and delta (~1 day) — **done**

- `bank_search { query, docKind?, layer?, status?, limit? }` → `{ path, title, excerpt, line, score, hits }[]`
- `bank_changed { since }` → `{ since, mode, repo?, changes, note? }`

An in-memory inverted index, synced by `mtime` along with the main one. On the largest bank — 368
documents — 15,648 terms and 210 ms for a full build; after that only what changed.

The index stores both a compound token and its parts, but the **query** weights a whole token ten
times its parts. Without that, a query like `FT-042` would lift `features/README.md` — a registry
with seventy `FT-*` lines — above the feature itself.

`bank_changed` distinguishes two modes. A git ref gives a real delta: additions, modifications,
deletions, renames, plus untracked files. An ISO date falls back to `mtime` and says honestly that it
cannot see deletions and cannot tell a new document from a modified one. Every bank measured lives
inside a git repository, so git is the primary mode.

**Verified:** searching a feature identifier puts that feature's own documents above the registry
that lists it; `REQ-01` finds only the delivery layer, with the exact line and its number;
`bank_changed HEAD~5` returns 10 changes with their types; a nonexistent ref gives a clear error
rather than an empty list.

**Defect found later, by the generated acceptance suite.** `bank_changed` subtracted the repository
root reported by git from the bank root as given. Those differ whenever the bank is reached through
a symlink — on macOS every path under `$TMPDIR` is one — and every file then looked like it sat
outside the bank. The delta came back **empty rather than failing**, which reads as "nothing
changed". Both ends are now resolved before subtracting. No test against the real banks could have
caught this: their paths are not symlinked. It took running the criteria against a bank the build
generates in a temp directory.

### E5 — Writes (~2 days) — **done**

`bank_create { docKind, path, title, purpose, derivedFrom?, canonicalFor?, mustNotDefine?, status?, extra?, inbox?, dryRun? }`
→ `{ path, created, frontmatter, template, registeredIn, warnings, preview }`

Templates in these banks are wrappers: the document to instantiate sits inside them as two fenced
blocks under `## Instantiated Frontmatter` and `## Instantiated Body` (17 of the 24
templates; the rest are flat and get copied whole). The server unwraps the embedded contract,
substitutes the title into the H1, fills the `date` placeholder and carries over `must_not_define`,
which the template ships as governance — but discards the template's `derived_from` and
`canonical_for`, which are placeholders by construction.

Template selection goes by `template_for` and by the filename in `template_target_path`: that is what
distinguishes `brief.md` from `design.md` within one `doc_kind`.

Refusals: a taken path, an unresolvable `derived_from`, a taken `canonical_for`, a path outside the
bank, a non-`.md` path, an empty `purpose`. An unknown `doc_kind` or `status` is a warning, not a
refusal: the contract is open.

Index registration copies the shape of the last entry — table row, bullet, or numbered item.
`dryRun` shows the result and writes nothing.

`inbox: true` is the quarantine: `_inbox/`, `status: draft`, no template and no registration. The
`inbox` layer is ranked with a 0.2 multiplier and is exempt from `unregistered-doc`.

One side effect worth naming: a document created through `bank_create` physically cannot acquire an
`invalid-frontmatter` defect — serialization quotes a value containing a colon. That is exactly the
error class found in 22 documents of the corpus.

**Verified:** on a copy of a real bank, an ADR is created from `flows/templates/adr/ADR-ID.md`,
registered as a table row in `adr/README.md` in the existing shape, and `bank_validate` afterwards
returns exactly as many findings as before — 21. Writing to `_inbox` adds none either.

### E6 — The quarantine and emptying it — **done**

Beyond the plan, driven by the "writes without being told" priority.

`bank_promote { path, to, docKind?, title?, purpose?, derivedFrom?, canonicalFor?, status?, dryRun? }`
moves a note from `_inbox/` into a canonical layer: the body is kept as written, the frontmatter is
rebuilt against the contract, the destination template contributes only its governance fields, the
document is registered in the index, and the source is deleted. Gates are shared with `bank_create`
plus two of its own — you can only promote out of `_inbox/`, and only outward. Status after promotion
is `active`, so the `derived_from` requirement is no longer softened to a warning here.

The `memorybank://inbox` resource and the `review-inbox` prompt give a weekly review: for each note —
promote, fold into an existing owner by hand, or throw away.

The quarantine is filled by the `hooks/capture-to-inbox.sh` Stop hook. It stays quiet until all four
conditions hold: not a recursion (`stop_hook_active`), the project has a `memory_bank/`, the working
tree is dirty, the session marker is not set yet. In other words, an "asked and left" session
produces no notes at all.

**Verified:** the full circuit on a copy of a real bank — capture into `_inbox`, `--list-inbox`,
promotion into `engineering/`, the entry in `engineering/README.md`, the document found by routing,
`bank_validate` still at 21 findings. The hook's logic is verified across all four branches. Not
verified: whether Claude Code actually loads the hook — in this session's sandbox, Stop hooks
registered neither from `.claude/settings.json` nor via `--settings`.

## 3. Not in v1

- **`bank_owner` as a separate tool.** A single SSoT conflict across every bank measured; `canonical_for` is
  filled on 29% and completely absent in 8 banks. The `ssot-conflict` rule stays in validation, but a
  separate tool does not pay for itself. Revisit when the annotation grows.
- **Embeddings.** The threshold is a thousand documents *in one bank*; the current maximum is 368.
- **Multi-root.** One process, one root. External edges are simply marked.
- **Editing existing documents.** The server owns creation and registration only.
- **A watcher.** `stat()` is cheaper.

Net: seven tools instead of eight, four of them in the first two stages.

## 4. How the server fits into the working process

Three touch points, all in the existing `flows/feature-flow.md`, with no new methodology:

| Where | What it replaces |
|---|---|
| Start of a task | `bank_route` instead of the `README.md` → section index → document chain |
| The gate before execution | `bank_graph down` on the affected owners — "what breaks" |
| The `→ Done` gate | `bank_validate` in the list of required checks |

## 5. Risks

| Risk | How it shows up | Mitigation |
|---|---|---|
| Ranking skew on large banks | in the largest bank, 80% of documents are a delivery journal | layer multipliers, checked by the E1 control questions |
| Half the banks have no governance layer | 5 banks with no `dna/`, another 5 with a truncated one | degraded mode, validation switched off explicitly |
| The `dna/` contract diverges between banks | byte-identical in only 5 of 14 | the contract is read from the bank's own copy, not from a reference one |
| Scope creep into "the server does everything" | eight tools already in the spec | the "not in v1" section — a boundary on paper |

## 6. Summary schedule

| Stage | Days | Cumulative | What appears | Status |
|---|---|---|---|---|
| E0 | 0.5 | 0.5 | the index, `--stats` | **done** |
| E1 | 1.5 | 2 | navigation without reading READMEs | **done** |
| E2 | 1.5 | 3.5 | 321 real findings across 19 banks | **done** |
| E3 | 1 | 4.5 | an answer to "what breaks" | **done** |
| E4 | 1 | 5.5 | search and a delta between sessions | **done** |
| E5 | 2 | 7.5 | documents created with no manual steps | **done** |

E1 and E2 are self-sufficient: if it goes no further, navigation and the validator already pay for
the work.
