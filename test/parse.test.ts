import { describe, expect, it } from 'vitest'
import { extractLinks, lenientFrontmatter, parseDoc, resolveFrom, splitFrontmatter } from '../src/parse.js'

describe('resolveFrom', () => {
  it('resolves against the document directory, not the bank root', () => {
    expect(resolveFrom('features/FT-1/brief.md', '../../domain/rules.md').resolved).toBe('domain/rules.md')
    expect(resolveFrom('domain/rules.md', 'model.md').resolved).toBe('domain/model.md')
  })

  it('flags targets that escape the bank root instead of calling them broken', () => {
    const edge = resolveFrom('backend/notes.md', '../../../other/memory_bank/flows/x.md')
    expect(edge.external).toBe(true)
    expect(edge.resolved).toBeNull()
  })

  it('drops anchors', () => {
    expect(resolveFrom('a/b.md', '../c.md#section-two').resolved).toBe('c.md')
  })
})

describe('parseDoc', () => {
  const raw = [
    '---',
    'title: Domain Rules',
    'doc_kind: domain',
    'doc_function: canonical',
    'purpose: Canonical filter thresholds.',
    'derived_from:',
    '  - ../dna/principles.md',
    '  - path: ../adr/ADR-001.md',
    '    fit: "Only the accepted decision."',
    'canonical_for:',
    '  - filter_thresholds',
    'status: active',
    '---',
    '',
    '# Domain Rules',
    '',
    '## Thresholds',
    '',
    'text',
    '',
    '```md',
    '## Not A Real Heading',
    '```',
    '',
    '## Invariants',
  ].join('\n')

  const doc = parseDoc('domain/rules.md', raw, 1)

  it('reads both derived_from shapes', () => {
    expect(doc.derivedFrom).toHaveLength(2)
    expect(doc.derivedFrom[0]!.resolved).toBe('dna/principles.md')
    expect(doc.derivedFrom[1]!.fit).toBe('Only the accepted decision.')
    expect(doc.derivedFrom[1]!.resolved).toBe('adr/ADR-001.md')
  })

  it('collects level-two headings and ignores fenced ones', () => {
    expect(doc.sections.map((s) => s.title)).toEqual(['Thresholds', 'Invariants'])
  })

  it('assigns the knowledge layer from the top directory', () => {
    expect(doc.layer).toBe('knowledge')
  })

  it('falls back from a missing title to the first H1', () => {
    const noTitle = parseDoc('x/y.md', '---\nstatus: active\n---\n\n# Real Heading\n', 1)
    expect(noTitle.title).toBe('Real Heading')
  })

  it('falls back to the filename when there is no H1 either', () => {
    expect(parseDoc('x/only-name.md', '---\nstatus: active\n---\n\ntext\n', 1).title).toBe('only-name')
  })
})

describe('lenient frontmatter', () => {
  const raw = [
    '---',
    'title: Broken',
    'doc_kind: engineering',
    'purpose: Defines the retry layer: backoff and jitter.',
    'derived_from:',
    '  - ../dna/principles.md',
    '  - path: ../adr/ADR-002.md',
    '    fit: "narrow"',
    'canonical_for:',
    '  - retry_policy',
    'status: active',
    '---',
    '',
    '# Broken',
    '',
    '## Backoff',
  ].join('\n')

  it('recovers metadata from frontmatter that YAML rejects', () => {
    const doc = parseDoc('engineering/retry.md', raw, 1)
    expect(doc.parseError).toBeTruthy()
    expect(doc.docKind).toBe('engineering')
    expect(doc.canonicalFor).toEqual(['retry_policy'])
    expect(doc.status).toBe('active')
    expect(doc.derivedFrom.map((e) => e.resolved)).toEqual(['dna/principles.md', 'adr/ADR-002.md'])
    expect(doc.derivedFrom[1]!.fit).toBe('narrow')
    expect(doc.sections.map((s) => s.title)).toEqual(['Backoff'])
  })

  it('keeps the unquoted colon value rather than dropping the field', () => {
    const { data } = lenientFrontmatter(raw)
    expect(data['purpose']).toBe('Defines the retry layer: backoff and jitter.')
  })
})

describe('repeated parsing of invalid frontmatter', () => {
  const raw = ['---', 'purpose: Defines the retry layer: backoff.', 'status: active', '---', '', '# Body'].join(
    '\n',
  )

  it('stays deterministic across calls', () => {
    // gray-matter memoises by content when called without options, and returns a cached result
    // after a throw whose `content` is the entire file. Every call must behave the same.
    for (let i = 0; i < 3; i++) {
      const split = splitFrontmatter(raw)
      expect(split.error).toBeTruthy()
      expect(split.body.trim()).toBe('# Body')
      expect(split.data['status']).toBe('active')
    }
  })
})

describe('extractLinks', () => {
  it('finds links in bullets, table rows, prose and numbered items alike', () => {
    const raw = [
      '- [`a.md`](a.md)',
      '| x | [b](sub/b.md) |',
      'see [c](../c.md) for more',
      '1. [d](d.md#anchor)',
    ].join('\n')
    const links = extractLinks('dir/README.md', raw)
    expect(links.map((l) => l.to)).toEqual(['dir/a.md', 'dir/sub/b.md', 'c.md', 'dir/d.md'])
  })
})
