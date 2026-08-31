import fs from 'node:fs/promises'
import type { Bank } from './bank.js'

export interface UpdateSectionInput {
  /** Bank-relative path of an existing document. */
  path: string
  /** Level-two heading whose body is being written. */
  section: string
  /** Markdown to put under that heading. */
  content: string
  /** `replace` overwrites the section body, `append` adds to the end of it. */
  mode?: 'replace' | 'append'
  dryRun?: boolean
}

export interface UpdateSectionResult {
  path: string
  section: string
  mode: 'replace' | 'append'
  updated: boolean
  dryRun: boolean
  bytesBefore: number
  bytesAfter: number
  preview: string
}

function reject(message: string): never {
  throw new Error(message)
}

/**
 * Splits off the frontmatter block as written, rather than re-serialising it. Editing a body must
 * not requote a string or reorder a key three sections away from the change.
 */
function splitRaw(raw: string): { head: string; body: string } {
  if (!raw.startsWith('---')) return { head: '', body: raw }
  const close = raw.indexOf('\n---', 3)
  if (close === -1) return { head: '', body: raw }
  const lineEnd = raw.indexOf('\n', close + 1)
  if (lineEnd === -1) return { head: raw, body: '' }
  return { head: raw.slice(0, lineEnd + 1), body: raw.slice(lineEnd + 1) }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Line indices of every level-two heading, ignoring headings inside fenced code. */
function headings(lines: readonly string[]): { index: number; title: string }[] {
  const out: { index: number; title: string }[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) out.push({ index: i, title: m[1]! })
  }
  return out
}

/**
 * Writes the body of one named section of an existing document, leaving its frontmatter, its title
 * and every other section alone.
 *
 * This exists because of two things the field test measured. `bank_init` seeds `product/context.md`
 * and `engineering/testing-policy.md` as drafts precisely so they will be filled, and `bank_create`
 * refuses an occupied path — correctly — so the only documents the server asks for could only be
 * written behind its back. And a document created through the server arrived with headings and no
 * prose, so the prose came through a shell.
 *
 * The narrow shape is the point. One named section at a time cannot silently rewrite a document, and
 * a section that does not exist is refused rather than invented: an agent that mistypes a heading
 * gets the list of real ones, not a new section at the end of the file.
 */
export async function updateSection(bank: Bank, input: UpdateSectionInput): Promise<UpdateSectionResult> {
  const doc = bank.get(input.path)
  if (!doc) reject(`Not a document of this bank: ${input.path}`)
  if (doc.docFunction === 'template') {
    reject(`${doc.path} is a template. Templates are edited by hand, not through the server.`)
  }
  if (!input.section.trim()) reject('`section` is required: this tool writes one named section, never a whole document.')
  if (!input.content.trim()) reject('`content` is empty. To remove a section, edit the document by hand and say so.')

  const mode = input.mode ?? 'replace'
  const raw = await fs.readFile(bank.abs(doc.path), 'utf8')
  const parsed = splitRaw(raw)
  const lines = parsed.body.split('\n')
  const found = headings(lines)

  const target = norm(input.section)
  const hit = found.find((h) => norm(h.title) === target) ?? found.find((h) => norm(h.title).includes(target))
  if (!hit) {
    const available = found.map((h) => h.title).join(' | ') || '(none)'
    reject(`Section "${input.section}" not found in ${doc.path}. Available: ${available}`)
  }

  const next = found.find((h) => h.index > hit.index)
  const end = next ? next.index : lines.length
  const body = input.content.trim()
  const kept = mode === 'append' ? lines.slice(hit.index + 1, end).join('\n').trim() : ''
  const replacement = [`## ${hit.title}`, '', ...(kept ? [kept, ''] : []), body, ''].join('\n')

  const rebuilt = [...lines.slice(0, hit.index), ...replacement.split('\n'), ...lines.slice(end)].join('\n')
  const contents = `${parsed.head}${rebuilt.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`

  if (!input.dryRun) await fs.writeFile(bank.abs(doc.path), contents, 'utf8')

  return {
    path: doc.path,
    section: hit.title,
    mode,
    updated: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    bytesBefore: Buffer.byteLength(raw),
    bytesAfter: Buffer.byteLength(contents),
    preview: replacement.split('\n').slice(0, 20).join('\n'),
  }
}

export interface EditInput {
  /** Bank-relative path of an existing document. */
  path: string
  /** Exact text to find in the body. Must occur once, or the edit is refused. */
  find: string
  /** What to put in its place. */
  replace: string
  /** Restrict the search to one level-two section, which is how an ambiguous `find` is disambiguated. */
  section?: string
  dryRun?: boolean
}

export interface EditResult {
  path: string
  section?: string
  edited: boolean
  dryRun: boolean
  bytesBefore: number
  bytesAfter: number
  /** The replaced text in place, with a little of what surrounds it. */
  context: string
}

/**
 * Replaces one exact fragment of a document's body.
 *
 * `bank_update_section` solved the wrong grain. Measured over a working session: of eleven shell
 * writes into the bank, five were a few lines inside a section dozens of lines long — a row of a
 * table, two steps of a plan, one paragraph of an argument — and one renamed a heading. Replacing
 * the whole section means resending everything unchanged around the edit, so the agent reached for
 * a string replace in Python every time. This is that string replace, with the guards.
 *
 * The contract is the one agents already know from ordinary file editing: an exact match, refused
 * unless it occurs exactly once. Ambiguity is reported with its count rather than resolved by
 * picking the first, and `section` narrows the search when the same words appear twice.
 *
 * The frontmatter is out of reach by construction — the search runs on the body alone — so an edit
 * can rename a heading but cannot quietly rewrite `canonical_for`.
 */
export async function edit(bank: Bank, input: EditInput): Promise<EditResult> {
  const doc = bank.get(input.path)
  if (!doc) reject(`Not a document of this bank: ${input.path}`)
  if (doc.docFunction === 'template') {
    reject(`${doc.path} is a template. Templates are edited by hand, not through the server.`)
  }
  if (!input.find) reject('`find` is required: this tool replaces an exact fragment, never a whole document.')
  if (input.find === input.replace) reject('`find` and `replace` are identical; nothing to do.')

  const raw = await fs.readFile(bank.abs(doc.path), 'utf8')
  const { head, body } = splitRaw(raw)

  let from = 0
  let to = body.length
  let sectionTitle: string | undefined
  if (input.section?.trim()) {
    const lines = body.split('\n')
    const found = headings(lines)
    const target = norm(input.section)
    const hit = found.find((h) => norm(h.title) === target) ?? found.find((h) => norm(h.title).includes(target))
    if (!hit) {
      reject(
        `Section "${input.section}" not found in ${doc.path}. ` +
          `Available: ${found.map((h) => h.title).join(' | ') || '(none)'}`,
      )
    }
    sectionTitle = hit.title
    const next = found.find((h) => h.index > hit.index)
    from = lines.slice(0, hit.index).join('\n').length + (hit.index > 0 ? 1 : 0)
    to = next ? lines.slice(0, next.index).join('\n').length : body.length
  }

  const scope = body.slice(from, to)
  const occurrences = scope.split(input.find).length - 1
  if (occurrences === 0) {
    reject(
      `Not found in ${doc.path}${sectionTitle ? ` under "${sectionTitle}"` : ''}: ${JSON.stringify(
        input.find.slice(0, 80),
      )}. Read the document first — the text must match exactly, whitespace included.`,
    )
  }
  if (occurrences > 1) {
    reject(
      `Found ${occurrences} times in ${doc.path}${sectionTitle ? ` under "${sectionTitle}"` : ''}. ` +
        'Give more surrounding text, or pass section to narrow it: replacing the first of several ' +
        'is a guess, and this tool does not guess.',
    )
  }

  const at = from + scope.indexOf(input.find)
  const nextBody = body.slice(0, at) + input.replace + body.slice(at + input.find.length)
  const contents = `${head}${nextBody}`

  if (!input.dryRun) await fs.writeFile(bank.abs(doc.path), contents, 'utf8')

  const start = Math.max(0, at - 80)
  return {
    path: doc.path,
    section: sectionTitle,
    edited: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    bytesBefore: Buffer.byteLength(raw),
    bytesAfter: Buffer.byteLength(contents),
    context: nextBody.slice(start, at + input.replace.length + 80),
  }
}
