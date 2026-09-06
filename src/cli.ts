#!/usr/bin/env node
import { Bank } from './bank.js'
import { route } from './route.js'
import { read } from './read.js'
import { validate } from './validate.js'
import { graph, type Direction } from './graph.js'
import { SearchIndex, search } from './search.js'
import { changed } from './changed.js'
import { create, inbox, promote } from './create.js'
import { init, materializeFlows } from './init.js'
import { startServer } from './server.js'

interface Args {
  root?: string
  stats: boolean
  route?: string
  read?: string
  section?: string
  limit?: number
  validate: boolean
  scope?: string
  rule?: string
  summary: boolean
  graph?: string
  direction?: Direction
  depth?: number
  search?: string
  changed?: string
  create?: string
  kind?: string
  title?: string
  purpose?: string
  derived?: string
  canonical?: string
  inbox: boolean
  dryRun: boolean
  promote?: string
  to?: string
  listInbox: boolean
  init?: string
  materializeFlows?: boolean
  force: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { stats: false, validate: false, summary: false, inbox: false, dryRun: false, listInbox: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') args.root = argv[++i]
    else if (a === '--stats') args.stats = true
    else if (a === '--route') args.route = argv[++i]
    else if (a === '--read') args.read = argv[++i]
    else if (a === '--section') args.section = argv[++i]
    else if (a === '--limit') args.limit = Number(argv[++i])
    else if (a === '--validate') args.validate = true
    else if (a === '--scope') args.scope = argv[++i]
    else if (a === '--rule') args.rule = argv[++i]
    else if (a === '--summary') args.summary = true
    else if (a === '--graph') args.graph = argv[++i]
    else if (a === '--direction') args.direction = argv[++i] as Direction
    else if (a === '--depth') args.depth = Number(argv[++i])
    else if (a === '--search') args.search = argv[++i]
    else if (a === '--changed') args.changed = argv[++i]
    else if (a === '--create') args.create = argv[++i]
    else if (a === '--kind') args.kind = argv[++i]
    else if (a === '--title') args.title = argv[++i]
    else if (a === '--purpose') args.purpose = argv[++i]
    else if (a === '--derived') args.derived = argv[++i]
    else if (a === '--canonical') args.canonical = argv[++i]
    else if (a === '--inbox') args.inbox = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--promote') args.promote = argv[++i]
    else if (a === '--to') args.to = argv[++i]
    else if (a === '--list-inbox') args.listInbox = true
    else if (a === '--init') args.init = argv[++i]
    else if (a === '--materialize-flows') args.materializeFlows = true
    else if (a === '--force') args.force = true
  }
  return args
}

function printStats(bank: Bank, ms: number): void {
  const docs = bank.all()
  const by = (pick: (d: (typeof docs)[number]) => string) => {
    const m = new Map<string, number>()
    for (const d of docs) m.set(pick(d) || '(none)', (m.get(pick(d) || '(none)') ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }

  const edges = docs.flatMap((d) => d.derivedFrom)
  const parseErrors = docs.filter((d) => d.parseError)
  const noFrontmatter = docs.filter((d) => !d.hasFrontmatter)

  console.log(`root:        ${bank.root}`)
  console.log(`documents:   ${docs.length}`)
  console.log(`bytes:       ${(docs.reduce((s, d) => s + d.bytes, 0) / 1024).toFixed(0)} KB`)
  console.log(`indexed in:  ${ms} ms`)
  console.log(`contract:    ${bank.contract.present ? bank.contract.source.join(', ') : 'ABSENT (degraded mode)'}`)
  if (bank.contract.present) {
    console.log(`  doc_kind:      ${[...bank.contract.docKinds].sort().join(', ') || '(not declared)'}`)
    console.log(`  doc_function:  ${[...bank.contract.docFunctions].sort().join(', ') || '(not declared)'}`)
    console.log(`  status:        ${[...bank.contract.statuses].sort().join(', ') || '(not declared)'}`)
    console.log(`  roots:         ${[...bank.contract.roots].join(', ') || '(not declared)'}`)
  }
  console.log(`edges:       ${edges.length} (with fit: ${edges.filter((e) => e.fit).length}, external: ${edges.filter((e) => e.external).length}, unresolved: ${edges.filter((e) => !e.resolved && !e.external).length})`)
  console.log(`canonical:   ${bank.ownerByKey.size} keys, conflicts: ${[...bank.ownerByKey.values()].filter((v) => v.length > 1).length}`)
  console.log(`index links: ${bank.indexLinks.length}`)
  console.log(`parse errors: ${parseErrors.length}${parseErrors.length ? ' -> ' + parseErrors.map((d) => d.path).join(', ') : ''}`)
  console.log(`no frontmatter: ${noFrontmatter.length}${noFrontmatter.length ? ' -> ' + noFrontmatter.map((d) => d.path).join(', ') : ''}`)
  console.log(`\nby layer:`)
  for (const [k, v] of by((d) => d.layer)) console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log(`\nby doc_kind:`)
  for (const [k, v] of by((d) => d.docKind)) console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log(`\nby doc_function:`)
  for (const [k, v] of by((d) => d.docFunction)) console.log(`  ${String(v).padStart(4)}  ${k}`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.root) {
    console.error('usage: mcp-memorybank --root <path-to-memory_bank> [--stats | --route "question" | --read <path> [--section <name>] | --validate [--scope <dir>] [--rule <name>] [--summary] | --graph <path> [--direction up|down|both] [--depth N] | --search "query" | --changed <iso-date|git-ref> | --create <path> --kind <k> --title <t> --purpose <p> [--derived a,b] [--canonical k1,k2] [--inbox] [--dry-run] | --promote <_inbox/x.md> --to <path> [--kind k] [--derived a,b] [--dry-run] | --list-inbox | --init "Project Name" [--force] [--dry-run] | --materialize-flows [--force]]')
    process.exit(2)
  }

  const bank = new Bank(args.root)
  const started = Date.now()
  await bank.refresh()
  const ms = Date.now() - started

  if (args.stats) {
    printStats(bank, ms)
    return
  }

  if (args.route !== undefined) {
    const results = route(bank, args.route, { limit: args.limit ?? 5 })
    if (results.length === 0) {
      console.log('(no matches)')
      return
    }
    for (const r of results) {
      console.log(`${String(r.score).padStart(7)}  ${r.path}`)
      console.log(`         ${r.title} [${r.docKind || '?'} / ${r.layer} / ${r.status || '?'}]`)
      console.log(`         why: ${r.why}`)
      if (r.purpose) console.log(`         purpose: ${r.purpose.slice(0, 120)}`)
      console.log()
    }
    return
  }

  if (args.validate) {
    const findings = await validate(bank, { scope: args.scope, rule: args.rule })
    const byRule = new Map<string, number>()
    for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1)
    if (!args.summary) {
      for (const f of findings) {
        console.log(`${f.severity.toUpperCase().padEnd(7)} ${f.rule.padEnd(24)} ${f.path}${f.line ? ':' + f.line : ''}`)
        console.log(`        ${f.message}`)
      }
      if (findings.length) console.log()
    }
    console.log(`total: ${findings.length}`)
    for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${rule}`)
    }
    return
  }

  if (args.init !== undefined) {
    const result = await init(bank, { name: args.init, dryRun: args.dryRun, force: args.force })
    console.log(`${result.dryRun ? 'WOULD CREATE' : 'CREATED'} ${result.root}`)
    console.log(`directories: ${result.directories.sort().join(', ')}`)
    console.log(`files:       ${result.files.length}`)
    for (const w of result.warnings) console.log(`warning:     ${w}`)
    return
  }

  if (args.materializeFlows) {
    const result = await materializeFlows(bank, { force: args.force })
    console.log(`COPIED ${result.files.length} files into ${result.root}/flows/templates`)
    console.log('This bank now owns its templates; bank_create prefers them over the ones the server ships.')
    for (const w of result.warnings) console.log(`warning: ${w}`)
    return
  }

  if (args.listInbox) {
    const entries = inbox(bank)
    if (entries.length === 0) {
      console.log('(inbox empty)')
      return
    }
    for (const e of entries) {
      console.log(`${String(e.ageDays).padStart(4)}d  ${e.path}  [${e.docKind || '?'}]`)
      console.log(`       ${e.title}`)
      console.log(`       ${e.purpose}`)
      console.log()
    }
    console.log(`total: ${entries.length}`)
    return
  }

  if (args.promote !== undefined) {
    const list = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined)
    if (!args.to) throw new Error('--promote needs --to <destination path>')
    const result = await promote(bank, {
      path: args.promote,
      to: args.to,
      docKind: args.kind,
      title: args.title,
      purpose: args.purpose,
      derivedFrom: list(args.derived),
      canonicalFor: list(args.canonical),
      dryRun: args.dryRun,
    })
    console.log(`${result.dryRun ? 'WOULD PROMOTE' : 'PROMOTED'} ${result.from} -> ${result.to}`)
    console.log(`template:      ${result.template ?? '(none)'}`)
    console.log(`registered in: ${result.registeredIn.join(', ') || '(nowhere)'}`)
    for (const w of result.warnings) console.log(`warning:       ${w}`)
    console.log(`\n--- preview ---\n${result.preview}`)
    return
  }

  if (args.create !== undefined) {
    const list = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined)
    const result = await create(bank, {
      docKind: args.kind ?? 'engineering',
      path: args.create,
      title: args.title ?? args.create,
      purpose: args.purpose ?? '',
      derivedFrom: list(args.derived),
      canonicalFor: list(args.canonical),
      inbox: args.inbox,
      dryRun: args.dryRun,
    })
    console.log(`${result.dryRun ? 'WOULD CREATE' : 'CREATED'} ${result.path}`)
    console.log(`template:      ${result.template ?? '(none)'}`)
    console.log(`registered in: ${result.registeredIn.join(', ') || '(nowhere)'}`)
    for (const w of result.warnings) console.log(`warning:       ${w}`)
    console.log(`\n--- preview ---\n${result.preview}`)
    return
  }

  if (args.search !== undefined) {
    const index = new SearchIndex()
    const started = Date.now()
    const touched = index.sync(bank)
    const hits = search(bank, index, args.search, { limit: args.limit ?? 10 })
    console.log(`indexed ${touched} documents, ${index.size} terms, ${Date.now() - started} ms\n`)
    for (const hit of hits) {
      console.log(`${String(hit.score).padStart(7)}  ${hit.path}:${hit.line}  [${hit.docKind || '?'} / ${hit.layer}]  x${hit.hits}`)
      console.log(`         ${hit.excerpt}`)
      console.log()
    }
    if (hits.length === 0) console.log('(no matches)')
    return
  }

  if (args.changed !== undefined) {
    const result = await changed(bank, args.changed)
    console.log(`since ${result.since} [${result.mode}${result.repo ? ', ' + result.repo : ''}]`)
    if (result.note) console.log(`note: ${result.note}`)
    console.log()
    for (const c of result.changes) {
      console.log(`${c.changeKind.padEnd(9)} ${c.path}${c.from ? '  <- ' + c.from : ''}  [${c.docKind ?? '-'} / ${c.layer ?? '-'}]`)
    }
    console.log(`\ntotal: ${result.changes.length}`)
    return
  }

  if (args.graph !== undefined) {
    const g = graph(bank, args.graph, { direction: args.direction, depth: args.depth })
    console.log(`${g.root}  [${g.direction}, depth ${g.depth}]`)
    console.log(`nodes: ${g.nodes.length - 1}  ${Object.entries(g.byLayer).map(([k, v]) => `${k}:${v}`).join(' ')}${g.truncated ? '  (truncated)' : ''}`)
    console.log()
    for (const node of g.nodes) {
      if (node.depth === 0) continue
      const fit = g.edges.find((e) => (node.via === 'down' ? e.from === node.path : e.to === node.path))?.fit
      console.log(`${'  '.repeat(node.depth)}${node.via === 'up' ? '^' : 'v'} ${node.path}  [${node.docKind || '?'} / ${node.layer}]`)
      if (fit) console.log(`${'  '.repeat(node.depth)}    fit: ${fit.slice(0, 140)}`)
    }
    if (g.external.length) console.log(`\nexternal (outside the bank): ${g.external.map((e) => e.raw).join(', ')}`)
    if (g.broken.length) console.log(`broken: ${g.broken.map((e) => e.raw).join(', ')}`)
    return
  }

  if (args.read !== undefined) {
    const result = await read(bank, args.read, args.section)
    console.log(`# ${result.path}${result.section ? ` :: ${result.section}` : ''} (${result.bytes} bytes)`)
    console.log(result.content)
    return
  }

  await startServer(bank)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
