import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { route } from '../src/route.js'
import { SearchIndex, search, searchTokens } from '../src/search.js'
import { expandTerms, hasCyrillic, stemOf, termFor, WHY_INTENT } from '../src/lang.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')
let bank: Bank
let index: SearchIndex

beforeAll(async () => {
  bank = new Bank(FIXTURE)
  await bank.refresh()
  index = new SearchIndex()
  index.sync(bank)
})

describe('stemming', () => {
  it('reduces an inflected word to the dictionary key', () => {
    for (const form of ['порог', 'пороги', 'порогов', 'порогам', 'порогами']) {
      expect(stemOf(form)).toBe('порог')
    }
  })

  it('prefers the longer key when two would prefix the word', () => {
    // 'реш' would also match, and would send a filtering question to the decision layer.
    expect(stemOf('решение')).toBe('реш')
    expect(stemOf('фильтрации')).toBe('фильтр')
  })

  it('strips a verbal prefix, but only when what remains is a known key', () => {
    expect(stemOf('задеплоить')).toBe('депло')
    expect(stemOf('переразвертывание')).toBe('разверт')
    expect(stemOf('запонтоваться')).toBeUndefined()
  })

  it('leaves latin words alone', () => {
    expect(stemOf('thresholds')).toBeUndefined()
    expect(hasCyrillic('thresholds')).toBe(false)
    expect(hasCyrillic('пороги')).toBe(true)
  })
})

describe('terms', () => {
  it('carries the english equivalents of a russian word', () => {
    expect(termFor('фильтрации')).toEqual({
      literal: 'фильтрации',
      translations: ['filter', 'filtering'],
      stem: 'фильтр',
    })
  })

  it('works in the other direction too', () => {
    expect(termFor('threshold').translations).toContain('порог')
  })

  it('leaves an unknown word as itself, with nothing added', () => {
    expect(termFor('kubernetes')).toEqual({ literal: 'kubernetes', translations: [] })
    expect(expandTerms(['kubernetes', 'пороги'])).toHaveLength(2)
  })
})

describe('why-intent', () => {
  it.each(['why did we', 'the rationale', 'trade-off', 'почему так', 'зачем это', 'обоснование'])(
    'recognises "%s"',
    (question) => expect(WHY_INTENT.test(question)).toBe(true),
  )

  it('does not fire on a plain lookup', () => {
    expect(WHY_INTENT.test('filter thresholds')).toBe(false)
    expect(WHY_INTENT.test('где пороги')).toBe(false)
  })
})

describe('routing a russian question at an english bank', () => {
  const paths = (question: string) => route(bank, question, { limit: 5 }).map((r) => r.path)

  it('reaches the canonical owner exactly as the english question does', () => {
    expect(paths('где пороги фильтрации')[0]).toBe('domain/rules.md')
    expect(paths('filter thresholds')[0]).toBe('domain/rules.md')
  })

  it('sends a why-question to the decision layer', () => {
    expect(paths('почему выбрана эта очередь')[0]).toBe('adr/ADR-001-queue-choice.md')
  })

  it('drops russian question words instead of matching on them', () => {
    // 'что', 'как', 'где' carry no content; if they scored, every document would match.
    expect(route(bank, 'что как где', { limit: 5 })).toEqual([])
  })

  it('explains the hit with the word that actually matched', () => {
    const [top] = route(bank, 'где пороги фильтрации', { limit: 1 })
    expect(top!.why).toContain('filter_thresholds')
  })
})

describe('search across languages', () => {
  it('keeps cyrillic as word characters instead of separators', () => {
    // 'и' is dropped as a one-character token, the same as any latin single letter.
    expect(searchTokens('пороги фильтрации и thresholds')).toEqual([
      'пороги',
      'фильтрации',
      'thresholds',
    ])
  })

  it('finds an english document from a russian query', () => {
    const hits = search(bank, index, 'пороги', { limit: 5 }).map((h) => h.path)
    expect(hits).toContain('domain/rules.md')
  })

  it('leaves an identifier query untouched — no translation applies', () => {
    expect(termFor('filter_thresholds').translations).toEqual([])
    // Both owners of the key still surface; the fixture declares the conflict on purpose.
    const hits = search(bank, index, 'filter_thresholds', { limit: 5 }).map((h) => h.path)
    expect(hits).toContain('domain/rules.md')
    expect(hits).toContain('conflict.md')
  })
})
