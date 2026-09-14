import fs from 'node:fs/promises'
import { checkGovernance, contentFrom } from './create.js'
import { extractLinks, splitFrontmatter } from './parse.js'
import type { Bank } from './bank.js'
import type { Contract } from './types.js'

export interface UpdateSectionInput {
  /** Bank-relative path of an existing document. */
  path: string
  /** Level-two heading whose body is being written. */
  section: string
  /** Markdown to put under that heading. */
  content?: string
  /** Markdown read from a file instead of carried in the call. Mutually exclusive with `content`. */
  contentFile?: string
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
  const supplied = await contentFrom(input.content, input.contentFile, 'content')
  if (!supplied?.trim()) {
    reject('`content` is empty. To remove a section, edit the document by hand and say so.')
  }

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
  const body = supplied.trim()
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

export interface SetStatusInput {
  /** Bank-relative path of an existing document. */
  path: string
  /** The status to move it to, from the values `dna/` declares. */
  status: string
  /**
   * Drop `canonical_for` as part of archiving. Required when archiving a document that owns keys,
   * because ownership does not survive retirement and the successor cannot claim a key twice.
   */
  releaseCanonical?: boolean
  dryRun?: boolean
}

export interface SetStatusResult {
  path: string
  from: string
  to: string
  changed: boolean
  dryRun: boolean
  /** Governance findings that did not block the transition. */
  warnings: string[]
  /** Ownership keys given up by this transition, when archiving released them. */
  released?: string[]
}

/**
 * Moves an existing document from one lifecycle status to another.
 *
 * The gap this closes was measured, and it was the worst one to leave open. `bank_create` takes a
 * status and `bank_promote` sets one, but nothing could change the status of a document already in
 * place — so an agent filling a seeded draft reached for `sed -i` on the frontmatter. That is
 * precisely the edit governance exists for: `status: active` is the gate that requires
 * `derived_from`, so the one transition the gate guards was the one transition that skipped it.
 *
 * Everything else in the frontmatter is left exactly as written, `status` included when it is
 * already what was asked for. A document in `_inbox` is refused: the way out of quarantine is
 * `bank_promote`, which sets the status as part of the move.
 */
export async function setStatus(bank: Bank, input: SetStatusInput): Promise<SetStatusResult> {
  const doc = bank.get(input.path)
  if (!doc) reject(`Not a document of this bank: ${input.path}`)
  if (doc.docFunction === 'template') {
    reject(`${doc.path} is a template. Templates are edited by hand, not through the server.`)
  }
  if (doc.layer === 'inbox') {
    reject(
      `${doc.path} is in the quarantine, where status is not the thing that moves it. ` +
        'Use bank_promote to place it and set its status in one step, or bank_discard to drop it.',
    )
  }
  const to = input.status.trim()
  if (!to) reject('`status` is required: the lifecycle value to move this document to.')

  // Ownership does not survive retirement. `ownerByKey` does not look at status, so a document that
  // is archived while still declaring `canonical_for` goes on blocking the successor that should own
  // the key — bank_create refuses it with "already owned by", naming a document nobody reads any
  // more. Measured: a session archived a document and stripped the block with a python regex,
  // because that was the only way to do it at all.
  const owned = doc.canonicalFor
  const archiving = to === 'archived'
  if (input.releaseCanonical && !archiving) {
    reject('`releaseCanonical` belongs to archiving. Ownership is given up when a document retires, not on any other transition.')
  }
  if (archiving && owned.length > 0 && !input.releaseCanonical) {
    reject(
      `${doc.path} still owns ${owned.map((k) => `"${k}"`).join(', ')}. An archived document that ` +
        'keeps its keys blocks whoever should own them next. Pass releaseCanonical: true to give ' +
        'them up with this transition, or move them to the successor document first.',
    )
  }

  const warnings = checkGovernance(bank, {
    target: doc.path,
    status: to,
    docKind: doc.docKind,
    derivedFrom: doc.derivedFrom.map((e) => e.raw),
    canonicalFor: doc.canonicalFor,
  })

  const from = doc.status
  if (from === to && !(archiving && input.releaseCanonical && owned.length > 0)) {
    return { path: doc.path, from, to, changed: false, dryRun: Boolean(input.dryRun), warnings }
  }

  const raw = await fs.readFile(bank.abs(doc.path), 'utf8')
  const { head, body } = splitRaw(raw)
  if (!head) reject(`${doc.path} has no frontmatter, so it has no status to set.`)

  const lines = head.split('\n')
  const released = archiving && input.releaseCanonical && owned.length > 0 ? stripCanonical(lines) : undefined
  const at = lines.findIndex((l) => /^status:\s*/.test(l))
  if (at === -1) {
    // No status key at all: put one in, immediately before the closing delimiter.
    const close = lines.length - (lines[lines.length - 1] === '' ? 2 : 1)
    lines.splice(close, 0, `status: ${to}`)
  } else {
    lines[at] = `status: ${to}`
  }

  if (!input.dryRun) await fs.writeFile(bank.abs(doc.path), `${lines.join('\n')}${body}`, 'utf8')

  return {
    path: doc.path,
    from,
    to,
    changed: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    warnings,
    ...(released ? { released: owned } : {}),
  }
}

/**
 * Removes the `canonical_for` declaration from a frontmatter block, in place. Handles both the block
 * form — the key followed by its indented list items — and the inline `[a, b]` form.
 */
function stripCanonical(lines: string[]): boolean {
  const at = lines.findIndex((l) => /^canonical_for:/.test(l))
  if (at === -1) return false
  let end = at + 1
  if (/^canonical_for:\s*$/.test(lines[at]!)) {
    while (end < lines.length && /^\s+-\s/.test(lines[end]!)) end++
  }
  lines.splice(at, end - at)
  return true
}

export interface SetFieldInput {
  /** Bank-relative path of an existing document. */
  path: string
  /** Frontmatter key whose value is being set. */
  field: string
  /** The new value, on one line. */
  value: string
  dryRun?: boolean
}

export interface SetFieldResult {
  path: string
  field: string
  /** The value before, or null when the key was not there. */
  from: string | null
  to: string
  changed: boolean
  dryRun: boolean
  /** The frontmatter line as it is written. */
  line: string
  /** Index documents whose entry for this document repeated the old value, and now repeat the new one. */
  indexes: string[]
  /** True when a title change also renamed the H1, which had carried the old title. */
  heading?: boolean
}

const FIELD_NAME = /^[A-Za-z_][\w-]*$/

/** Fields this tool refuses, and where each one goes instead. */
const ELSEWHERE: Record<string, string> = {
  status: 'status is where the gates are. Use bank_set_status, which runs them.',
  doc_kind:
    'doc_kind decides the template, the section index and the gates a document was created under. ' +
    'Changing it is re-creating the document, not editing a value.',
  doc_function:
    'doc_function says whether a file is a document or a template. Changing it is re-creating the ' +
    'document, not editing a value.',
}

/** List-valued fields that carry governance — dependencies, ownership, exclusions, code anchors. */
const LISTS = new Set(['derived_from', 'canonical_for', 'must_not_define', 'anchors'])

const ENUMS: Record<string, (c: Contract) => Set<string>> = {
  delivery_status: (c) => c.deliveryStatuses,
  decision_status: (c) => c.decisionStatuses,
}

type Quoting = 'plain' | 'single' | 'double'

/** A parsed YAML value in the form it was written, for reporting and comparison. */
function scalarText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

/**
 * Picks the first quoting that YAML reads back as exactly what was asked for, starting from the one
 * the line already used. Plain is not always safe: `2026-09-14`, `true` and `1.10` are not strings
 * to a YAML parser, and a purpose containing ": " does not parse at all — which is how 22 documents
 * across the real banks ended up with frontmatter only the lenient reader can recover.
 *
 * A value that was not a string to begin with — a date, a number — may stay unquoted as long as it
 * reads back as the same kind of thing.
 */
function writeLine(field: string, value: string, quoting: Quoting, current: unknown): string {
  const forms: Record<Quoting, string> = {
    plain: value,
    single: `'${value.replace(/'/g, "''")}'`,
    double: JSON.stringify(value),
  }
  const order: Quoting[] = quoting === 'single' ? ['single', 'double'] : quoting === 'double' ? ['double'] : ['plain', 'double']
  for (const q of order) {
    const line = `${field}: ${forms[q]}`
    const { data, error } = splitFrontmatter(`---\n${line}\n---\n`)
    if (error) continue
    const back = data[field]
    if (typeof back === 'string' && back === value) return line
    const typed = current !== undefined && typeof current !== 'string'
    if (q === 'plain' && typed && typeof back === typeof current && scalarText(back) === value) return line
  }
  reject(`${JSON.stringify(value)} cannot be written as a frontmatter value that reads back unchanged.`)
}

/**
 * Sets one scalar value in the frontmatter of an existing document.
 *
 * Measured over five days of working sessions in four banks: of eleven writes into a bank that went
 * around the server, eight were frontmatter edits — `purpose` six times, `delivery_status` twice —
 * made with `sed -i` or a python partition on `\n---\n`. `bank_edit` cannot reach the frontmatter by
 * construction, and `bank_set_status` changes one key only, so a document whose purpose had drifted
 * had no governed way to say so. An agent wrote it down in as many words: the phrase is in the
 * frontmatter, so `bank_edit` cannot change it. `purpose` is also the field `bank_route` ranks on,
 * which made it the worst one to leave to a shell.
 *
 * The block is edited in place, never re-serialised: one key's lines are replaced and every other
 * byte stays as written. A value that YAML would read differently is quoted until it reads back
 * unchanged, and the write is refused if nothing does.
 *
 * Two things around the value move with it. A section index entry written by `bank_create` repeats
 * the purpose and the title verbatim, so an entry that still carries the old one gets the new one —
 * a hand-written summary that does not repeat it is left alone. And a title change renames the H1
 * when the H1 was the old title.
 *
 * What it will not touch is where governance lives: `status` has its own tool with its own gates,
 * `doc_kind` and `doc_function` are what the document was created as, and list fields such as
 * `derived_from` and `canonical_for` are not one value.
 */
export async function setField(bank: Bank, input: SetFieldInput): Promise<SetFieldResult> {
  const doc = bank.get(input.path)
  if (!doc) reject(`Not a document of this bank: ${input.path}`)
  if (doc.docFunction === 'template') {
    reject(`${doc.path} is a template. Templates are edited by hand, not through the server.`)
  }

  const field = input.field.trim()
  if (!FIELD_NAME.test(field)) reject(`"${input.field}" is not a frontmatter key.`)
  const elsewhere = Object.hasOwn(ELSEWHERE, field) ? ELSEWHERE[field] : undefined
  if (elsewhere) reject(elsewhere)
  if (LISTS.has(field)) {
    reject(
      `${field} is a list, and it carries governance. This tool sets one scalar value; nothing in the ` +
        `server edits ${field} yet, so change it by hand and run bank_validate.` +
        (field === 'canonical_for' ? ' Archiving gives the keys up: bank_set_status with releaseCanonical.' : ''),
    )
  }

  const to = input.value.trim()
  if (!to) reject('`value` is empty. To remove a field, edit the document by hand and say so.')
  if (/[\r\n]/.test(to)) reject('`value` must fit on one line: frontmatter values here are single scalars.')

  const allowed = ENUMS[field]?.(bank.contract)
  if (bank.contract.present && allowed && allowed.size > 0 && !allowed.has(to)) {
    reject(`"${to}" is not a ${field} this bank declares. Allowed: ${[...allowed].join(' | ')} (from dna/).`)
  }

  const raw = await fs.readFile(bank.abs(doc.path), 'utf8')
  const { head, body } = splitRaw(raw)
  if (!head) reject(`${doc.path} has no frontmatter, so it has no ${field} to set.`)

  const current = splitFrontmatter(raw).data[field]
  if (current !== undefined && current !== null && typeof current === 'object' && !(current instanceof Date)) {
    reject(`${field} in ${doc.path} holds a list or a mapping, not one value. This tool sets scalars only.`)
  }
  const from = scalarText(current)

  const lines = head.split('\n')
  let close = lines.length - 1
  while (close > 0 && !/^---\s*$/.test(lines[close]!)) close--
  const at = lines.findIndex((l, i) => i > 0 && i < close && new RegExp(`^${field}:(\\s|$)`).test(l))

  if (from === to && at !== -1) {
    return { path: doc.path, field, from, to, changed: false, dryRun: Boolean(input.dryRun), line: lines[at]!, indexes: [] }
  }

  let quoting: Quoting = 'plain'
  let end = at + 1
  if (at !== -1) {
    const inline = lines[at]!.slice(field.length + 1).trimStart()
    quoting = inline.startsWith("'") ? 'single' : inline.startsWith('"') ? 'double' : 'plain'
    // A value can run on over indented lines — a folded scalar, a long quoted string. They go with it.
    while (end < close) {
      if (/^[ \t]/.test(lines[end]!)) {
        end++
        continue
      }
      let k = end
      while (k < close && lines[k]!.trim() === '') k++
      if (k > end && k < close && /^[ \t]/.test(lines[k]!)) {
        end = k
        continue
      }
      break
    }
  }

  const line = writeLine(field, to, quoting, current)
  if (at === -1) lines.splice(close, 0, line)
  else lines.splice(at, end - at, line)
  const nextHead = lines.join('\n')

  let nextBody = body
  let heading: boolean | undefined
  if (field === 'title' && from) {
    const bodyLines = body.split('\n')
    let fence = false
    for (let i = 0; i < bodyLines.length; i++) {
      if (/^\s*(```|~~~)/.test(bodyLines[i]!)) fence = !fence
      if (fence) continue
      const m = /^#\s+(.+?)\s*$/.exec(bodyLines[i]!)
      if (!m) continue
      if (m[1] === from) {
        bodyLines[i] = `# ${to}`
        heading = true
      }
      break
    }
    nextBody = bodyLines.join('\n')
  }

  const contents = `${nextHead}${nextBody}`
  // The line was already proven to read back alone. A document that parsed before must still parse,
  // with the value in place; one that did not is on the lenient reader either way.
  if (!doc.parseError) {
    const check = splitFrontmatter(contents)
    if (check.error || scalarText(check.data[field]) !== to) {
      reject(`Setting ${field} would leave ${doc.path} with frontmatter that does not read back. Nothing was written.`)
    }
  }

  const indexes: string[] = []
  const indexWrites: [string, string][] = []
  if ((field === 'purpose' || field === 'title') && from) {
    for (const indexPath of doc.registeredIn) {
      const indexRaw = await fs.readFile(bank.abs(indexPath), 'utf8')
      let touched = false
      const indexLines = indexRaw.split('\n').map((l) => {
        if (!extractLinks(indexPath, l).some((link) => link.to === doc.path)) return l
        const next =
          field === 'purpose'
            ? l.replace(from, () => to)
            : l.replace(`[${from}](`, () => `[${to}](`).replace(`[\`${from}\`](`, () => `[\`${to}\`](`)
        if (next !== l) touched = true
        return next
      })
      if (touched) {
        indexes.push(indexPath)
        indexWrites.push([indexPath, indexLines.join('\n')])
      }
    }
  }

  if (!input.dryRun) {
    await fs.writeFile(bank.abs(doc.path), contents, 'utf8')
    for (const [indexPath, indexContents] of indexWrites) await fs.writeFile(bank.abs(indexPath), indexContents, 'utf8')
  }

  return {
    path: doc.path,
    field,
    from,
    to,
    changed: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    line,
    indexes,
    ...(heading ? { heading } : {}),
  }
}
