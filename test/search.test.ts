import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { SearchIndex, search, searchTokens, tokenParts } from '../src/search.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')
let bank: Bank
let index: SearchIndex

beforeAll(async () => {
  bank = new Bank(FIXTURE)
  await bank.refresh()
  index = new SearchIndex()
  index.sync(bank)
})

const paths = (query: string, limit = 10) =>
  search(bank, index, query, { limit }).map((h) => h.path)

describe('tokenizer', () => {
  it('keeps identifiers whole', () => {
    expect(searchTokens('See FT-SMD-843 and filter_thresholds.')).toEqual([
      'see',
      'ft-smd-843',
      'and',
      'filter_thresholds',
    ])
  })

  it('exposes the parts of a compound separately', () => {
    expect(tokenParts('ft-smd-843')).toEqual(['ft', 'smd', '843'])
    expect(tokenParts('thresholds')).toEqual([])
  })
})

describe('search', () => {
  it('finds a literal that no purpose mentions', () => {
    // "L1 rejects below 60" lives only in the body of domain/rules.md.
    expect(paths('rejects below 60')).toEqual(['domain/rules.md'])
  })

  it('narrows on every term rather than widening', () => {
    const both = paths('exponential backoff')
    expect(both).toEqual(['broken/bad-yaml.md'])
  })

  it('returns the matching line with its number', () => {
    const hit = search(bank, index, 'rejects below 60', { limit: 1 })[0]!
    expect(hit.excerpt).toBe('L1 rejects below 60.')
    expect(hit.line).toBeGreaterThan(0)
  })

  it('never returns a template', () => {
    expect(paths('placeholder')).not.toContain('flows/templates/feature/brief.md')
  })

  it('honours the filters', () => {
    expect(search(bank, index, 'thresholds', { layer: 'delivery' }).every((h) => h.layer === 'delivery')).toBe(
      true,
    )
    expect(search(bank, index, 'thresholds', { docKind: 'domain' }).every((h) => h.docKind === 'domain')).toBe(
      true,
    )
  })

  it('searches the body, not the frontmatter', () => {
    // `retry_policy` appears only as a canonical_for key, never in the prose.
    expect(paths('retry_policy')).toEqual([])
  })

  it('returns nothing for a term the bank does not contain', () => {
    expect(paths('kubernetes')).toEqual([])
  })
})

describe('incremental sync', () => {
  it('does no work when nothing changed', () => {
    const fresh = new SearchIndex()
    expect(fresh.sync(bank)).toBe(bank.docs.size)
    expect(fresh.sync(bank)).toBe(0)
  })

  it('indexes every document body', () => {
    expect(index.size).toBeGreaterThan(100)
  })
})
