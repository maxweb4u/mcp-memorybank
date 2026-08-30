import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { validate } from '../src/validate.js'
import { create } from '../src/create.js'
import { route } from '../src/route.js'

let root: string
let bank: Bank

beforeEach(async () => {
  root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-init-')), 'memory_bank')
  bank = new Bank(root)
  await bank.refresh()
})

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true })
})

describe('seeding an empty root', () => {
  it('creates the skeleton, the governance set and one index per section', async () => {
    const result = await init(bank, { name: 'ebook_parser' })

    expect(result.created).toBe(true)
    expect(result.directories).toEqual(
      expect.arrayContaining(['dna', 'flows', 'product', 'domain', 'engineering', 'ops', 'adr', 'features']),
    )
    expect(result.files).toEqual(
      expect.arrayContaining([
        'README.md',
        'dna/governance.md',
        'dna/frontmatter.md',
        'dna/principles.md',
        'flows/feature-flow.md',
        'flows/templates/adr/ADR-ID.md',
        'product/README.md',
        'engineering/README.md',
      ]),
    )
  })

  it('produces a bank the server can read: contract found, no degraded mode', async () => {
    await init(bank, { name: 'ebook_parser' })
    expect(bank.contract.present).toBe(true)
    expect(bank.contract.roots.has('dna/principles.md')).toBe(true)
    expect(bank.contract.requiresDerivedFrom).toBe(true)
    expect(bank.contract.forbidsCycles).toBe(true)
  })

  it('declares every doc_kind and doc_function the starter itself uses', async () => {
    await init(bank, { name: 'ebook_parser' })
    for (const doc of bank.all()) {
      if (doc.docKind) expect(bank.contract.docKinds.has(doc.docKind)).toBe(true)
      if (doc.docFunction) expect(bank.contract.docFunctions.has(doc.docFunction)).toBe(true)
    }
  })

  it('validates clean — the whole point of seeding rather than copying', async () => {
    await init(bank, { name: 'ebook_parser' })
    expect(await validate(bank)).toEqual([])
  })

  it('names the project in the root index', async () => {
    await init(bank, { name: 'ebook_parser' })
    const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8')
    expect(readme).toContain('**ebook_parser**')
  })

  it('registers the seeded drafts, so nothing lands outside navigation', async () => {
    await init(bank, { name: 'ebook_parser' })
    expect(bank.get('engineering/testing-policy.md')!.registeredIn).toEqual(['engineering/README.md'])
    expect(bank.get('product/context.md')!.registeredIn).toEqual(['product/README.md'])
    expect(bank.get('engineering/testing-policy.md')!.status).toBe('draft')
  })

  it('carries the rule the closure gate refers to, not just the path', async () => {
    await init(bank, { name: 'ebook_parser' })
    const policy = await fs.readFile(path.join(root, 'engineering/testing-policy.md'), 'utf8')
    expect(policy).toContain('## Simplify Review')
    expect(await validate(bank, { rule: 'unresolved-rule-reference' })).toEqual([])
  })
})

describe('refusals', () => {
  it('refuses to seed over an existing bank', async () => {
    await init(bank, { name: 'first' })
    await expect(init(bank, { name: 'second' })).rejects.toThrow(/already holds \d+ documents/)
  })

  it('seeds anyway with force, and says it did', async () => {
    await init(bank, { name: 'first' })
    const forced = await init(bank, { name: 'second', force: true })
    expect(forced.warnings.join(' ')).toMatch(/Seeding over \d+ existing documents/)
  })

  it('refuses an empty name', async () => {
    await expect(init(bank, { name: '  ' })).rejects.toThrow(/`name` is required/)
  })
})

describe('dry run', () => {
  it('lists what would be written and writes nothing', async () => {
    const result = await init(bank, { name: 'ebook_parser', dryRun: true })
    expect(result.created).toBe(false)
    expect(result.files).toContain('dna/governance.md')
    expect(result.files).toContain('README.md')
    await expect(fs.readdir(root)).rejects.toThrow()
  })
})

describe('the seeded bank is immediately usable', () => {
  it('accepts a first document through bank_create and stays clean', async () => {
    await init(bank, { name: 'ebook_parser' })

    await create(bank, {
      docKind: 'domain',
      path: 'domain/model.md',
      title: 'Document Model',
      purpose: 'Canonical model both parsers produce: document, chapter, paragraph.',
      derivedFrom: ['../product/context.md'],
      canonicalFor: ['document_model'],
      status: 'active',
    })

    expect(bank.get('domain/model.md')!.registeredIn).toEqual(['domain/README.md'])
    expect(await validate(bank)).toEqual([])
  })

  it('routes to the seeded governance instead of returning nothing', async () => {
    await init(bank, { name: 'ebook_parser' })
    expect(route(bank, 'frontmatter schema', { limit: 1 })[0]?.path).toBe('dna/frontmatter.md')
    expect(route(bank, 'how a feature package moves through its gates', { limit: 1 })[0]?.path).toBe(
      'flows/feature-flow.md',
    )
  })
})
