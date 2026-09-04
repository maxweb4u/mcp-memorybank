/**
 * B-03. The usual failure of a knowledge base is not that something went unwritten — validation
 * already catches that — but that what was written went quietly stale. No rule inside the bank can
 * see it, because nothing inside the bank knows the code exists.
 *
 * The whole design rests on one refusal: the server never guesses which document owns which file.
 * It reads `anchors:` and compares two commit dates. So the tests here are mostly about what it
 * declines to say.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { drift } from '../src/drift.js'

const run = promisify(execFile)

let repo: string
let bank: Bank

const git = (args: string[], when?: string): Promise<unknown> =>
  run('git', args, {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}),
    },
  })

const write = async (rel: string, body: string): Promise<void> => {
  const full = path.join(repo, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, body, 'utf8')
}

const doc = (title: string, anchors: string[]): string =>
  [
    '---',
    `title: "${title}"`,
    'doc_kind: reference',
    'doc_function: canonical',
    'status: active',
    `purpose: "Describes ${title}."`,
    ...(anchors.length > 0 ? ['anchors:', ...anchors.map((a) => `  - ${a}`)] : []),
    '---',
    '',
    `# ${title}`,
  ].join('\n')

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-drift-'))
  bank = new Bank(path.join(repo, 'memory_bank'))
  await init(bank, { name: 'Drifting Project' })

  await git(['init', '-q'])

  // A document and its code, both committed on the same old day.
  await write('src/filter/config.ts', 'export const thresholds = { min: 60 }\n')
  await write('memory_bank/engineering/filtering.md', doc('Filtering', ['src/filter/config.ts']))

  // A document whose code has not moved since.
  await write('src/stable/render.ts', 'export const render = () => null\n')
  await write('memory_bank/engineering/rendering.md', doc('Rendering', ['src/stable/render.ts']))

  // A document pointing at code that will be deleted out from under it.
  await write('src/legacy/uploader.ts', 'export const upload = () => null\n')
  await write('memory_bank/engineering/uploads.md', doc('Uploads', ['src/legacy/uploader.ts']))

  // A document anchored to a whole directory.
  await write('src/api/routes.ts', 'export const routes = []\n')
  await write('memory_bank/engineering/api.md', doc('API', ['src/api']))

  await git(['add', '-A'])
  await git(['commit', '-qm', 'everything, together'], '2026-01-10T12:00:00Z')

  // Six months later the code moves and the documents do not.
  await write('src/filter/config.ts', 'export const thresholds = { min: 75 }\n')
  await write('src/api/routes.ts', 'export const routes = [1, 2, 3]\n')
  await fs.rm(path.join(repo, 'src/legacy/uploader.ts'))
  await git(['add', '-A'])
  await git(['commit', '-qm', 'the code moved on'], '2026-07-10T12:00:00Z')

  await bank.refresh()
})

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

describe('drift', () => {
  it('reports code that is ahead of the document that owns it', async () => {
    const result = await drift(bank, { thresholdDays: 90 })
    expect(result.mode).toBe('git')

    const filtering = result.drifted.find((d) => d.path === 'engineering/filtering.md')!
    expect(filtering.anchor).toBe('src/filter/config.ts')
    expect(filtering.aheadDays).toBeGreaterThan(170)
    expect(filtering.docTouched).toContain('2026-01-10')
    expect(filtering.codeTouched).toContain('2026-07-10')
  })

  it('says nothing about code that has not moved', async () => {
    const result = await drift(bank, { thresholdDays: 90 })
    expect(result.drifted.some((d) => d.path === 'engineering/rendering.md')).toBe(false)
  })

  it('follows an anchor that names a directory', async () => {
    const result = await drift(bank, { thresholdDays: 90 })
    const api = result.drifted.find((d) => d.path === 'engineering/api.md')!
    expect(api.anchor).toBe('src/api')
    expect(api.codeTouched).toContain('2026-07-10')
  })

  it('reports an anchor pointing at code that no longer exists, whatever the threshold', async () => {
    const result = await drift(bank, { thresholdDays: 3650 })
    expect(result.drifted).toHaveLength(0)
    expect(result.missing).toHaveLength(1)
    expect(result.missing[0]!.path).toBe('engineering/uploads.md')
    expect(result.missing[0]!.anchor).toBe('src/legacy/uploader.ts')
  })

  it('honours the threshold', async () => {
    const wide = await drift(bank, { thresholdDays: 3650 })
    expect(wide.drifted).toHaveLength(0)
    const tight = await drift(bank, { thresholdDays: 0 })
    expect(tight.drifted.length).toBeGreaterThanOrEqual(2)
  })

  it('orders the widest gap first', async () => {
    const result = await drift(bank, { thresholdDays: 0 })
    const gaps = result.drifted.map((d) => d.aheadDays ?? 0)
    expect([...gaps].sort((a, b) => b - a)).toEqual(gaps)
  })

  it('counts how much of the bank it cannot see', async () => {
    const result = await drift(bank)
    expect(result.anchored).toBe(4)
    // The seeded bank is mostly governance and templates, and none of it describes code.
    expect(result.unanchored).toBeGreaterThan(20)
  })

  it('restricts to a scope', async () => {
    const elsewhere = await drift(bank, { thresholdDays: 0, scope: 'product' })
    expect(elsewhere.anchored).toBe(0)
    expect(elsewhere.mode).toBe('none')
    expect(elsewhere.note).toContain('anchors')
  })

  it('explains itself rather than reporting nothing when no document is annotated', async () => {
    const bare = new Bank(path.join(repo, 'empty_bank'))
    await init(bare, { name: 'Unannotated' })
    await bare.refresh()

    const result = await drift(bare)
    expect(result.mode).toBe('none')
    expect(result.anchored).toBe(0)
    expect(result.drifted).toEqual([])
    expect(result.note).toContain('repository-relative code paths')
  })
})
