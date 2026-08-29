import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { validate, type Finding } from '../src/validate.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')

let bank: Bank
let findings: Finding[]
const of = (rule: string) => findings.filter((f) => f.rule === rule)

beforeAll(async () => {
  bank = new Bank(FIXTURE)
  await bank.refresh()
  findings = await validate(bank)
})

describe('rules that fire on the fixture', () => {
  it('reports the broken edge and not the external one', () => {
    expect(of('broken-derived-from').map((f) => f.path)).toEqual(['engineering/architecture.md'])
    expect(of('broken-derived-from')[0]!.message).toContain('../missing/nowhere.md')
    // features/FT-001/brief.md points outside the root on purpose.
    expect(findings.some((f) => f.message.includes('outside-bank'))).toBe(false)
  })

  it('reports the second owner of a fact', () => {
    const conflict = of('ssot-conflict')
    expect(conflict).toHaveLength(1)
    expect(conflict[0]!.message).toContain('filter_thresholds')
    expect(conflict[0]!.message).toContain('conflict.md')
  })

  it('reports the document that no index links to', () => {
    expect(of('unregistered-doc').map((f) => f.path)).toEqual(['orphan.md'])
  })

  it('reports frontmatter that YAML rejects', () => {
    expect(of('invalid-frontmatter').map((f) => f.path)).toEqual(['broken/bad-yaml.md'])
  })

  it('is ordered by measured productivity, errors readable first', () => {
    const rules = [...new Set(findings.map((f) => f.rule))]
    expect(rules.indexOf('invalid-frontmatter')).toBeLessThan(rules.indexOf('ssot-conflict'))
  })
})

describe('rules that stay silent when they should', () => {
  it('does not invent a missing-derived-from finding for the declared root', () => {
    expect(of('missing-derived-from').map((f) => f.path)).not.toContain('dna/principles.md')
  })

  it('finds no cycle in an acyclic bank', () => {
    expect(of('cycle-in-derived-from')).toEqual([])
  })

  it('finds no must_not_define violation when the sets do not intersect', () => {
    expect(of('must-not-define-violated')).toEqual([])
  })

  it('finds no dangling index entry when every link resolves', () => {
    expect(of('dangling-index-entry')).toEqual([])
  })

  it('accepts every value the bank itself declares', () => {
    expect(of('unknown-enum-value')).toEqual([])
  })
})

describe('rules driven by what governance actually states', () => {
  it('applies missing-derived-from where governance requires it, exempting the root', async () => {
    expect(bank.contract.requiresDerivedFrom).toBe(true)
    // Every fixture document declares derived_from, and principles.md is the declared root.
    expect(of('missing-derived-from')).toEqual([])
  })

  it('applies the cycle rule only where governance forbids cycles', () => {
    expect(bank.contract.forbidsCycles).toBe(true)
  })

  it('says so instead of validating when the bank has no dna/', async () => {
    const noDna = new Bank(path.join(FIXTURE, 'domain'))
    await noDna.refresh()
    const out = await validate(noDna)
    expect(out.map((f) => f.rule)).toContain('no-contract')
    // Structural rules still run without a contract.
    expect(out.every((f) => ['no-contract', 'unregistered-doc'].includes(f.rule))).toBe(true)
  })
})

describe('filters', () => {
  it('narrows to a subdirectory', async () => {
    const scoped = await validate(bank, { scope: 'engineering' })
    expect(scoped.every((f) => f.path.startsWith('engineering/'))).toBe(true)
    expect(scoped.some((f) => f.rule === 'broken-derived-from')).toBe(true)
  })

  it('narrows to a severity and to a rule', async () => {
    expect((await validate(bank, { severity: 'warning' })).every((f) => f.severity === 'warning')).toBe(true)
    expect((await validate(bank, { rule: 'ssot-conflict' })).map((f) => f.rule)).toEqual(['ssot-conflict'])
  })
})
