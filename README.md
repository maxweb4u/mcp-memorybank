# memorybank-mcp

An MCP server over `memory_bank`: routing, section-scoped reads, governance validation.

Spec — [specification.md](specification.md), plan — [implementation-plan.md](implementation-plan.md).

Everything in the plan is done: **E0** index, **E1** reads, **E2** validation, **E3** graph,
**E4** search and delta, **E5** writes.

## Running it

```bash
npm install && npm run build
```

As an MCP server (stdio):

```bash
node dist/cli.js --root /path/to/project/memory_bank
```

Wiring it into a project:

```json
{
  "mcpServers": {
    "memorybank": {
      "command": "node",
      "args": ["/absolute/path/dist/cli.js", "--root", "/absolute/path/memory_bank"]
    }
  }
}
```

## Debugging from the terminal

```bash
node dist/cli.js --root <bank> --stats
node dist/cli.js --root <bank> --route "filter thresholds" --limit 5
node dist/cli.js --root <bank> --read domain/rules.md --section Thresholds
node dist/cli.js --root <bank> --validate --summary
node dist/cli.js --root <bank> --validate --rule broken-derived-from
node dist/cli.js --root <bank> --graph domain/rules.md --direction down --depth 1
node dist/cli.js --root <bank> --search "FT-SMD-843" --limit 5
node dist/cli.js --root <bank> --changed HEAD~5
node dist/cli.js --root <bank> --create adr/ADR-...-name.md --kind adr --title "..." --purpose "..." --derived ../engineering/architecture.md --dry-run
node dist/cli.js --root <new-path> --init "Project Name" --dry-run
node dist/cli.js --root <bank> --list-inbox
node dist/cli.js --root <bank> --promote _inbox/note.md --to engineering/thing.md --derived ../dna/principles.md --dry-run
```

## What is there

| Tool | What it does |
|---|---|
| `bank_route` | "what should I read about this" — ranks on `canonical_for`, `purpose`, `title`, section headings |
| `bank_read` | a whole document, or one second-level section |
| `bank_validate` | checks the bank against the rules the bank itself declares in `dna/` |
| `bank_graph` | walks `derived_from`: `down` — who depends on this (blast radius), `up` — what it is built on |
| `bank_search` | full-text search over document bodies — identifiers, names, literals |
| `bank_changed` | what changed since a git ref or an ISO date |
| `bank_init` | creates a bank from nothing: skeleton, `dna/`, templates, section indexes |
| `bank_create` | creates a document from the bank's own template and registers it in the index, with gates and `_inbox` |
| `bank_promote` | moves a note out of `_inbox/` into a canonical layer, registering it and deleting the source |

| Resource | Contents |
|---|---|
| `memorybank://index` | annotated index of every document (templates excluded) |
| `memorybank://schema/frontmatter` | the bank's own `dna/frontmatter.md`, verbatim |
| `memorybank://health` | a fresh `bank_validate` run, grouped by rule |
| `memorybank://inbox` | what sits in quarantine, oldest first |

Prompts: `route-then-read` (route first, read second), `check-before-commit` (run validation and
explain every finding), `record-adr` (assemble a decision into an ADR), `review-inbox` (work through
the quarantine).

### Creating a bank

```bash
node dist/cli.js --root <new-path> --init "Project Name"
```

Lays out 14 directories, drops in `dna/` (7 governance documents) and `flows/` with 23 templates,
generates a `README.md` for every section plus the root index, and seeds two drafts —
`product/context.md` and `engineering/testing-policy.md` — which the templates and the feature
closure gate both point at.

The starter set lives in `starter/` and belongs to the bank the moment it is copied: rewrite it
however you like, the server does not keep imposing it.

**A freshly created bank validates with zero findings** — which is the whole point of `bank_init`
rather than copying someone else's bank: a copy would bring that bank's defects along with it.

### Writing

`bank_create` takes the template from the bank's own `flows/templates/`. Templates there are
wrappers: the document to instantiate sits inside them as two blocks under
`## Instantiated Frontmatter` and `## Instantiated Body`. The server unwraps exactly those,
substitutes the title, fills the date placeholder, and carries over `must_not_define`, which the
template ships as governance.

It refuses to write if the path is taken, if `derived_from` does not resolve, if `canonical_for` is
already owned, if the path leaves the bank root, or if it does not end in `.md`. An unknown
`doc_kind` is a warning, not a refusal. `dryRun` shows the result and writes nothing.

Index registration copies the shape of the last entry — table row, bullet, or numbered item — so a
hand-written file does not get reformatted.

`inbox: true` puts the document in `_inbox/` with `status: draft`, with no template and no
registration. The `inbox` layer is ranked with a 0.2 multiplier and is exempt from the
`unregistered-doc` rule: it is a quarantine for automatic capture, reviewed later.

`bank_promote` empties the quarantine: the note body is kept as written, the frontmatter is rebuilt
against the contract, the destination template contributes only its governance fields, the document
is registered in the index, and the source is deleted. Same gates as `bank_create`, plus two of its
own: you can only promote out of `_inbox/`, and only outward. Status after promotion is `active`, so
the governance requirement about `derived_from` is no longer relaxed here.

The quarantine is filled by a Stop hook — see [hooks/README.md](hooks/README.md).

### Queries in two languages

The bank is written in English — that is a governance rule and nothing here relaxes it. The
*question* is a different matter: typed by hand it is often not English, and lexical ranking over
English fields cannot answer it at all. "где пороги фильтрации" tokenizes into three words that
appear in no `purpose` or `canonical_for`, so the result is empty rather than merely wrong.

`bank_route` and `bank_search` therefore treat a query word as a concept rather than a string. Each
word carries its equivalents in the other language, drawn from a domain dictionary built from the
most frequent terms in `title` / `purpose` / `canonical_for` across the corpus. Three things follow:

- **A concept scores once.** Three English equivalents matching one `purpose` is one hit, not three,
  so an expanded query cannot outrank a literal one by sheer width.
- **The word actually typed wins a tie.** A translation is discounted, which only matters in a bank
  that mixes languages — there the literal match ranks first.
- **Russian inflects, so a dictionary entry is a stem prefix, not a word.** `порог` covers пороги /
  порогов / порогам; a verbal prefix is stripped only when what remains lands on a known stem, which
  is what lets `задеплоить` reach `deployment`.

Measured on a real bank, the five Russian control questions return the same first document as their
English counterparts. Search is symmetric: Cyrillic is a word character in the index, so a document
quoting a Russian source is searchable, and a Russian query reaches English prose through the same
dictionary.

An unknown word is left exactly as typed — identifiers like `FT-SMD-843` and `filter_thresholds`
never go near the dictionary.

### Validation rules

A run across 19 real banks — 321 findings.

| Rule | Severity | Findings |
|---|---|---|
| `unknown-enum-value` | warning | 212 |
| `broken-derived-from` | error | 38 |
| `invalid-frontmatter` | error | 22 |
| `cycle-in-derived-from` | error | 15 |
| `unregistered-doc` | warning | 13 |
| `unresolved-rule-reference` | warning | 13 |
| `no-contract` | warning | 6 |
| `ssot-conflict` | error | 1 |
| `missing-derived-from` | error | 1 |
| `must-not-define-violated` | error | 0 |
| `dangling-index-entry` | error | 0 |

Structural rules work in any bank. Contract rules (`missing-derived-from`, cycles,
`unknown-enum-value`) apply only where the bank declared them itself in `dna/governance.md` — the
server enforces the bank's rules, not its own.

## Decisions where the implementation departs from the spec

- **The schema is read from the bank.** `doc_kind` / `doc_function` / `status` are open sets, read
  out of `dna/frontmatter.md` and `dna/governance.md`. A hard enum would have rejected 101 documents
  out of 1153.
- **A document has a layer** (`dna` / `knowledge` / `decision` / `delivery` / `flow`), derived from
  its path and weighted in ranking. Without it, routing misses on a bank where 80% of the documents
  are a delivery journal.
- **`derived_from` resolves relative to the document** and supports both forms — a string and
  `{ path, fit }`.
- **A reference that leaves the root** is marked `external` rather than counted as broken: in a
  monorepo, banks nest.
- **A document with invalid YAML does not fall out of the index.** 22 documents across the real
  banks have an unquoted colon in `purpose`; their metadata is recovered line by line and the error
  is kept for `bank_validate` to report.
- **Templates are excluded** from `bank_route` results and from `memorybank://index`.
- **`bank_route` and `bank_search` answer different questions.** The first ranks on the hand-written
  header ("which document is about this"), the second searches the prose ("where does this string
  appear"). In search, a whole token weighs ten times its own fragments: otherwise the query
  `FT-SMD-843` would lift the `features/README.md` registry, with its seventy `FT-SMD-*` lines,
  above the feature itself.
- **A query is bilingual, the bank is not.** Ranking expands a query word into its equivalents in
  the other language and scores the concept once. Documents stay English; only the question may not
  be.
- **Frontmatter is parsed in exactly one place.** `gray-matter` with no options memoises by input
  text, and after throwing it returns a cached object whose entire frontmatter sits inside
  `content` — silently. Options are always passed, and parsing goes through a single
  `splitFrontmatter`.
- **The graph separates three edge outcomes:** internal (a node), external (`external` — a nested
  bank), broken (`broken`). Breadth-first with a node ceiling, so a hub document does not drag in the
  whole bank and a cycle does not loop.

## Tests

```bash
npm test
```

194 tests in three tiers, which exist for different reasons.

**Generated** — `test/acceptance-generated.test.ts` seeds a bank with the current `bank_init`, fills
it through `bank_create` only, and then runs the plan's readiness criteria against that: routing in
both languages, the graph over edges the server itself wrote, search, the git delta, and every
refusal gate. It needs nothing but a temp directory and git, so this is the tier that has to stay
green. It also carries the strongest claim in the design — **a bank built entirely through the
server validates with zero findings, and still does after three refused writes.**

**Fixture** — `test/fixture-bank/` is a bank with deliberate violations: a broken edge, a second
owner of a fact, an orphan, broken YAML, a reference outside the root. It stays hand-written on
purpose, because `bank_create` cannot produce any of them.

**Corpus** — `test/acceptance.test.ts` measures the 19 real banks that drove every design decision.
Those live outside the repository, so the suite is opt-in:

```bash
MEMORYBANK_TEST_ROOTS=/path/to/projects npm run test:corpus
```

With the variable unset it skips. With it set but the banks missing it fails rather than skipping —
a typo in a path should not read as a pass.
