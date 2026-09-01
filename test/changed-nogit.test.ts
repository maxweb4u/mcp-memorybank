/**
 * A bank in a directory that is not a git repository. This is what a project looks like on the day
 * it is created, and `session-start` asks for `HEAD~20` by name — so the first step of the first
 * session used to fail on a project that had not been committed yet. Reported from wiring the server
 * into a fresh project.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { changed } from '../src/changed.js'

let dir: string
let bank: Bank

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-nogit-'))
  bank = new Bank(path.join(dir, 'memory_bank'))
  await init(bank, { name: 'Fresh Project' })
  await bank.refresh()
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('changed, outside a git repository', () => {
  it('answers a walking ref with everything, rather than refusing', async () => {
    const delta = await changed(bank, 'HEAD~20')
    expect(delta.mode).toBe('mtime')
    expect(delta.since).toBe('HEAD~20')
    expect(delta.note).toMatch(/not in a git repository/)
    expect(delta.changes.length).toBe(bank.all().length)
  })

  it('still refuses a ref that could only have come from a repository', async () => {
    await expect(changed(bank, 'v1.2.0')).rejects.toThrow(/not inside a git repository/)
    await expect(changed(bank, 'deadbeef')).rejects.toThrow(/not inside a git repository/)
  })

  it('reports an ISO date the same way it always did', async () => {
    const delta = await changed(bank, '2000-01-01')
    expect(delta.mode).toBe('mtime')
    expect(delta.since).toBe('2000-01-01')
    expect(delta.changes.length).toBe(bank.all().length)
  })
})
