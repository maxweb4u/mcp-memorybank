import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { read } from '../src/read.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')

let bank: Bank

beforeAll(async () => {
  bank = new Bank(FIXTURE)
  await bank.refresh()
})

describe('index', () => {
  it('indexes every markdown file', () => {
    expect(bank.all()).toHaveLength(17)
  })

  it('keeps documents whose YAML is invalid, with the error recorded', () => {
    const broken = bank.get('broken/bad-yaml.md')!
    expect(broken.parseError).toBeTruthy()
    expect(broken.purpose).toContain('retry layer')
    expect(broken.canonicalFor).toEqual(['retry_policy'])
  })

  it('builds the reverse edge map', () => {
    expect(bank.incoming.get('domain/rules.md')).toEqual(
      expect.arrayContaining(['engineering/architecture.md', 'features/FT-001/brief.md']),
    )
  })

  it('carries fit through the edge', () => {
    const brief = bank.get('features/FT-001/brief.md')!
    const withFit = brief.derivedFrom.find((e) => e.fit)
    expect(withFit?.resolved).toBe('adr/ADR-001-queue-choice.md')
    expect(withFit?.fit).toContain('queue topology')
  })

  it('marks a reference outside the root as external, not broken', () => {
    const brief = bank.get('features/FT-001/brief.md')!
    const outside = brief.derivedFrom.find((e) => e.external)
    expect(outside?.raw).toBe('../../../outside-bank/upstream.md')
    expect(outside?.resolved).toBeNull()
  })

  it('detects a broken edge inside the root', () => {
    const arch = bank.get('engineering/architecture.md')!
    const broken = arch.derivedFrom.find((e) => !e.external && !bank.docs.has(e.resolved!))
    expect(broken?.raw).toBe('../missing/nowhere.md')
  })

  it('collects owners per canonical_for key and exposes the conflict', () => {
    expect(bank.ownerByKey.get('filter_thresholds')).toEqual(
      expect.arrayContaining(['domain/rules.md', 'conflict.md']),
    )
  })

  it('records registration from indexes in every link shape', () => {
    expect(bank.get('engineering/architecture.md')!.registeredIn).toContain('README.md') // table row
    expect(bank.get('adr/ADR-001-queue-choice.md')!.registeredIn).toContain('adr/README.md') // table row
    expect(bank.get('features/FT-001/brief.md')!.registeredIn).toContain('README.md') // prose
    expect(bank.get('broken/bad-yaml.md')!.registeredIn).toContain('README.md') // numbered
    expect(bank.get('domain/rules.md')!.registeredIn).toContain('domain/README.md') // bullet
  })

  it('leaves an unregistered document with no index', () => {
    expect(bank.get('orphan.md')!.registeredIn).toEqual([])
  })
})

describe('contract', () => {
  it('is read from the bank rather than hardcoded', () => {
    expect(bank.contract.present).toBe(true)
    expect([...bank.contract.docKinds].sort()).toEqual(['adr', 'domain', 'engineering', 'feature', 'governance'])
    expect([...bank.contract.docFunctions].sort()).toEqual(['canonical', 'index', 'template'])
    expect([...bank.contract.statuses].sort()).toEqual(['active', 'archived', 'draft'])
    expect([...bank.contract.roots]).toEqual(['dna/principles.md'])
  })

  it('reports absence instead of guessing when there is no dna/', async () => {
    const empty = new Bank(path.join(FIXTURE, 'domain'))
    await empty.refresh()
    expect(empty.contract.present).toBe(false)
  })
})

describe('refresh', () => {
  it('re-reads only what changed', async () => {
    const quiet = await bank.refresh()
    expect(quiet).toMatchObject({ added: 0, changed: 0, removed: 0 })

    const target = path.join(FIXTURE, 'orphan.md')
    const before = await fs.readFile(target, 'utf8')
    await fs.writeFile(target, before.replace('Nothing links here.', 'Still nothing links here.'))
    try {
      const after = await bank.refresh()
      expect(after).toMatchObject({ added: 0, changed: 1, removed: 0 })
    } finally {
      await fs.writeFile(target, before)
      await bank.refresh()
    }
  })
})

describe('read', () => {
  it('returns one section instead of the whole document', async () => {
    const whole = await read(bank, 'domain/rules.md')
    const section = await read(bank, 'domain/rules.md', 'Thresholds')
    expect(section.section).toBe('Thresholds')
    expect(section.content).toContain('L1 rejects below 60.')
    expect(section.content).not.toContain('evaluated before scoring')
    expect(section.bytes).toBeLessThan(whole.bytes)
  })

  it('lists the available sections when the requested one is absent', async () => {
    await expect(read(bank, 'domain/rules.md', 'Nope')).rejects.toThrow(/Available: Thresholds \| Invariants/)
  })

  it('refuses a path outside the bank', async () => {
    await expect(read(bank, '../secret.md')).rejects.toThrow(/Not a document of this bank/)
  })
})
