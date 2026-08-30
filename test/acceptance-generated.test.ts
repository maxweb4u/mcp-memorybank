/**
 * Acceptance criteria from implementation-plan.md, run against a bank this build generates.
 *
 * The corpus suite in `acceptance.test.ts` measures the real banks, which is where every design
 * decision came from — but those banks live outside the repository, they change under us, and in CI
 * they are simply absent, so that suite skips and proves nothing. This one seeds a bank with the
 * current `bank_init`, fills it through `bank_create` only, and then runs the same criteria against
 * the result. It needs nothing but a temp directory and git, so it is the suite that has to stay
 * green.
 *
 * It also carries the strongest claim in field-test.md: a bank built entirely through the server
 * stays clean by construction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { create } from '../src/create.js'
import { validate } from '../src/validate.js'
import { route } from '../src/route.js'
import { read } from '../src/read.js'
import { graph } from '../src/graph.js'
import { changed } from '../src/changed.js'
import { SearchIndex, search } from '../src/search.js'

const run = promisify(execFile)

const ADR = 'adr/ADR-20260830T120000Z-two-formats-one-model.md'
const FEATURE = 'features/FT-01-extract-package/brief.md'

/** Modelled on the fill-in table of field-test.md, so the suite exercises what the plan prescribes. */
const DOCUMENTS = [
  {
    docKind: 'domain', path: 'domain/model.md', title: 'Document Model',
    purpose: 'Canonical model both parsers produce: document, chapter, paragraph.',
    derivedFrom: ['../product/context.md'], canonicalFor: ['document_model'], status: 'active',
  },
  {
    docKind: 'domain', path: 'domain/rules.md', title: 'Parsing Rules',
    purpose: 'Canonical filter thresholds and the invariants every parser enforces.',
    derivedFrom: ['model.md'], canonicalFor: ['filter_thresholds'], status: 'active',
  },
  {
    docKind: 'engineering', path: 'engineering/architecture.md', title: 'Architecture',
    purpose: 'How the package is laid out: entry points, the two format readers, the shared model.',
    derivedFrom: ['../domain/model.md', '../domain/rules.md'], canonicalFor: ['package_layout'], status: 'active',
  },
  {
    docKind: 'adr', path: ADR, title: 'Two Formats, One Model',
    purpose: 'Why EPUB and FB2 are read into one model instead of two parallel type hierarchies.',
    derivedFrom: ['../domain/model.md'], status: 'active',
  },
  {
    docKind: 'feature', path: FEATURE, title: 'FT-01 Extract Package',
    purpose: 'Extracting the parser out of TeaderBook into a standalone package.',
    derivedFrom: ['../../engineering/architecture.md'], status: 'active',
  },
]

let repo: string
let bank: Bank
let index: SearchIndex
let seeded: number

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-generated-'))
  bank = new Bank(path.join(repo, 'memory_bank'))
  await bank.refresh()

  await init(bank, { name: 'ebook_parser' })
  seeded = bank.all().length

  for (const doc of DOCUMENTS) await create(bank, doc)

  const git = (...args: string[]) => run('git', ['-C', repo, ...args])
  await git('init', '-q')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'test')
  await git('add', '-A')
  await git('commit', '-qm', 'seed the bank')

  // One document after the commit, so the delta has something true to report.
  await create(bank, {
    docKind: 'domain', path: 'domain/glossary.md', title: 'Glossary',
    purpose: 'Terms shared by both readers.', derivedFrom: ['model.md'], status: 'active',
  })

  index = new SearchIndex()
  index.sync(bank)
}, 30_000)

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

describe('the bank this build generates', () => {
  it('seeds a complete skeleton and a readable contract', () => {
    expect(seeded).toBe(50)
    expect(bank.contract.present).toBe(true)
    expect(bank.contract.requiresDerivedFrom).toBe(true)
  })

  it('stays clean after being filled through the server only', async () => {
    expect(bank.all()).toHaveLength(seeded + DOCUMENTS.length + 1)
    expect(await validate(bank)).toEqual([])
  })

  it('registers every created document in its section index', () => {
    expect(bank.get('domain/model.md')!.registeredIn).toEqual(['domain/README.md'])
    expect(bank.get(ADR)!.registeredIn).toEqual(['adr/README.md'])
    expect(bank.get(FEATURE)!.registeredIn).toEqual(['features/README.md'])
  })

  it('uses a template where the starter has one, and says so where it does not', async () => {
    const withTemplate = await create(bank, {
      docKind: 'adr', path: 'adr/ADR-20260830T130000Z-streaming-reads.md', title: 'Streaming Reads',
      purpose: 'Why chapters are streamed rather than materialised.', derivedFrom: ['../domain/model.md'],
      dryRun: true,
    })
    expect(withTemplate.template).toBe('flows/templates/adr/ADR-ID.md')

    const withoutTemplate = await create(bank, {
      docKind: 'domain', path: 'domain/states.md', title: 'States', purpose: 'Reader states.',
      derivedFrom: ['model.md'], dryRun: true,
    })
    expect(withoutTemplate.template).toBeNull()
    expect(withoutTemplate.warnings.join(' ')).toMatch(/No template matched doc_kind "domain"/)
  })
})

describe('E1 — routing over what was just written', () => {
  const paths = (question: string, limit = 3) => route(bank, question, { limit }).map((r) => r.path)

  it('puts the canonical owner first', () => {
    expect(paths('filter thresholds')[0]).toBe('domain/rules.md')
    expect(paths('package layout')[0]).toBe('engineering/architecture.md')
  })

  it('answers the same question asked in russian', () => {
    expect(paths('где пороги фильтрации')[0]).toBe('domain/rules.md')
    expect(paths('почему два формата одна модель')[0]).toBe(ADR)
    expect(paths('why two formats one model')[0]).toBe(ADR)
  })

  it('ranks knowledge above the delivery journal', () => {
    const top = paths('package layout', 2)
    expect(top.indexOf('engineering/architecture.md')).toBeLessThan(top.indexOf(FEATURE))
  })

  it('never surfaces one of the 23 starter templates', () => {
    const templates = bank.all().filter((d) => d.docFunction === 'template')
    expect(templates.length).toBeGreaterThan(20)
    const names = new Set(templates.map((d) => d.path))
    for (const question of ['feature flow gates', 'record a decision', 'filter thresholds']) {
      expect(route(bank, question, { limit: 10 }).filter((r) => names.has(r.path))).toEqual([])
    }
  })

  it('reads one section instead of the whole document', async () => {
    const doc = bank.get('dna/governance.md')!
    const section = await read(bank, doc.path, doc.sections[0]!.title)
    const whole = await read(bank, doc.path)
    expect(section.content.length).toBeLessThan(whole.content.length / 2)
  })
})

describe('E2 — the gates that keep it clean', () => {
  it('refuses a second owner of a fact', async () => {
    await expect(
      create(bank, {
        docKind: 'domain', path: 'domain/dupe.md', title: 'Dupe', purpose: 'Claims a taken key.',
        derivedFrom: ['model.md'], canonicalFor: ['document_model'],
      }),
    ).rejects.toThrow(/already owned by domain\/model\.md/)
  })

  it('refuses an upstream that does not resolve', async () => {
    await expect(
      create(bank, {
        docKind: 'domain', path: 'domain/nowhere.md', title: 'Nowhere', purpose: 'Points at nothing.',
        derivedFrom: ['../does-not-exist.md'],
      }),
    ).rejects.toThrow(/does not resolve to a document of this bank/)
  })

  it('refuses a path that leaves the bank', async () => {
    await expect(
      create(bank, {
        docKind: 'domain', path: '../escape.md', title: 'Escape', purpose: 'Outside.',
        derivedFrom: ['dna/governance.md'],
      }),
    ).rejects.toThrow(/must stay inside the bank/)
  })

  it('leaves nothing behind after three refusals', async () => {
    expect(await validate(bank)).toEqual([])
  })
})

describe('E3 — the graph over edges the server wrote', () => {
  it('answers "what breaks if I change the model"', () => {
    const down = graph(bank, 'domain/model.md', { direction: 'down', depth: 3 })
    expect(down.nodes.filter((n) => n.depth > 0).map((n) => n.path)).toEqual([
      ADR,
      'domain/glossary.md',
      'domain/rules.md',
      'engineering/architecture.md',
      FEATURE,
    ])
    expect(down.broken).toEqual([])
  })

  it('walks a feature back up to the governance it rests on', () => {
    const up = graph(bank, FEATURE, { direction: 'up', depth: 5 })
    expect(up.nodes.map((n) => n.path)).toContain('dna/governance.md')
    expect(up.broken).toEqual([])
  })
})

describe('E4 — search and delta', () => {
  it('finds a term in the body of a seeded document', () => {
    expect(search(bank, index, 'frontmatter', { limit: 3 })[0]?.path).toBe('dna/frontmatter.md')
  })

  it('ranks a russian query exactly as its english equivalent', () => {
    const ru = search(bank, index, 'модель', { limit: 3 }).map((h) => h.path)
    const en = search(bank, index, 'model', { limit: 3 }).map((h) => h.path)
    expect(ru).toEqual(en)
    expect(ru[0]).toBe(ADR)
  })

  it('reports the delta against git, including the index it had to touch', async () => {
    const delta = await changed(bank, 'HEAD')
    expect(delta.mode).toBe('git')
    const byPath = new Map(delta.changes.map((c) => [c.path, c.changeKind]))
    expect(byPath.get('domain/glossary.md')).toBe('added')
    expect(byPath.get('domain/README.md')).toBe('modified')
  })

  it('rejects a ref that does not exist instead of returning an empty delta', async () => {
    await expect(changed(bank, 'no-such-ref-here')).rejects.toThrow(/not a commit/i)
  })
})
