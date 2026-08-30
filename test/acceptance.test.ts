/**
 * Acceptance criteria from implementation-plan.md, measured against the real corpus.
 *
 * This suite reads banks that live outside the repository, so it is opt-in: point
 * `MEMORYBANK_TEST_ROOTS` at the directory holding them. With the variable unset the suite skips,
 * which is why it must never be the only thing standing behind a green build — the suite that runs
 * everywhere is `acceptance-generated.test.ts`, which builds its bank with the current code.
 *
 * With the variable set but the banks missing the suite fails rather than skipping: a typo in a
 * path should not read as a pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { Bank } from '../src/bank.js'
import { route } from '../src/route.js'
import { read } from '../src/read.js'
import { validate } from '../src/validate.js'
import { graph } from '../src/graph.js'
import { SearchIndex, search } from '../src/search.js'
import { changed } from '../src/changed.js'
import { create } from '../src/create.js'

const ROOTS = process.env['MEMORYBANK_TEST_ROOTS']
const AGENT_UPWORK = `${ROOTS}/__my/agents/AgentUpwork/memory_bank`
const SHOWMOJO = `${ROOTS}/showmojo/MainProject/backend/memory_bank`

const have = (p: string) => ROOTS !== undefined && fs.existsSync(p)

describe.skipIf(!ROOTS)('MEMORYBANK_TEST_ROOTS', () => {
  it('points at the corpus it claims to point at', () => {
    for (const bankPath of [AGENT_UPWORK, SHOWMOJO]) {
      expect(fs.existsSync(bankPath), `${bankPath} is missing; check MEMORYBANK_TEST_ROOTS`).toBe(true)
    }
  })
})

describe.skipIf(!have(AGENT_UPWORK))('E0/E1 — AgentUpwork (95 docs, knowledge-heavy)', () => {
  let bank: Bank
  beforeAll(async () => {
    bank = new Bank(AGENT_UPWORK)
    await bank.refresh()
  })

  it('indexes the whole bank', () => {
    expect(bank.all()).toHaveLength(95)
  })

  it('reads the contract out of dna/ instead of hardcoding it', () => {
    expect(bank.contract.present).toBe(true)
    expect(bank.contract.docFunctions.has('template')).toBe(true)
    expect(bank.contract.docKinds.has('use_case')).toBe(true)
    expect([...bank.contract.roots]).toEqual(['dna/principles.md'])
  })

  it('parses every document — the 22 unquoted-colon defects in the corpus are fixed', () => {
    expect(bank.all().filter((d) => d.parseError)).toEqual([])
  })

  const CONTROL: [string, string][] = [
    ['filter thresholds', 'domain/rules.md'],
    ['why collection via chrome extension', 'adr/ADR-20260610T120000Z-collection-via-chrome-extension.md'],
    ['how to deploy the backend', 'ops/deployment.md'],
    ['frontmatter schema rules', 'dna/frontmatter.md'],
    ['upwork session blocked recovery', 'ops/account-safety.md'],
  ]

  it.each(CONTROL)('routes "%s" into the top 3', (question, expected) => {
    const top = route(bank, question, { limit: 3 }).map((r) => r.path)
    expect(top).toContain(expected)
  })

  it.each(CONTROL.slice(0, 4))('routes "%s" to the right document first', (question, expected) => {
    expect(route(bank, question, { limit: 1 })[0]?.path).toBe(expected)
  })

  it('never surfaces a template', () => {
    const templates = new Set(bank.all().filter((d) => d.docFunction === 'template').map((d) => d.path))
    expect(templates.size).toBe(23) // 23rd recovered by the lenient parser
    for (const [question] of CONTROL) {
      const hits = route(bank, question, { limit: 10 })
      expect(hits.filter((r) => templates.has(r.path))).toEqual([])
    }
  })

  it('has no unresolvable upstream left in the governance document', () => {
    const flow = bank.get('flows/feature-flow.md')!
    expect(flow.derivedFrom.filter((e) => !e.external && e.resolved && !bank.docs.has(e.resolved))).toEqual([])
    expect(flow.derivedFrom.length).toBeGreaterThan(0)
  })

  it('reports both known defects of this bank and nothing else at error severity', async () => {
    const errors = await validate(bank, { severity: 'error' })
    const byRule = new Map<string, string[]>()
    for (const f of errors) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f.path])

    expect(byRule.get('ssot-conflict')).toEqual(['flows/workflows.md'])
    expect(byRule.get('broken-derived-from')).toBeUndefined()
    expect(byRule.get('cycle-in-derived-from')?.length).toBe(4)
    expect(byRule.get('invalid-frontmatter')).toBeUndefined()
    expect(byRule.get('dangling-index-entry')).toBeUndefined()
    expect(byRule.get('must-not-define-violated')).toBeUndefined()
  })

  it('no longer reports the closure gate: the path is fixed and the rule now exists', async () => {
    expect(await validate(bank, { rule: 'unresolved-rule-reference' })).toEqual([])
    const policy = bank.raw('engineering/testing-policy.md')!
    expect(policy).toContain('## Simplify Review')
  })

  it('answers "I change this threshold, what else do I touch" in one call', () => {
    const down = graph(bank, 'domain/rules.md', { direction: 'down', depth: 1 })
    expect(down.nodes.filter((n) => n.depth > 0).map((n) => n.path)).toEqual([
      'adr/ADR-20260610T140000Z-two-stage-rule-filtering-before-ai.md',
      'domain/scoring.md',
      'domain/states.md',
      'features/FT-M1-ingest-and-l1/brief.md',
      'features/FT-M2-enrichment-and-l2/brief.md',
      'features/FT-M4-telegram-approval/brief.md',
      'ops/config.md',
      'use-cases/UC-JOB-PIPELINE-discovery-to-approval.md',
    ])
    expect(down.byLayer).toMatchObject({ knowledge: 3, decision: 2, delivery: 3 })
  })

  it('walks up the governance document with every edge resolving', () => {
    const up = graph(bank, 'flows/feature-flow.md', { direction: 'up', depth: 1 })
    expect(up.broken).toEqual([])
    expect(up.nodes.length).toBeGreaterThan(1)
  })

  it('terminates on a document that sits inside a cycle', () => {
    const both = graph(bank, 'ops/README.md', { direction: 'both', depth: 4, limit: 200 })
    expect(both.nodes.length).toBeGreaterThan(1)
    expect(both.truncated).toBe(false)
  })

  it('finds a literal that no purpose would mention', () => {
    const index = new SearchIndex()
    index.sync(bank)
    const hits = search(bank, index, 'REQ-01', { limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.layer === 'delivery')).toBe(true)
    expect(hits[0]!.excerpt).toContain('REQ-01')
  })

  it('computes a real delta from git, including uncommitted work', async () => {
    const delta = await changed(bank, 'HEAD')
    expect(delta.mode).toBe('git')
    expect(delta.repo).toContain('AgentUpwork')
    expect(delta.changes.every((c) => c.path.endsWith('.md'))).toBe(true)
  })

  it('rejects a ref that does not exist instead of guessing', async () => {
    await expect(changed(bank, 'no-such-ref-here')).rejects.toThrow(/not a commit/i)
  })

  it('falls back to modification times for an ISO date', async () => {
    const delta = await changed(bank, '2000-01-01')
    expect(delta.mode).toBe('mtime')
    expect(delta.changes).toHaveLength(95)
    expect(delta.note).toMatch(/cannot see deletions/)
  })

  it('finds the single SSoT conflict', () => {
    const conflicts = [...bank.ownerByKey.entries()].filter(([, owners]) => owners.length > 1)
    expect(conflicts.map(([key]) => key)).toEqual(['autonomy_gradient'])
  })
})

describe.skipIf(!have(SHOWMOJO))('E1/E2 — showmojo backend (368 docs, 80% delivery journal)', () => {
  let bank: Bank
  beforeAll(async () => {
    bank = new Bank(SHOWMOJO)
    await bank.refresh()
  })

  it('indexes the whole bank', () => {
    expect(bank.all()).toHaveLength(368)
  })

  const QUESTIONS = [
    'property shield billing rules',
    'how to run tests',
    'listing gallery',
    'authentication model',
    'why we chose this queue',
  ]

  it.each(QUESTIONS)('answers "%s" with knowledge, not the delivery journal', (question) => {
    const top = route(bank, question, { limit: 5 })
    expect(top.length).toBeGreaterThan(0)
    expect(top[0]!.layer).not.toBe('delivery')
    expect(top.filter((r) => r.layer === 'delivery').length).toBeLessThanOrEqual(3)
  })

  it('carries fit through a real feature package', () => {
    const brief = bank.get('features/FT-SMD-843/brief.md')!
    expect(brief.derivedFrom).toHaveLength(9)
    expect(brief.derivedFrom.filter((e) => e.fit)).toHaveLength(4)
  })

  it('never calls a cross-bank reference broken', async () => {
    const findings = await validate(bank)
    expect(findings.filter((f) => f.message.includes('../../../'))).toEqual([])
  })

  it('walks up a real feature package and keeps every fit', () => {
    const up = graph(bank, 'features/FT-SMD-843/brief.md', { direction: 'up', depth: 1 })
    expect(up.nodes.filter((n) => n.depth > 0)).toHaveLength(9)
    expect(up.edges.filter((e) => e.fit)).toHaveLength(4)
  })

  it('ranks the feature package above the registry that merely lists it', () => {
    const index = new SearchIndex()
    index.sync(bank)
    const hits = search(bank, index, 'FT-SMD-843', { limit: 5 })
    expect(hits[0]!.path.startsWith('features/FT-SMD-843/')).toBe(true)
    expect(hits.findIndex((h) => h.path === 'features/README.md')).not.toBe(0)
  })

  it('caps a hub walk instead of returning the whole bank', () => {
    const hub = graph(bank, 'dna/governance.md', { direction: 'down', depth: 2 })
    expect(hub.truncated).toBe(true)
    expect(hub.nodes).toHaveLength(60)
  })

  it('reads one section of a large document instead of all of it', async () => {
    const doc = bank.all().sort((a, b) => b.bytes - a.bytes)[0]!
    expect(doc.sections.length).toBeGreaterThan(0)
    const section = await read(bank, doc.path, doc.sections[0]!.title)
    expect(section.bytes).toBeLessThan(doc.bytes)
  })
})

describe.skipIf(!have(AGENT_UPWORK))('E5 — creating into a copy of a real bank', () => {
  let root: string
  let bank: Bank

  beforeAll(async () => {
    // Never write into the real bank; work on a throwaway copy of it.
    root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'memorybank-acceptance-'))
    await fsp.cp(AGENT_UPWORK, root, { recursive: true })
    bank = new Bank(root)
    await bank.refresh()
  })

  afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('creates and registers an ADR from the bank\'s own template, leaving validation unchanged', async () => {
    const before = await validate(bank)

    const result = await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-20260829T120000Z-index-in-memory.md',
      title: 'ADR-20260829T120000Z: Keep The Bank Index In Memory',
      purpose: 'Records why the index is rebuilt from files on every call instead of being persisted.',
      derivedFrom: ['../engineering/architecture.md'],
    })

    expect(result.template).toBe('flows/templates/adr/ADR-ID.md')
    expect(result.registeredIn).toEqual(['adr/README.md'])

    const index = await fsp.readFile(nodePath.join(root, 'adr/README.md'), 'utf8')
    const row = index.split('\n').find((l) => l.includes('ADR-20260829T120000Z-index-in-memory.md'))!
    expect(row.startsWith('|')).toBe(true)

    const after = await validate(bank)
    expect(after.length).toBe(before.length)
  })

  it('captures into quarantine without touching navigation', async () => {
    const before = await validate(bank)
    await create(bank, {
      docKind: 'engineering',
      path: 'stat-sweep.md',
      title: 'Invalidation is a stat sweep',
      purpose: 'Captured in a session: the index is invalidated by mtime, so no watcher is needed.',
      inbox: true,
    })
    expect(bank.get('_inbox/stat-sweep.md')?.status).toBe('draft')
    expect((await validate(bank)).length).toBe(before.length)
  })
})
