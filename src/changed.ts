import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Bank } from './bank.js'
import type { Layer } from './types.js'

const run = promisify(execFile)

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'

export interface Change {
  path: string
  title: string
  changeKind: ChangeKind
  docKind?: string
  layer?: Layer
  status?: string
  /** Previous path, for a rename. */
  from?: string
}

export interface ChangedResult {
  since: string
  /** How the delta was computed. */
  mode: 'git' | 'mtime'
  /** Repository root, when the bank lives in one. */
  repo?: string
  changes: Change[]
  /** Set in mtime mode, where deletions and additions cannot be told apart. */
  note?: string
}

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([T ]|$)/

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

async function repoRoot(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return null
  }
}

function enrich(bank: Bank, rel: string, changeKind: ChangeKind, from?: string): Change {
  const doc = bank.get(rel)
  return {
    path: rel,
    title: doc?.title ?? path.posix.basename(rel, '.md'),
    changeKind,
    ...(doc ? { docKind: doc.docKind, layer: doc.layer, status: doc.status } : {}),
    ...(from ? { from } : {}),
  }
}

const STATUS: Record<string, ChangeKind> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' }

async function fromGit(bank: Bank, since: string, repo: string): Promise<ChangedResult> {
  // git reports paths against the resolved repository root. Comparing those to an unresolved
  // bank root makes every file look like it sits outside the bank, and the delta comes back empty
  // rather than failing — so resolve both ends before subtracting them.
  const base = await fs.realpath(bank.root).catch(() => bank.root)

  const rel = (abs: string): string | null => {
    const r = path.relative(base, path.join(repo, abs)).split(path.sep).join('/')
    if (r.startsWith('..') || !r.endsWith('.md')) return null
    return r
  }

  const diff = await git(repo, ['diff', '--name-status', '-M', since, '--', base])
  const changes: Change[] = []
  const seen = new Set<string>()

  for (const line of diff.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const code = parts[0]!.charAt(0)
    const kind = STATUS[code]
    if (!kind) continue

    if (kind === 'renamed' && parts.length >= 3) {
      const to = rel(parts[2]!)
      const from = rel(parts[1]!)
      if (!to) continue
      seen.add(to)
      changes.push(enrich(bank, to, 'renamed', from ?? parts[1]!))
      continue
    }

    const target = rel(parts[1]!)
    if (!target || seen.has(target)) continue
    seen.add(target)
    changes.push(enrich(bank, target, kind))
  }

  // `git diff` never lists files that were created but not yet committed or staged.
  const untracked = await git(repo, ['ls-files', '--others', '--exclude-standard', '--', base])
  for (const line of untracked.split('\n')) {
    if (!line.trim()) continue
    const target = rel(line)
    if (!target || seen.has(target)) continue
    seen.add(target)
    changes.push(enrich(bank, target, 'added'))
  }

  changes.sort((a, b) => a.changeKind.localeCompare(b.changeKind) || a.path.localeCompare(b.path))
  return { since, mode: 'git', repo, changes }
}

function fromMtime(bank: Bank, since: string): ChangedResult {
  const cutoff = Date.parse(since)
  if (Number.isNaN(cutoff)) throw new Error(`"${since}" is neither an ISO date nor a usable git ref.`)

  const changes = bank
    .all()
    .filter((doc) => doc.mtimeMs > cutoff)
    .map((doc) => enrich(bank, doc.path, 'modified'))
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    since,
    mode: 'mtime',
    changes,
    note: 'Modification times cannot distinguish a new document from an edited one, and cannot see deletions. Pass a git ref for an exact delta.',
  }
}

/**
 * What moved since a point in time. A git ref gives a true delta including deletions and renames;
 * an ISO date falls back to modification times, which can only report what exists now.
 */
export async function changed(bank: Bank, since: string): Promise<ChangedResult> {
  const trimmed = since.trim()
  if (!trimmed) throw new Error('`since` is required: an ISO date or a git ref.')

  if (!ISO_LIKE.test(trimmed)) {
    const repo = await repoRoot(bank.root)
    if (!repo) throw new Error(`This bank is not inside a git repository, so "${trimmed}" cannot be resolved. Pass an ISO date instead.`)
    try {
      await git(repo, ['rev-parse', '--verify', `${trimmed}^{commit}`])
    } catch {
      throw new Error(`"${trimmed}" is not a commit in ${repo}. Pass a valid ref or an ISO date.`)
    }
    return fromGit(bank, trimmed, repo)
  }

  return fromMtime(bank, trimmed)
}
