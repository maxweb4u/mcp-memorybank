import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { route } from '../src/route.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')
let bank: Bank

beforeAll(async () => {
  bank = new Bank(FIXTURE)
  await bank.refresh()
})

const paths = (question: string, limit = 5) => route(bank, question, { limit }).map((r) => r.path)

describe('route', () => {
  it('puts the canonical owner first when the question covers its key', () => {
    expect(paths('filter thresholds')[0]).toBe('domain/rules.md')
  })

  it('never returns templates, even when they match the words', () => {
    expect(paths('filter thresholds placeholders')).not.toContain('flows/templates/feature/brief.md')
    expect(route(bank, 'brief template', { limit: 20 }).map((r) => r.path)).not.toContain(
      'flows/templates/feature/brief.md',
    )
  })

  it('does not let one word of a compound key outrank a direct match', () => {
    // `humanization_rules` on domain/rules.md must not beat the document actually about frontmatter.
    const top = paths('frontmatter schema')[0]
    expect(top).toBe('dna/frontmatter.md')
  })

  it('prefers the decision layer for a why-question', () => {
    const withWhy = paths('why one shared queue instead of per-tenant queues')[0]
    expect(withWhy).toBe('adr/ADR-001-queue-choice.md')
  })

  it('damps the delivery layer against knowledge', () => {
    const results = route(bank, 'raise the filter threshold', { limit: 5 })
    const rules = results.findIndex((r) => r.path === 'domain/rules.md')
    const brief = results.findIndex((r) => r.path === 'features/FT-001/brief.md')
    expect(rules).toBeGreaterThanOrEqual(0)
    expect(brief).toBeGreaterThan(rules)
  })

  it('explains why each document matched', () => {
    const top = route(bank, 'filter thresholds', { limit: 1 })[0]!
    expect(top.why).toContain('owns canonical_for: filter_thresholds')
  })

  it('still routes a document whose YAML is invalid', () => {
    expect(paths('retry backoff jitter')[0]).toBe('broken/bad-yaml.md')
  })

  it('honours the layer and docKind filters', () => {
    expect(route(bank, 'queue', { layer: 'decision' }).every((r) => r.path.startsWith('adr/'))).toBe(true)
    expect(route(bank, 'thresholds', { docKind: 'feature' }).every((r) => r.docKind === 'feature')).toBe(true)
  })

  it('returns nothing rather than noise for an unrelated question', () => {
    expect(paths('kubernetes ingress certificate rotation')).toEqual([])
  })
})
