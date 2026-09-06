---
title: "An MCP server over memory_bank"
doc_kind: specification
doc_function: canonical
purpose: "Specification of an MCP server that gives an agent navigation, governance checking, and writes into the memory_bank knowledge base."
status: draft
audience: humans_and_agents
---

# An MCP server over memory_bank

Specification. No code.

## 1. The problem

Four projects of mine use one and the same
knowledge base structure: governed documents with YAML frontmatter, SSoT ("every fact has
exactly one home"), navigation through indexes, ADRs, feature packages.

The system works, but it rests on discipline. Which gives three problems, and none of
them is about convenience — they are about the knowledge base gradually ceasing to be
true.

**Navigation costs context.** To answer a question, the agent walks
`memory_bank/README.md` → section index → document. Three full reads, the first two of
which exist only to learn a path. The largest of those banks is already around 40 documents;
it gets worse from there.

**Nobody checks governance.** The `canonical_for`, `must_not_define` and `derived_from`
fields are a contract, but compliance is checked only by the attentiveness of a human or
an agent. Two documents can both declare themselves owners of the same fact, and nobody
finds out until they diverge.

**Writes do not reach the index.** A new document has to be created from a template, get
its frontmatter, and be registered in the right README. Skipping the last step breaks
nothing immediately — the document simply becomes invisible to navigation.

## 2. Why an MCP server rather than plain file reads

The objection is fair: the agent can already read files and grep. The server is justified
by exactly three things file access does not give.

**Routing without reading.** `bank_route` returns a list of paths with their frontmatter
`purpose` fields — that is, an answer to "what should I read" for the price of one call
instead of three reads. `purpose` fields are written by hand precisely as navigation
hints, and that is a better signal than full-text search over prose.

**Checks the filesystem cannot express.** `canonical_for` overlap between documents,
broken `derived_from`, documents registered in no index, `must_not_define` violations —
all of these are properties of the graph, not of a single file. You cannot see them by
reading one document at a time.

**Writes that land correctly.** `bank_create` sets frontmatter per the schema, puts the
document in the right directory, and registers it in the index in one operation. Skipping
a step becomes impossible.

Anything outside those three the server should not do — an ordinary file read stays an
ordinary file read.

## 3. Data model

The index is built at startup by walking `memory_bank/**/*.md` and kept in memory.

```ts
type DocKind =
  | 'governance' | 'project' | 'product' | 'domain' | 'engineering'
  | 'adr' | 'feature' | 'epic' | 'process' | 'use-case' | 'prd' | 'prompt'

type DocFunction = 'canonical' | 'index' | 'reference'

interface BankDoc {
  path: string              // relative to the memory_bank root
  title: string
  docKind: DocKind
  docFunction: DocFunction
  purpose: string           // the primary routing signal
  status: 'draft' | 'active' | 'archived'
  derivedFrom: Array<{ path: string; fit?: string }>
  canonicalFor: string[]    // keys of the facts this document owns
  mustNotDefine: string[]
  deliveryStatus?: 'planned' | 'in_progress' | 'done' | 'cancelled'
  decisionStatus?: 'proposed' | 'accepted' | 'superseded' | 'rejected'
  sections: string[]        // second-level headings, for section-scoped reads
  registeredIn: string[]    // indexes that link to it
  mtime: number
  bytes: number
}
```

Derived structures:

- `ownerByKey: Map<string, string[]>` — from `canonicalFor`. More than one path per key
  means an SSoT violation.
- `edges` — the `derived_from` graph, for walking up and down.
- `orphans` — documents absent from every `registeredIn`.

Invalidation is by `mtime` on each call; a full re-walk only if at least one file
changed. On a few hundred documents that is single-digit milliseconds, so no watcher is
needed.

## 4. Tools

Eight of them. Every parameter is validated with `zod`, and the schema is exposed to MCP
as JSON Schema.

### `bank_route`

The primary tool. Answers "what should I read about this".

```ts
{ question: string, limit?: number /* =5 */, docKind?: DocKind }
→ { path, title, purpose, docKind, status, why }[]
```

Ranking is by match against `purpose`, `title`, `canonicalFor` and section headings, with
weights in that order. The document body does not enter ranking: `purpose` was written as
a navigation hint, prose was not. The `why` field explains why a document made the list;
without it the agent cannot tell an exact hit from an accidental one.

### `bank_search`

Full-text search, for when routing is not enough.

```ts
{ query: string, docKind?: DocKind, status?: string, limit?: number /* =10 */ }
→ { path, title, excerpt, line }[]
```

### `bank_read`

```ts
{ path: string, section?: string }
→ { path, frontmatter, content }
```

`section` returns one second-level heading with its body. On large canonical documents
that is the difference between 200 lines and 20.

### `bank_owner`

The SSoT query: who owns a fact.

```ts
{ key: string }   // e.g. 'filter_thresholds'
→ { key, owners: string[], conflict: boolean }
```

`conflict: true` when there is more than one owner — that is a defect in the base, not a
valid answer.

### `bank_graph`

```ts
{ path: string, direction: 'up' | 'down' | 'both', depth?: number /* =2 */, neighbours?: boolean /* =true */ }
→ { nodes: { path, title, docKind }[], edges: { from, to, fit? }[],
    external: { from, raw }[], neighbours: { from, raw, file, title?, docKind?, canonicalFor? }[] }
```

`up` — what the document rests on, `down` — what breaks if it changes. The second is the
main scenario: "I am changing this threshold, what else do I have to touch".

Edges that leave the bank root are followed one hop, header only — §8's "not multi-project" decision
holds for indexing and validation, but a monorepo puts real decisions on the other side of the wall,
and reporting the edge as an opaque string made the blast radius wrong rather than incomplete.

### `bank_drift`

```ts
{ thresholdDays?: number /* =90 */, scope?: string }
→ { mode: 'git' | 'none', anchored: number, unanchored: number,
    drifted: { path, anchor, docTouched, codeTouched, aheadDays }[],
    missing: { path, anchor }[], note?: string }
```

The only tool here that reads outside the bank, and the only one whose input the bank does not
already carry: a document declares `anchors:` — repository-relative code paths — and the server
compares commit dates. It never infers the pairing from content, because a drift detector that
guesses is one nobody trusts, and it never edits: whether a gap matters is not a judgement a
timestamp can make. `unanchored` is reported alongside, since an unannotated bank is invisible to it
and should say so rather than return a clean-looking empty result.

### `bank_validate`

```ts
{ scope?: string /* subdirectory */ }
→ { severity: 'error' | 'warning', rule: string, path: string, message: string }[]
```

Rules:

| Rule | Severity | What it catches |
|---|---|---|
| `frontmatter-schema` | error | `status` missing, or a field off-schema |
| `ssot-conflict` | error | one `canonical_for` key claimed by several documents |
| `broken-derived-from` | error | `derived_from` points at a path that does not exist |
| `must-not-define-violated` | error | a document defines a key it forbade itself |
| `unregistered-doc` | warning | the document is mentioned in no index |
| `stale-draft` | warning | `status: draft` older than N days |
| `orphan-adr` | warning | an ADR no document refers to |
| `dangling-index-entry` | error | an index links to a file that does not exist |

### `bank_create`

```ts
{ docKind: DocKind, path: string, title: string, purpose: string,
  derivedFrom?: string[], canonicalFor?: string[], extra?: Record<string, unknown> }
→ { path, registeredIn, frontmatter }
```

Takes the template for `docKind`, sets the frontmatter, writes the file, adds a line to
the section index. Refuses to write if the path is taken, if `canonicalFor` overlaps an
existing owner, or if `derivedFrom` points into nothing.

### `bank_changed`

```ts
{ since: string }   // ISO date or git ref
→ { path, title, changeKind: 'added' | 'modified' | 'deleted' }[]
```

For carrying state between sessions: what changed since last time.

## 5. Resources

| URI | Contents |
|---|---|
| `memorybank://index` | Annotated index: path, `purpose`, `doc_kind`, `status` for every document |
| `memorybank://doc/{path}` | A whole document |
| `memorybank://schema/frontmatter` | The frontmatter contract — so the agent does not guess at fields |
| `memorybank://health` | A fresh `bank_validate` run |

`memorybank://index` is what the agent reads first in a session, instead of `README.md`.

## 6. Prompts

| Name | Purpose |
|---|---|
| `route-then-read` | `bank_route` first, then `bank_read` on the top results only. Discipline against reading everything |
| `record-adr` | Assemble an ADR: context, drivers, options table, decision, consequences. The format has settled across four projects |
| `check-before-commit` | Run `bank_validate` and explain every error |

## 7. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, Node 22 | The official SDK, and it is what the projects around it already use |
| SDK | `@modelcontextprotocol/sdk` | Official |
| Transport | stdio | The server is local, one per project. HTTP would add authentication for no gain |
| Frontmatter | `gray-matter` | — |
| Validation | `zod` | Gives both runtime checking and types, and it is already the house choice |
| Search | An in-memory inverted index of our own | On hundreds of documents, SQLite FTS5 is a dependency for nothing |
| Tests | `vitest` plus a fixture bank with deliberate violations | Validation rules without negative tests are meaningless |

Running it:

```bash
mcp-memorybank --root /path/to/project/memory_bank
```

One process per project. Client configuration is an ordinary `mcpServers` entry.

## 8. What the server does not do

Written down so that future work does not drift in here.

- **It does not edit existing documents.** Editing content is the agent's job with its
  ordinary tools. The server owns creation and registration only.
- **It keeps no state between sessions.** The index is derived from the files and can be
  rebuilt from scratch at any moment.
- **No embeddings.** The corpus is small, and `purpose` is a hand-written signal of
  higher quality than an embedding of prose. Revisit if a bank passes a thousand
  documents and `bank_route` starts missing.
- **Not multi-project.** One root per process. Cross-project search is a separate problem
  with different requirements.
- **It does not replace git.** History, authorship and rollback stay with git.

## 9. Stages

| Stage | Contents | Readiness signal |
|---|---|---|
| **E1** | Index, `bank_route`, `bank_read`, the `memorybank://index` resource | The agent answers a question about a real bank without reading `README.md` |
| **E2** | `bank_validate`, `bank_owner`, the `health` resource | A run across the four live banks finds at least one genuine violation |
| **E3** | `bank_graph`, `bank_search`, `bank_changed` | "What breaks if I change this threshold" is answered in one call |
| **E4** | `bank_create`, templates, prompts | A new ADR is created and registered with no manual steps |

E1 and E2 are self-sufficient — if it goes no further, the value is already there.

## 10. Open questions

1. **`canonical_for` is not filled in everywhere.** In the live banks the field is
   present on some documents only. `bank_owner` is useless without it, so E2 runs into
   annotating existing documents. Size that up before starting.
2. **`registeredIn` is determined by parsing markdown links in indexes.** A link in a
   table and a link in a list look different; either cover both forms or agree on one.
3. **`stale-draft` needs a date.** The frontmatter schema has no date — take it from git
   or add a field.
4. **Whether to publish.** The server contains nothing project-specific and solves a
   problem that is not only the author's. A candidate for a public repository — see the
   question about filling out GitHub.
