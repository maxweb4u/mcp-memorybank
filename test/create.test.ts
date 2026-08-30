import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { create, inbox, promote } from '../src/create.js'
import { validate } from '../src/validate.js'
import { splitFrontmatter } from '../src/parse.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')

let root: string
let bank: Bank

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-create-'))
  await fs.cp(FIXTURE, root, { recursive: true })
  bank = new Bank(root)
  await bank.refresh()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const read = (rel: string) => fs.readFile(path.join(root, rel), 'utf8')

describe('instantiating a wrapped template', () => {
  it('takes the frontmatter and body from the embedded contract, not the wrapper', async () => {
    const result = await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-002-cache-choice.md',
      title: 'ADR-002: Keep The Index In Memory',
      purpose: 'Records why the index is rebuilt from files instead of persisted.',
      derivedFrom: ['../engineering/architecture.md'],
    })

    expect(result.template).toBe('flows/templates/adr/ADR-ID.md')
    const raw = await read(result.path)
    const { data, body } = splitFrontmatter(raw)

    expect(data['doc_function']).toBe('canonical') // never the wrapper's `template`
    expect(data['title']).toBe('ADR-002: Keep The Index In Memory')
    expect(data['decision_status']).toBe('proposed')
    expect(data['must_not_define']).toEqual(['current_system_state']) // governance the template carries
    expect(data['template_for']).toBeUndefined()
    expect(data['template_target_path']).toBeUndefined()
    expect(body).toContain('## Context')
    expect(body).toContain('# ADR-002: Keep The Index In Memory')
    expect(body).not.toContain('This file describes the wrapper')
  })

  it('fills the date placeholder instead of writing YYYY-MM-DD into the bank', async () => {
    const result = await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-003-x.md',
      title: 'ADR-003: X',
      purpose: 'Records X.',
      derivedFrom: ['../engineering/architecture.md'],
    })
    expect(String(result.frontmatter['date'])).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('quotes a purpose containing a colon, so the result parses as YAML', async () => {
    // This is the exact defect found in 22 real documents.
    const result = await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-004-retry.md',
      title: 'ADR-004: Retry',
      purpose: 'Defines the retry layer: backoff, jitter, and the ceiling.',
      derivedFrom: ['../engineering/architecture.md'],
    })
    const parsed = splitFrontmatter(await read(result.path))
    expect(parsed.error).toBeUndefined()
    expect(parsed.data['purpose']).toBe('Defines the retry layer: backoff, jitter, and the ceiling.')
  })
})

describe('registration', () => {
  it('adds a table row to an index that uses a table', async () => {
    await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-005-y.md',
      title: 'ADR-005: Y',
      purpose: 'Records Y.',
      derivedFrom: ['../engineering/architecture.md'],
    })
    const index = await read('adr/README.md')
    const row = index.split('\n').find((l) => l.includes('ADR-005-y.md'))!
    expect(row.startsWith('|')).toBe(true)
    expect(row).toContain('[`ADR-005: Y`](ADR-005-y.md)')
    expect(row).toContain('Records Y.')
  })

  it('adds a bullet to an index that uses bullets', async () => {
    await create(bank, {
      docKind: 'domain',
      path: 'domain/limits.md',
      title: 'Domain Limits',
      purpose: 'Canonical limits.',
      derivedFrom: ['../dna/principles.md'],
    })
    const index = await read('domain/README.md')
    const line = index.split('\n').find((l) => l.includes('limits.md'))!
    expect(line.trim().startsWith('-')).toBe(true)
    expect(line).toContain('[`Domain Limits`](limits.md) — Canonical limits.')
  })

  it('reports where the document was registered', async () => {
    const result = await create(bank, {
      docKind: 'domain',
      path: 'domain/limits.md',
      title: 'Domain Limits',
      purpose: 'Canonical limits.',
      derivedFrom: ['../dna/principles.md'],
    })
    expect(result.registeredIn).toEqual(['domain/README.md'])
  })
})

describe('gates', () => {
  const base = {
    docKind: 'domain',
    path: 'domain/new.md',
    title: 'New',
    purpose: 'Purpose.',
    derivedFrom: ['../dna/principles.md'],
  }

  it('refuses to overwrite an existing document', async () => {
    await expect(create(bank, { ...base, path: 'domain/rules.md' })).rejects.toThrow(/Refusing to overwrite/)
  })

  it('refuses a derived_from that resolves nowhere', async () => {
    await expect(create(bank, { ...base, derivedFrom: ['../nowhere/none.md'] })).rejects.toThrow(
      /does not resolve/,
    )
  })

  it('refuses to claim a fact that already has an owner', async () => {
    await expect(create(bank, { ...base, canonicalFor: ['filter_thresholds'] })).rejects.toThrow(
      /already owned by conflict\.md, domain\/rules\.md/,
    )
  })

  it('refuses a path that leaves the bank or is not markdown', async () => {
    await expect(create(bank, { ...base, path: '../escape.md' })).rejects.toThrow(/must stay inside the bank/)
    await expect(create(bank, { ...base, path: 'domain/notes.txt' })).rejects.toThrow(/must end in .md/)
  })

  it('refuses an empty purpose, because routing ranks on it', async () => {
    await expect(create(bank, { ...base, purpose: '  ' })).rejects.toThrow(/`purpose` is required/)
  })

  it('refuses an active document with no upstream, when governance requires one', async () => {
    await expect(
      create(bank, { ...base, derivedFrom: [], status: 'active' }),
    ).rejects.toThrow(/requires every active non-root document/)
  })

  it('warns rather than refuses when a doc_kind is outside the declared contract', async () => {
    const result = await create(bank, { ...base, docKind: 'runbook' })
    expect(result.created).toBe(true)
    expect(result.warnings.join(' ')).toContain('doc_kind "runbook"')
  })
})

describe('dry run', () => {
  it('reports the outcome and writes nothing', async () => {
    const before = await read('adr/README.md')
    const result = await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-006-z.md',
      title: 'ADR-006: Z',
      purpose: 'Records Z.',
      derivedFrom: ['../engineering/architecture.md'],
      dryRun: true,
    })
    expect(result.created).toBe(false)
    expect(result.preview).toContain('ADR-006: Z')
    expect(result.registeredIn).toEqual(['adr/README.md'])
    await expect(read('adr/ADR-006-z.md')).rejects.toThrow()
    expect(await read('adr/README.md')).toBe(before)
  })
})

describe('inbox', () => {
  it('lands in quarantine as a draft, outside navigation and without a template', async () => {
    const result = await create(bank, {
      docKind: 'engineering',
      path: 'note-on-cache.md',
      title: 'Index invalidation costs a stat sweep',
      purpose: 'Captured in a session: invalidation is by mtime, so no watcher is needed.',
      inbox: true,
    })
    expect(result.path).toBe('_inbox/note-on-cache.md')
    expect(result.frontmatter['status']).toBe('draft')
    expect(result.template).toBeNull()
    expect(result.registeredIn).toEqual([])
    expect(bank.get('_inbox/note-on-cache.md')!.layer).toBe('inbox')
  })

  it('does not count as an unregistered document', async () => {
    await create(bank, {
      docKind: 'engineering',
      path: 'note.md',
      title: 'Note',
      purpose: 'Captured note.',
      inbox: true,
    })
    const findings = await validate(bank, { rule: 'unregistered-doc' })
    expect(findings.map((f) => f.path)).not.toContain('_inbox/note.md')
  })
})

describe('the bank does not get worse', () => {
  it('adds no validation finding', async () => {
    const before = (await validate(bank)).length
    await create(bank, {
      docKind: 'adr',
      path: 'adr/ADR-007-w.md',
      title: 'ADR-007: W',
      purpose: 'Records W.',
      derivedFrom: ['../engineering/architecture.md'],
    })
    await create(bank, {
      docKind: 'engineering',
      path: 'captured.md',
      title: 'Captured',
      purpose: 'A capture.',
      inbox: true,
    })
    expect((await validate(bank)).length).toBe(before)
  })

  it('leaves the new document reachable by routing', async () => {
    await create(bank, {
      docKind: 'domain',
      path: 'domain/limits.md',
      title: 'Domain Limits',
      purpose: 'Canonical request limits and their ceilings.',
      derivedFrom: ['../dna/principles.md'],
    })
    const { route } = await import('../src/route.js')
    expect(route(bank, 'request limits ceilings', { limit: 3 }).map((r) => r.path)).toContain(
      'domain/limits.md',
    )
  })
})

describe('promote', () => {
  const capture = () =>
    create(bank, {
      docKind: 'engineering',
      path: 'stat-sweep.md',
      title: 'Invalidation is a stat sweep',
      purpose: 'Captured in a session: invalidation is by mtime, so no watcher is needed.',
      inbox: true,
    })

  it('moves the note into a canonical layer and removes the original', async () => {
    await capture()
    const result = await promote(bank, {
      path: '_inbox/stat-sweep.md',
      to: 'engineering/invalidation.md',
      derivedFrom: ['../dna/principles.md'],
    })

    expect(result.promoted).toBe(true)
    expect(result.to).toBe('engineering/invalidation.md')
    expect(bank.get('_inbox/stat-sweep.md')).toBeUndefined()
    expect(bank.get('engineering/invalidation.md')!.status).toBe('active')
    await expect(read('_inbox/stat-sweep.md')).rejects.toThrow()
  })

  it('keeps the captured body and rebuilds the frontmatter', async () => {
    await capture()
    const before = await read('_inbox/stat-sweep.md')
    const bodyBefore = splitFrontmatter(before).body.trim()

    const result = await promote(bank, {
      path: '_inbox/stat-sweep.md',
      to: 'engineering/invalidation.md',
      derivedFrom: ['../dna/principles.md'],
    })

    const after = splitFrontmatter(await read(result.to))
    expect(after.body.trim()).toBe(bodyBefore)
    expect(after.data['status']).toBe('active')
    expect(after.data['derived_from']).toEqual(['../dna/principles.md'])
  })

  it('registers the promoted document so navigation reaches it', async () => {
    await capture()
    const result = await promote(bank, {
      path: '_inbox/stat-sweep.md',
      to: 'domain/invalidation.md',
      docKind: 'domain',
      derivedFrom: ['../dna/principles.md'],
    })
    expect(result.registeredIn).toEqual(['domain/README.md'])
    expect(await read('domain/README.md')).toContain('invalidation.md')
  })

  it('applies the same gates as create', async () => {
    await capture()
    await expect(
      promote(bank, { path: '_inbox/stat-sweep.md', to: 'domain/rules.md' }),
    ).rejects.toThrow(/Refusing to overwrite/)
    await expect(
      promote(bank, {
        path: '_inbox/stat-sweep.md',
        to: 'domain/x.md',
        derivedFrom: ['../dna/principles.md'],
        canonicalFor: ['filter_thresholds'],
      }),
    ).rejects.toThrow(/already owned/)
    // Promotion means becoming canonical, so the derived_from rule is not negotiable here.
    await expect(promote(bank, { path: '_inbox/stat-sweep.md', to: 'domain/x.md' })).rejects.toThrow(
      /requires every active non-root document/,
    )
  })

  it('refuses anything that is not in quarantine, and any destination inside it', async () => {
    await expect(promote(bank, { path: 'domain/rules.md', to: 'domain/x.md' })).rejects.toThrow(
      /Only quarantined documents/,
    )
    await capture()
    await expect(
      promote(bank, { path: '_inbox/stat-sweep.md', to: '_inbox/other.md' }),
    ).rejects.toThrow(/must leave the quarantine/)
  })

  it('writes nothing on a dry run', async () => {
    await capture()
    const result = await promote(bank, {
      path: '_inbox/stat-sweep.md',
      to: 'engineering/invalidation.md',
      derivedFrom: ['../dna/principles.md'],
      dryRun: true,
    })
    expect(result.promoted).toBe(false)
    expect(bank.get('_inbox/stat-sweep.md')).toBeDefined()
    await expect(read('engineering/invalidation.md')).rejects.toThrow()
  })

  it('leaves the bank no worse than before', async () => {
    const before = (await validate(bank)).length
    await capture()
    await promote(bank, {
      path: '_inbox/stat-sweep.md',
      to: 'engineering/invalidation.md',
      derivedFrom: ['../dna/principles.md'],
    })
    expect((await validate(bank)).length).toBe(before)
  })
})

describe('inbox listing', () => {
  it('lists quarantined documents oldest first and nothing else', async () => {
    await create(bank, {
      docKind: 'engineering',
      path: 'a.md',
      title: 'A',
      purpose: 'First capture.',
      inbox: true,
    })
    await create(bank, {
      docKind: 'engineering',
      path: 'b.md',
      title: 'B',
      purpose: 'Second capture.',
      inbox: true,
    })
    // Anchored on the newest file, not on the clock: mtime keeps sub-millisecond precision that
    // Date.now() truncates away, and the floor in ageDays then reads three days as two.
    const newest = Math.max(...bank.all().filter((d) => d.path.startsWith('_inbox/')).map((d) => d.mtimeMs))
    const entries = inbox(bank, newest + 3 * 86_400_000)
    expect(entries.map((e) => e.path)).toEqual(['_inbox/a.md', '_inbox/b.md'])
    expect(entries.every((e) => e.ageDays === 3)).toBe(true)
  })

  it('is empty when nothing was captured', () => {
    expect(inbox(bank)).toEqual([])
  })
})
