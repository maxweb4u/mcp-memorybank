/**
 * B-09. `bank_init` used to write eleven section registries. Measured across four banks —
 * `ebook_parser`, `tasman/research`, `idelo`, `focusreminder` — three of them (`epics`, `prd`,
 * `prompts`) were index-only in every single one, while four sections carried nearly everything.
 *
 * Dropping them from the seed is only safe if the property that justified seeding still holds: a
 * first document of any kind lands in a registered home, reachable from the root. These tests are
 * about that property, not about the smaller skeleton.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { create, registerSection } from '../src/create.js'
import { validate } from '../src/validate.js'

let dir: string
let bank: Bank
const made: string[] = []

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-sections-'))
  made.push(dir)
  bank = new Bank(path.join(dir, 'memory_bank'))
  await init(bank, { name: 'Sections' })
  await bank.refresh()
})

afterAll(async () => {
  await Promise.all(made.map((d) => fs.rm(d, { recursive: true, force: true })))
})

const root = (): string => bank.raw('README.md') ?? ''

describe('what bank_init now seeds', () => {
  it('writes the eight sections the evidence supports and not the three it does not', async () => {
    const seeded = bank
      .all()
      .filter((d) => d.path.endsWith('/README.md') && d.path.split('/').length === 2)
      .map((d) => d.path.split('/')[0]!)
      // dna/ and flows/ have indexes too, but they come from the starter set, not from SECTIONS.
      .filter((d) => d !== 'dna' && d !== 'flows')
      .sort()

    expect(seeded).toEqual(['adr', 'domain', 'engineering', 'features', 'ops', 'processes', 'product', 'use-cases'])
    expect(seeded).not.toContain('epics')
    expect(seeded).not.toContain('prd')
    expect(seeded).not.toContain('prompts')
  })

  it('lists exactly what it created in the root index, and nothing it did not', () => {
    expect(root()).toContain('(processes/README.md)')
    expect(root()).not.toContain('(epics/README.md)')
    expect(root()).not.toContain('(prd/README.md)')
  })

  it('still validates clean', async () => {
    expect(await validate(bank)).toEqual([])
  })
})

describe('a first document in a section that was not seeded', () => {
  it('gets its section index built in the same operation', async () => {
    const result = await create(bank, {
      path: 'epics/EP-01/charter.md',
      docKind: 'epic',
      title: 'First Epic',
      purpose: 'Larger than one delivery unit.',
      derivedFrom: ['../../dna/principles.md'],
      body: 'Body.',
    })

    expect(bank.get('epics/README.md')).toBeDefined()
    expect(result.registeredIn).toContain('epics/README.md')
    expect(bank.raw('epics/README.md')).toContain('EP-01/charter.md')
  })

  it('says so, rather than creating a directory silently', async () => {
    const result = await create(bank, {
      path: 'prompts/PROMPT-01.md',
      docKind: 'prompt',
      title: 'A Prompt',
      purpose: 'Part of the project, not of one session.',
      derivedFrom: ['../dna/principles.md'],
      body: 'Body.',
    })
    expect(result.warnings.join(' ')).toContain('prompts/README.md')
  })

  it('makes the new section reachable from the root index', async () => {
    await create(bank, {
      path: 'epics/EP-01/charter.md',
      docKind: 'epic',
      title: 'First Epic',
      purpose: 'Larger than one delivery unit.',
      derivedFrom: ['../../dna/principles.md'],
      body: 'Body.',
    })
    expect(root()).toContain('(epics/README.md)')
  })

  it('leaves the bank validating clean afterwards', async () => {
    await create(bank, {
      path: 'epics/EP-01/charter.md',
      docKind: 'epic',
      title: 'First Epic',
      purpose: 'Larger than one delivery unit.',
      derivedFrom: ['../../dna/principles.md'],
      body: 'Body.',
    })
    expect(await validate(bank)).toEqual([])
  })

  it('builds the section once, not once per document', async () => {
    for (const n of ['EP-01', 'EP-02']) {
      await create(bank, {
        path: `epics/${n}/charter.md`,
        docKind: 'epic',
        title: `Epic ${n}`,
        purpose: 'Another one.',
        derivedFrom: ['../../dna/principles.md'],
        body: 'Body.',
      })
    }
    expect(root().match(/\(epics\/README\.md\)/g)).toHaveLength(1)
    expect(bank.raw('epics/README.md')).toContain('EP-01')
    expect(bank.raw('epics/README.md')).toContain('EP-02')
  })

  it('does nothing for a directory the server does not know', async () => {
    await create(bank, {
      path: 'inventions/thing.md',
      docKind: 'engineering',
      title: 'Invented',
      purpose: 'A directory nobody declared.',
      derivedFrom: ['../dna/principles.md'],
      body: 'Body.',
    })
    expect(bank.get('inventions/README.md')).toBeUndefined()
  })

  it('does not touch the bank on a dry run, but says what it would do', async () => {
    const result = await create(bank, {
      path: 'prd/PRD-01.md',
      docKind: 'prd',
      title: 'A PRD',
      purpose: 'Scope inherited by a feature package.',
      derivedFrom: ['../dna/principles.md'],
      body: 'Body.',
      dryRun: true,
    })
    expect(result.warnings.join(' ')).toContain('prd/README.md')
    expect(bank.get('prd/README.md')).toBeUndefined()
  })
})

describe('registerSection', () => {
  const ROOT = [
    '# Documentation Index',
    '',
    '## Annotated Index',
    '',
    '- [`product/README.md`](product/README.md)',
    '  Read when you need the problem.',
    '- [`adr/README.md`](adr/README.md)',
    '  Read when you need a decision.',
    '',
    '- [`flows/README.md`](flows/README.md)',
    '  Read when you need a template.',
    '',
    '## Task-Specific Routes',
    '',
    '| Task | Route |',
    '| --- | --- |',
    '| Starting a feature | [`flows/feature-flow.md`](flows/feature-flow.md) |',
    '',
  ].join('\n')

  it('inserts among the sections, not after flows/ and not into the task table', () => {
    const out = registerSection(ROOT, 'epics', 'Read when work spans several features.')
    const lines = out.split('\n')
    const epics = lines.findIndex((l) => l.includes('(epics/README.md)'))
    const flows = lines.findIndex((l) => l.includes('(flows/README.md)'))
    const table = lines.findIndex((l) => l.startsWith('| Task'))

    expect(epics).toBeGreaterThan(lines.findIndex((l) => l.includes('(adr/README.md)')))
    expect(epics).toBeLessThan(flows)
    expect(epics).toBeLessThan(table)
    expect(lines[epics + 1]).toBe('  Read when work spans several features.')
  })

  it('copies whether the existing entries backtick their labels', () => {
    const plain = ROOT.replace(/\[`([a-z-]+)\/README\.md`\]/g, '[$1/README.md]')
    expect(registerSection(plain, 'epics', 'Route.')).toContain('- [epics/README.md](epics/README.md)')
    expect(registerSection(ROOT, 'epics', 'Route.')).toContain('- [`epics/README.md`](epics/README.md)')
  })

  it('is a no-op when the section is already listed', () => {
    expect(registerSection(ROOT, 'adr', 'Route.')).toBe(ROOT)
  })

  it('leaves an index it does not recognise alone rather than guessing', () => {
    const odd = '# Index\n\nNothing that looks like a section entry.\n'
    expect(registerSection(odd, 'epics', 'Route.')).toBe(odd)
  })
})
