# mcp-memorybank

An MCP server for a `memory_bank` knowledge base. It seeds one from nothing, gates every write
against the rules the bank itself declares, routes to the right document without reading the bank,
and reports where the code has moved on without the documents.

It writes nothing on its own initiative. Every document arrives from a deliberate call carrying a
purpose, an upstream dependency and an index entry; what the end-of-session hook collects lands in
a quarantine that only a human empties.

Spec — [specification.md](specification.md), plan — [implementation-plan.md](implementation-plan.md),
what a seeded bank is made of and where it strains — [architecture.md](architecture.md).

Everything in the plan is done: **E0** index, **E1** reads, **E2** validation, **E3** graph,
**E4** search and delta, **E5** writes.

## How it works

There is no database, no daemon and no configuration. A directory of markdown files is the entire
state, and the server is a reader of it that happens to speak MCP. Everything it knows it re-derives
from the files; delete its process and nothing is lost, because nothing was ever kept anywhere else.

### The index, and why there is no watcher

On startup the server walks the bank once, and on every call it walks it again: `readdir`, `stat`,
and a parse only for the files whose `mtime` moved. A cold build of a 368-document bank takes about
85 ms; the walk before an unchanged call costs 11–13 ms.

That is why there is no file watcher. A watcher would save those milliseconds and buy an error class
in exchange — an index that has quietly diverged from the disk, in a tool whose whole job is to be
trusted about what the disk says. The cheap check wins on both counts.

### What a document becomes

Each file is parsed once into a record: the frontmatter fields, the second-level section headings
with their line spans, byte size, mtime — and one thing the file does not contain, a **layer**
computed from the path (`dna`, `knowledge`, `decision`, `delivery`, `flow`, `inbox`, `other`).

Frontmatter goes through `gray-matter` in exactly one place. When the YAML is invalid — an unquoted
colon in `purpose` is the common case — the document does not fall out of the index: its metadata is
recovered line by line and the parse error is kept for `bank_validate` to report. A document that
disappears from routing because of a typo is worse than one that ranks badly.

### The contract comes from the bank

`doc_kind`, `doc_function`, `status`, whether `derived_from` is mandatory, which document is the
declared root — all of it is read out of the bank's own `dna/frontmatter.md` and `dna/governance.md`
at refresh time. Nothing is hardcoded, and the sets are open.

This is not politeness: banks disagree about their own vocabulary, and a fixed enum rejects a
sizeable minority of real documents by `doc_kind` alone. A bank with no `dna/` still works: the server runs in degraded mode — reading,
routing, search and the structural rules — and says so instead of enforcing a contract nobody
declared.

### Routing: ranking the header, never the prose

`bank_route` answers "what should I read about this", and it reads only what a human wrote by hand
about each document — never the body. Four fields, with fixed weights:

| Field | Weight | Scored as |
|---|---|---|
| `canonical_for` | 5 | how much of a fact key the question covers, not whether one word of it matched |
| `purpose` | 3 | word overlap |
| `title` | 2 | word overlap |
| section headings | 1 | the best-matching heading, which is also returned so the answer can be read section-scoped |

The raw score is then multiplied, and the multipliers are where the ranking actually gets its
judgement:

- **Layer.** `knowledge` ×1.5, `decision` ×1.2, `dna` / `flow` / `other` ×1.0, `delivery` ×0.6,
  `inbox` ×0.2. Delivery is damped because in a bank that has been in use for a while it is most of
  the documents; without this a question about a rule returns the closed features that mention it.
- **Status.** `active` ×1, `draft` ×0.7, `archived` ×0.2.
- **Closed work.** `delivery_status: done` or `cancelled` halves the score again. A finished feature
  is history, not an answer.
- **Intent.** A question containing *why*, *rationale*, *instead of*, *почему*, *вместо* reweights
  the whole run toward decisions: `decision` ×1.6, `knowledge` ×1.2. "Why X" and "what is X" are
  different questions and should not return the same document first.

Templates never appear in results: they are structurally identical to real documents and would
flood every list.

### Search: a different index for a different question

`bank_search` is not a fallback for routing, it answers the other half. Routing ranks the
hand-written header ("which document is *about* this"); search reads the prose ("where does this
string actually appear"). Identifiers, error messages and literals live only in bodies.

It builds an inverted index over document bodies, incrementally on the same mtime check. A query
matches in three tiers by confidence — the word as typed weighs 10, its equivalent in the other
language 6, a fragment of a compound token 1 — and documents matching every concept are ranked
before documents matching some. The fragment tier is what keeps `FT-042` from lifting the
`features/README.md` registry, with its seventy `FT-*` lines, above the feature itself.

### Writing: one operation, or none

`bank_create` writes the document, fills the frontmatter the contract asks for, and registers it in
the section index **in the same call** — so the registration step cannot be forgotten, which is the
single most common way a bank rots. Registration copies the shape of the last entry in that index,
table row or bullet or numbered item, so a hand-written file is not reformatted.

Before any of that it refuses, with the reason named: the path is taken, `derived_from` does not
resolve, `canonical_for` is already owned by another document, the path leaves the bank root, or it
does not end in `.md`. A refusal writes nothing at all — no partial file, no orphaned index line.

Two rules follow from those gates, and they are the reason the writes are worth having: an SSoT
conflict and a broken edge **cannot enter the bank through this server**. They can only arrive by
editing a file behind its back.

### The graph

`bank_graph` walks `derived_from` breadth-first with a node ceiling, so a hub document does not drag
in the whole bank and a cycle does not loop. Each edge lands in one of three outcomes: internal (a
node), `external` (it leaves the bank root — in a monorepo, banks nest), or `broken`. `up` is what a
document is built on; `down` is the blast radius of changing it.

An external edge is followed exactly one hop: the target's frontmatter is read and returned under
`neighbours`, and nothing else about it is. It is not indexed, not validated, not searchable, and its
own edges are not walked. The boundary stays where it was — but in a monorepo those edges carry real
decisions, and a blast radius that silently ends at the repository wall is wrong rather than partial.
Pass `neighbours: false` to skip the reads.

### Drift

`bank_drift` answers the question validation cannot: not "is something missing" but "has what we
wrote gone stale". A document that describes code lists it in `anchors:`, and the server compares the
last commit that touched the document against the last commit that touched the code. Where the code
is ahead by more than the threshold, it says so — and where an anchor points at a path that no longer
exists, it always says so, because that is the code moving out from under the document.

It never guesses which document owns which file. The pairing is hand-annotated or it does not exist,
which means a bank that has not been annotated gets an honest empty answer and a note saying why. And
it reports without editing: whether a six-month gap matters is not a judgement a timestamp can make.

### What a seeded bank contains

`bank_init` writes 24 files: the governance set in `dna/`, a root index, eight section registries,
the four flow documents, a pointer where the templates would be, and two drafts to fill in. Three more sections — `epics`, `prd`, `prompts` — are built
the first time a document needs one, index and root-index entry included, rather than standing empty
from the start.

The document templates are not copied. They ship with the server and `bank_create` reads them from
there, so a bank behaves exactly as if it held them; `--materialize-flows` copies them in for a
project that means to change one, and from then on the bank's own copies win. The prose flows *are*
copied, because people read them and routing answers with them.

`dna/` is copied too, and that one is not negotiable: it is the law the bank is judged by, and the
design rests on it travelling with the corpus. Every top-level directory's layer and ranking weight
is declared there as well — a bank that renames a section says so in that table and keeps its
weight, and a bank that declares nothing gets the built-in map.

### What it will not do

It does not create a document by editing — every new document goes through `bank_create`, so nothing
enters the bank without a path check, a `derived_from` that resolves and an index entry. It does not
promote anything out of `_inbox/` on its own. It does not invent a schema, and it does not enforce a
rule the bank has not declared. It does not delete a document outside `_inbox/`. And it does not
index, validate or search anything outside the bank root — the one hop `bank_graph` takes into a
neighbouring bank reads a header and stops there.

### What it costs in tokens

Wiring a server in is not free, and the cost is paid in two different currencies. All figures below
were measured on the shipped build, counting characters of the actual JSON-RPC payloads and
converting at 3.5 characters per token — dense JSON runs closer to that than the 4 that suits prose.

**The fixed half is paid on every request**, whether a tool is called or not, because the
definitions live in the context:

| | characters | ~tokens |
|---|---|---|
| server instructions | 343 | 98 |
| 15 tool definitions | 20,473 | 5,849 |
| 5 prompts | 1,357 | 388 |
| 4 resources | 913 | 261 |
| **total, per request** | **23,086** | **~6,600** |

`bank_create` is the most expensive definition at ~715 tokens — seven parameters and a description
that has to explain the gate. `bank_changed` is the cheapest at ~183.

That table is what a project **with a bank** pays. A project that has none is offered `bank_init`
alone and pays ~450; one switched off — by `--off` or a `.memorybank-off` file — pays ~25 for an empty surface. See
[Installing it once, for every project](#installing-it-once-for-every-project) — the reason the
server bothers to make that distinction is that a global install would otherwise charge the full
rate in every project on the machine, including every project that will never have a bank.

**The variable half is where it earns the fixed half back.** On a 27-document bank:

| | characters | ~tokens |
|---|---|---|
| reading the whole bank | 91,319 | 26,091 |
| a `bank_route` answer, 3 results | 839 | **240** |
| the three documents it named | 8,386 | 2,396 |

Routing answers in 240 tokens what reading the corpus costs 26,091 — and a tenth of what reading
even the correct three documents costs, because it returns paths, titles, `purpose` and a line of
reasoning rather than any prose. What to read afterwards is then a decision made on evidence.

`bank_read` is separately bounded: 40,000 bytes per batch, roughly 11,000 tokens. Ask for twenty
documents and you get what fits plus a list of what the budget did not reach, broken down by
section, so a single call cannot flood the context.

**Where the break-even sits.** The ~6,600 is repaid the first time the server prevents one
unnecessary read, and that happens immediately on any bank large enough to matter. Measured across
four banks of the same lineage:

```
 27 documents    ~26k tokens to read whole
 78 documents    ~87k
 96 documents   ~158k
112 documents   ~305k
```

At the top of that range the corpus is two full context windows and reading it is not an option at
any price, while a routed answer stays in the low hundreds of tokens.

The honest conclusion is that **on a small bank the server loses**. While the corpus still fits in a
context window, `cat` is cheaper than a 6,600-token standing charge, and the field test measured
exactly that: on a bank small enough to read whole, routing competes with "already in context" and
loses. The server earns its cost on corpora that have outgrown being read.

And tokens are not the main thing being bought. Half the tools save nothing at all — `bank_create`,
`bank_validate` and `bank_drift` only spend. They exist so the bank keeps its shape, which no amount
of context budget will do on its own. The saving on routing is a side effect, not the point.

## Running it

Wiring it into a project — `<project>/.mcp.json`:

```json
{
  "mcpServers": {
    "memorybank": {
      "command": "npx",
      "args": ["-y", "@maxweb4u/mcp-memorybank", "--root", "./memory_bank"]
    }
  }
}
```

Pin the version once you rely on it — `@maxweb4u/mcp-memorybank@0.2.1` — so the server does not
change shape underneath a project you are not looking at.

The package is scoped because npm's similarity check will not accept `mcp-memorybank` unscoped: it
normalises punctuation away, which makes it indistinguishable from the unrelated `mcp-memory-bank`
already in the registry. The command the package installs is still `mcp-memorybank`.

If the project has no bank yet, seed one first. The command writes the skeleton, the governance set
and one registered index per section, and a bank created this way validates clean by construction:

```bash
npx @maxweb4u/mcp-memorybank --root ./memory_bank --init "Project Name"
```

Requires Node 22. The hook described in [hooks/README.md](hooks/README.md) also wants `jq` and `git`.

### Installing it once, for every project

A per-project `.mcp.json` is explicit and travels with the repository, which is why it is the shape
above. The alternative is one entry for every project on the machine:

```bash
claude mcp add --scope user memorybank -- npx -y @maxweb4u/mcp-memorybank --root ./memory_bank
```

`--root ./memory_bank` resolves against the project directory, so one entry serves every project
that has a bank.

The catch is that a user-scoped server has no per-project off switch on the client side —
`disabledMcpjsonServers` governs `.mcp.json` entries and nothing else. So the server decides for
itself how much of a surface a project gets:

| The project | What it sees | Cost per request |
|---|---|---|
| has a bank | everything | ~6,600 tokens |
| has no bank | `bank_init`, and nothing else | ~450 tokens |
| is named by `--off`, or has a `.memorybank-off` file beside it | nothing at all | ~25 tokens |

The middle row is the one that makes a global install reasonable: a project that has never had a
bank pays about 7% of the full surface, and what it is offered — `bank_init` — is the only call
that would have made sense there anyway. Nothing needs configuring for this; it is what the server
does when the root holds no documents.

There are two ways to say "not here", and they differ in who owns the decision.

**`--off <path>` belongs to the machine.** Repeatable, and one path covers everything beneath it:

```bash
claude mcp add --scope user memorybank -- npx -y @maxweb4u/mcp-memorybank \
  --root ./memory_bank --off /path/to/a/repo/you/do/not/govern
```

Nothing is written into the project it names — the path lives in the client's own config — so there
is no file to appear in that repository's git status and nothing for a colleague to find. That is
what makes it the right shape for a commercial repository someone else's team works in, and for a
project holding several banks at different depths: one path covers them all.

**`.memorybank-off` belongs to the project.** An empty file in the project directory, next to the
bank rather than inside it — keeping the server out is the project's decision, not the bank's:

```bash
touch .memorybank-off
```

It travels with the repository, which is the point when the project itself means to say no, and the
reason not to reach for it when you would rather nobody knew.

The surface is decided once, when the session starts. The exception is `bank_init`: seed a bank in a
project that had none and the rest of the tools appear immediately, without restarting the session.

### From a clone

For working on the server itself, or for pointing several projects at one build:

```bash
npm install && npm run build
node dist/cli.js --root /path/to/project/memory_bank
```

An `.mcp.json` written this way needs an absolute path to `dist/cli.js`, which ties the project to
one checkout on one machine. Fine while developing, wrong for anything you intend to keep.

**`npx` does not work inside this repository.** From the server's own checkout,
`npx @maxweb4u/mcp-memorybank` fails with `sh: mcp-memorybank: command not found`: npx sees that the
requested name matches the local `package.json`, decides the package is already present, and looks
for the binary in the local `node_modules/.bin`, where nothing links it. Nothing is wrong with the
published package — run the same command from any other directory and it works. So when you want to
check what users actually get, do it from a temporary directory, not from here.

Publishing a new version has an order that matters — what is verified on the tarball rather than the
working tree, and which pins move before the publish and which only after. It is written down in
[releasing.md](releasing.md).

### Telling the agent to use it

Wiring the server in makes the tools available; it does not make an agent reach for them. Left to
itself a model will often open `README.md` and walk the section indexes, because that is what it does
everywhere else — which is the exact walk this server exists to remove.

A paragraph in the project's `CLAUDE.md` settles it:

```markdown
# Memory bank

This project is served by the `memorybank` MCP server. **Its tools all begin with `bank_`; load them
at the start of a session and look at what is there** — the set grows, and anything not named here
still exists. Working the bank through them instead of through `sed`, `cat` and `grep` is the point:
they keep the frontmatter, the section indexes and the ownership rules intact, which a shell cannot.

- **Finding.** `bank_route` answers "which document covers this"; `bank_search` finds a literal
  across the bank; `bank_read` takes a path and a section, so a long document costs one section.
  Reach for those before grepping `memory_bank/`.
- **Changing.** `bank_edit` replaces one exact fragment — a backlog row, a table cell, a heading.
  `bank_update_section` writes a whole named section. `bank_set_status` moves a document between
  `draft`, `active` and `archived`, and releases its `canonical_for` when it retires.
- **Creating.** `bank_create` writes the frontmatter the contract asks for and registers the document
  in its section index in the same operation. A document written by hand is reachable from no index.
- **Checking.** Run `bank_validate` before committing anything under `memory_bank/`, and say what it
  found. Never promote a note out of `_inbox/` on your own — that is a review step for the owner.
```

This wording is not a matter of taste; it was measured. With no such paragraph the mechanism simply
sits there — nine hours of one working session with `bank_route` loaded and never called. An earlier
version of the paragraph named five tools explicitly and got exactly five tools used: the ones it
named, and nothing else. Naming the prefix and saying to go look, then grouping by job rather than
reciting names, brought in every tool the rewrite newly mentioned:

```
                              baseline    five named    rewritten
writes into the bank, shell        20          0             0
bank_edit                           0         19            14
bank_route / bank_search            0/0        0/0           2/2
shell searches of the bank         18         11             8
bank_validate findings            3→5          6             0
```

The control makes the reason legible. A project given no `CLAUDE.md` at all still found the tool
family on its own — `bank_edit` thirty times, `bank_create` eighteen — and still made seven shell
writes into its own bank, every one of them shaped exactly like the tools it was already using. The
server is what makes a bank hold; instructions cannot check anything. The paragraph is what makes the
choice consistent. Neither substitutes for the other — see [field-test.md](field-test.md).

## Debugging from the terminal

The CLI is a read-mostly subset for looking at a bank without an agent in the loop, not a mirror of
the tool surface: `bank_drift`, `bank_edit`, `bank_update_section`, `bank_set_status` and
`bank_discard` are MCP-only. Installed from npm the command is `mcp-memorybank`; from a clone it is
`node dist/cli.js`.

```bash
mcp-memorybank --root <bank> --stats
mcp-memorybank --root <bank> --route "filter thresholds" --limit 5
mcp-memorybank --root <bank> --read domain/rules.md --section Thresholds
mcp-memorybank --root <bank> --validate --summary
mcp-memorybank --root <bank> --validate --rule broken-derived-from
mcp-memorybank --root <bank> --graph domain/rules.md --direction down --depth 1
mcp-memorybank --root <bank> --search "FT-042" --limit 5
mcp-memorybank --root <bank> --changed HEAD~5
mcp-memorybank --root <bank> --create adr/ADR-...-name.md --kind adr --title "..." --purpose "..." --derived ../engineering/architecture.md --dry-run
mcp-memorybank --root <new-path> --init "Project Name" --dry-run
mcp-memorybank --root <bank> --materialize-flows
mcp-memorybank --root <bank> --list-inbox
mcp-memorybank --root <bank> --promote _inbox/note.md --to engineering/thing.md --derived ../dna/principles.md --dry-run
```

## What is there

| Tool | What it does |
|---|---|
| `bank_route` | "what should I read about this" — ranks on `canonical_for`, `purpose`, `title`, section headings |
| `bank_read` | a whole document, one second-level section, or several documents in one call, under a byte budget |
| `bank_validate` | checks the bank against the rules the bank itself declares in `dna/` |
| `bank_graph` | walks `derived_from`: `down` — who depends on this (blast radius), `up` — what it is built on |
| `bank_drift` | pairs each document against the code it declares in `anchors:` and reports where the code is ahead |
| `bank_search` | full-text search over document bodies — identifiers, names, literals |
| `bank_changed` | what changed since a git ref or an ISO date; a ref older than the repository lands on its first commit, and a bank with no repository at all answers with everything |
| `bank_init` | creates a bank from nothing: skeleton, `dna/`, the flows, section indexes |
| `bank_materialize_flows` | copies the shipped document templates into the bank, which then owns them |
| `bank_create` | creates a document from the bank's own template and registers it in the index, with gates and `_inbox` |
| `bank_edit` | replaces one exact fragment of a body — a table row, a step, a heading; refuses an ambiguous match |
| `bank_update_section` | writes the body of one named section of an existing document, leaving everything else alone |
| `bank_set_status` | moves a document to another lifecycle status, running the gates that guard activation |
| `bank_promote` | moves a note out of `_inbox/` into a canonical layer, registering it and deleting the source |
| `bank_discard` | drops a quarantined note, on the record — `_inbox/` only, and a reason is required |

| Resource | Contents |
|---|---|
| `memorybank://index` | annotated index of every document (templates excluded) |
| `memorybank://schema/frontmatter` | the bank's own `dna/frontmatter.md`, verbatim |
| `memorybank://health` | a fresh `bank_validate` run, grouped by rule |
| `memorybank://inbox` | what sits in quarantine, oldest first |

Prompts: `session-start` (what the project is, what is in flight, what is open — from the index and
the delta, not by reading everything), `route-then-read` (route first, read second),
`check-before-commit` (run validation and explain every finding), `record-adr` (assemble a decision
into an ADR), `review-inbox` (work through the quarantine).

Two of these exist because of what a working session actually did rather than what the design
expected. Over an afternoon an agent called `bank_read` zero times and `cat` in a shell loop 85
times: ten documents were ten tool calls one way and one call the other, so section scoping — the
feature that keeps large documents out of the context window — lost on arithmetic before it was
considered. Hence a `bank_read` that takes a list. And the first question of every session was
"what is this, where did we stop, what is open", which routing does not answer; without somewhere to
send it, the agent read the whole bank. Hence `session-start`.

### Creating a bank

```bash
mcp-memorybank --root <new-path> --init "Project Name"
```

Writes 24 files: `dna/` (8 governance documents, including the layer table), the four flow
documents, an index for each of the eight seeded sections plus the root index, a pointer where the
templates would be, and two drafts — `product/context.md` and `engineering/testing-policy.md` —
which the templates and the feature closure gate both point at.

Three further sections — `epics/`, `prd/`, `prompts/` — are not created in advance. `bank_create`
builds one, its index and its root-index entry the first time a document needs it, and says so.

The starter set lives in `starter/` and belongs to the bank the moment it is copied: rewrite it
however you like, the server does not keep imposing it. What is *not* copied is
`flows/templates/` — see [What a seeded bank contains](#what-a-seeded-bank-contains).

**A freshly created bank validates with zero findings** — which is the whole point of `bank_init`
rather than copying someone else's bank: a copy would bring that bank's defects along with it.

### Templates and the quarantine

The mechanics of a write are under [How it works](#writing-one-operation-or-none); what follows is
where the content comes from and where an unreviewed note goes.

`bank_create` writes the body it is given and, failing that, the body of the matching template. Pass
`body` rather than creating the document and writing the prose into it afterwards — a document that
arrives as headings alone tends to get its content through a shell, outside every gate the server has.

Three tools reach into a document that already exists, and the split between them is a measured one
rather than a tidy one.

`bank_update_section` writes the body of one named level-two section, leaving the frontmatter, the
title and every other section untouched. It exists because `bank_init` seeds `product/context.md` and
`engineering/testing-policy.md` as drafts specifically so they will be filled, while `bank_create`
refuses an occupied path — correctly — which left the two documents the server asks for as the two it
could not write. A section that does not exist is refused with the list of the real ones rather than
appended, so a mistyped heading cannot quietly add a section.

Both `bank_update_section` and `bank_create` will take their content from a file instead of from the
call — `contentFile` and `bodyFile`. That exists for one measured reason: a session that built a bank
generated a 610-row table out of nineteen other documents with a script and wrote it into the bank
directly, bypassing every gate. Not because the tool could not do the write, but because the tool
wanted the whole table as a string argument, and the table had never been in the agent's context at
all. Content that was computed rather than composed should not have to be recited to be governed, and
a body that does not travel as a JSON string cannot fail to serialise as one.

`bank_edit` replaces one exact fragment. Section-level writing turned out to be the wrong grain for
most edits: over a working session, five of eleven shell writes into the bank changed a few lines
inside a section dozens of lines long — a row of a table, two steps of a plan, one paragraph of an
argument — and a sixth renamed a heading. Replacing the whole section means resending everything
unchanged around the edit, so an agent reaches for a string replace instead, every time. The contract
is the one it already knows: an exact match, refused unless it occurs exactly once, with the count
reported rather than the first occurrence guessed at. `section` narrows the search when the same
words appear twice. The frontmatter is out of reach by construction, since the search runs on the
body — an edit can rename a heading, but it cannot quietly rewrite `canonical_for`.

`bank_set_status` moves a document from one lifecycle status to another, and it exists because the
frontmatter is out of reach of the other two. A draft that `bank_init` seeded and
`bank_update_section` filled has to become active at some point, and with no tool for it an agent
reaches for a stream editor on the frontmatter — measured, in a session that built a bank from
nothing. That is the worst edit to leave to a shell: `status: active` is the gate that requires
`derived_from`, so the one transition governance exists to guard was the one transition that skipped
it. Here the check runs on the way in, and a note in `_inbox/` is refused outright, since the way out
of quarantine is `bank_promote`, which places the note and sets its status in one move.

Archiving is the one transition that gives something up. `ownerByKey` does not look at status, so a
document archived while still declaring `canonical_for` goes on blocking the successor that should
own the key — `bank_create` refuses the successor with "already owned by", naming a document nobody
reads any more. Archiving an owner is therefore refused unless `releaseCanonical` says so, and the
keys are dropped as part of the same write. Measured, again: a session archived a document and
stripped the block with a python regex, because that was the only way to do it at all.

`bank_create` takes the template from the bank's own `flows/templates/` when it has one, and from
the set the server ships when it does not. Templates are
wrappers: the document to instantiate sits inside them as two blocks under
`## Instantiated Frontmatter` and `## Instantiated Body`. The server unwraps exactly those,
substitutes the title, fills the date placeholder, and carries over `must_not_define`, which the
template ships as governance. An unknown `doc_kind` is a warning, not a refusal, and `dryRun` shows
the whole result — frontmatter, chosen template, index line — while writing nothing.

`inbox: true` puts the document in `_inbox/` with `status: draft`, with no template and no
registration. Quarantined documents are exempt from the `unregistered-doc` rule, and `bank_route`
and `bank_search` do not return them at all — they are reachable by `bank_read`, the
`memorybank://inbox` resource and `bank_promote`, and nowhere else. Damping them by layer weight was
tried first and is not the same thing: on a young bank a note reached the top three for the question
it answered, which is exactly what a quarantine is supposed to prevent.

`bank_promote` empties the quarantine: the note body is kept as written, the frontmatter is rebuilt
against the contract, the destination template contributes only its governance fields, the document
is registered in the index, and the source is deleted. Same gates as `bank_create`, plus two of its
own: you can only promote out of `_inbox/`, and only outward. Status after promotion is `active`, so
the governance requirement about `derived_from` is no longer relaxed here.

`bank_discard` is the third outcome, and it exists because the second review of a real quarantine
went outside the server to reach it. A note can be promoted, folded into the document that already
owns the fact with `bank_update_section`, or dropped — and with only the first two implemented, the
agent folded a note in and then reached for `rm` in a shell to clear what it had just consumed. A
tool that names three outcomes and supports two sends the third past every gate it has. `_inbox/`
only, and a reason is required: a note goes on the record or it does not go.

The quarantine is filled by a Stop hook — see [hooks/README.md](hooks/README.md).

### Queries in two languages

The bank is written in English — that is a governance rule and nothing here relaxes it. The
*question* is a different matter: typed by hand it is often not English, and lexical ranking over
English fields cannot answer it at all. "где пороги фильтрации" tokenizes into three words that
appear in no `purpose` or `canonical_for`, so the result is empty rather than merely wrong.

`bank_route` and `bank_search` therefore treat a query word as a concept rather than a string. Each
word carries its equivalents in the other language, drawn from a domain dictionary built from the
most frequent terms in `title` / `purpose` / `canonical_for` across a body of real banks. Three
things follow:

- **A concept scores once.** Three English equivalents matching one `purpose` is one hit, not three,
  so an expanded query cannot outrank a literal one by sheer width.
- **The word actually typed wins a tie.** A translation is discounted, which only matters in a bank
  that mixes languages — there the literal match ranks first.
- **Russian inflects, so a dictionary entry is a stem prefix, not a word.** `порог` covers пороги /
  порогов / порогам; a verbal prefix is stripped only when what remains lands on a known stem, which
  is what lets `задеплоить` reach `deployment`.

Measured on a real bank, a Russian control question returns the same first document as its English
counterpart. Search is symmetric: Cyrillic is a word character in the index, so a document
quoting a Russian source is searchable, and a Russian query reaches English prose through the same
dictionary.

An unknown word is left exactly as typed — identifiers like `FT-042` and `filter_thresholds`
never go near the dictionary.

**The bank can add its own words.** The built-in dictionary carries the subject matter it was drawn
from — agents, deployment, frontend, backend. Point the server at a project about parsing books and
the Russian side goes quiet on `корпус`, `книга`, `прогон`: not a poor answer, an empty one, while
the same question in English lands three ways out of three. The English side never has this problem
because it is read from the bank; the Russian side cannot be, since the bank is English by governance
rule. So write it down, in an optional `dna/vocabulary.md`:

```markdown
| Russian stem | English |
|---|---|
| корпус | corpus, collection |
| книг | book, books, ebook |
| сегмент | segmentation, segmenter, sentence |
```

The left column is a stem — the shortest prefix shared by every inflected form — and rows that are
not two columns with a Cyrillic left side are ignored, so the file can carry prose and headings
around the table. It is re-read on every refresh, so editing it takes effect without a restart. The
file is not seeded by `bank_init`: a bank that does not need one should not carry an empty one.

### Validation rules

| Rule | Severity | Catches |
|---|---|---|
| `broken-derived-from` | error | an edge whose target does not resolve from the document that declares it |
| `invalid-frontmatter` | error | YAML the parser rejects — usually an unquoted colon in `purpose` |
| `cycle-in-derived-from` | error | A derives from B derives from A |
| `ssot-conflict` | error | two documents claiming the same `canonical_for` key |
| `missing-derived-from` | error | an `active` non-root document with no upstream |
| `must-not-define-violated` | error | a document defining a key it declared it would not |
| `dangling-index-entry` | error | an index linking to a file that is not there |
| `unknown-enum-value` | warning | a `doc_kind` / `doc_function` / `status` outside what `dna/` declares |
| `unregistered-doc` | warning | a document no index links to — unreachable by navigation |
| `unresolved-rule-reference` | warning | prose citing a rule by a path that does not resolve |
| `unknown-layer-value` | warning | the layer table in `dna/` names a layer that does not exist; the row is ignored |
| `no-contract` | warning | the bank has no `dna/`, so contract rules cannot run |

The order is not alphabetical: it is descending by how often each rule fired while the validator was
being built, so the productive rules read first.

Structural rules work in any bank. Contract rules (`missing-derived-from`, cycles,
`unknown-enum-value`) apply only where the bank declared them itself in `dna/governance.md` — the
server enforces the bank's rules, not its own.

## Decisions where the implementation departs from the spec

- **The schema is read from the bank.** `doc_kind` / `doc_function` / `status` are open sets, read
  out of `dna/frontmatter.md` and `dna/governance.md`. A hard enum rejects a sizeable minority of
  the documents in a real bank.
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
  `FT-042` would lift the `features/README.md` registry, with its seventy `FT-*` lines,
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

195 tests in three tiers, which exist for different reasons.

**Generated** — `test/acceptance-generated.test.ts` seeds a bank with the current `bank_init`, fills
it through `bank_create` only, and then runs the plan's readiness criteria against that: routing in
both languages, the graph over edges the server itself wrote, search, the git delta, and every
refusal gate. It needs nothing but a temp directory and git, so this is the tier that has to stay
green. It also carries the strongest claim in the design — **a bank built entirely through the
server validates with zero findings, and still does after three refused writes.**

**Fixture** — `test/fixture-bank/` is a bank with deliberate violations: a broken edge, a second
owner of a fact, an orphan, broken YAML, a reference outside the root. It stays hand-written on
purpose, because `bank_create` cannot produce any of them.

**Corpus** — `test/acceptance.test.ts` runs the same criteria against whatever banks you point it
at, which is how the design decisions were measured in the first place. Those banks are yours and
live outside the repository, so the suite is opt-in:

```bash
MEMORYBANK_TEST_ROOTS=/path/to/projects npm run test:corpus
```

With the variable unset it skips. With it set but the banks missing it fails rather than skipping —
a typo in a path should not read as a pass.
