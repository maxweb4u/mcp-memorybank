import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type { Bank } from './bank.js'
import type { BankDoc } from './types.js'
import { resolveFrom, splitFrontmatter } from './parse.js'

export interface CreateInput {
  docKind: string
  /** Bank-relative path of the document to create. */
  path: string
  title: string
  purpose: string
  derivedFrom?: string[]
  canonicalFor?: string[]
  mustNotDefine?: string[]
  status?: string
  /**
   * The document body, below the title. Measured need: without it `bank_create` writes frontmatter,
   * template and index registration, and every word of prose arrives some other way — over one
   * working session, nine governed creations against six shell writes into the same bank.
   */
  body?: string
  /** Extra frontmatter fields, appended after the governed ones. */
  extra?: Record<string, unknown>
  /** Route into the quarantine directory instead of the canonical layers. */
  inbox?: boolean
  /** Report what would happen without touching the filesystem. */
  dryRun?: boolean
}

export interface CreateResult {
  path: string
  created: boolean
  dryRun: boolean
  frontmatter: Record<string, unknown>
  /** Template the body came from, or null when none matched. */
  template: string | null
  registeredIn: string[]
  warnings: string[]
  /** First lines of the document, so the caller can see what landed. */
  preview: string
}

const INBOX = '_inbox'

/** Fields that belong to the wrapper template and must never reach the instantiated document. */
const TEMPLATE_ONLY = new Set(['template_for', 'template_target_path', 'doc_function'])

function fail(message: string): never {
  throw new Error(message)
}

const PLACEHOLDER = /^(YYYY-MM-DD|YYYYMMDD.*|<[^>]+>|.*\b(FT-XXX|ADR-ID|PRD-ID|UC-XXX|EP-XXX|PROMPT-ID)\b.*)$/

function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && PLACEHOLDER.test(value.trim())
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The template body carries a skeleton heading; the instantiated document carries its own title. */
function retitle(body: string, title: string): string {
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i]!)) {
      lines[i] = `# ${title}`
      return lines.join('\n')
    }
  }
  return `# ${title}\n\n${body}`
}

function normalise(p: string): string {
  return p.replace(/^\.?\//, '').split(path.sep).join('/')
}

/**
 * Templates in these banks are wrappers: the document to instantiate sits inside them as two fenced
 * blocks under `## Instantiated Frontmatter` and `## Instantiated Body`. Templates without those
 * sections are plain and are copied as-is.
 */
function instantiate(raw: string): { data: Record<string, unknown>; body: string } {
  const fenced = (heading: string, language: string): string | null => {
    const at = raw.indexOf(`## ${heading}`)
    if (at === -1) return null
    const open = raw.indexOf(`\`\`\`${language}`, at)
    if (open === -1) return null
    const start = raw.indexOf('\n', open)
    const close = raw.indexOf('\n```', start)
    if (start === -1 || close === -1) return null
    return raw.slice(start + 1, close)
  }

  const yaml = fenced('Instantiated Frontmatter', 'yaml')
  const body = fenced('Instantiated Body', 'markdown')

  if (yaml !== null && body !== null) {
    const parsed = splitFrontmatter(`---\n${yaml}\n---\n`)
    return { data: parsed.data, body: body.trimEnd() }
  }

  const plain = splitFrontmatter(raw)
  const data = { ...plain.data }
  for (const field of TEMPLATE_ONLY) delete data[field]
  return { data, body: plain.body.trim() }
}

/**
 * Templates declare `template_for` and `template_target_path`; the filename of that target is what
 * distinguishes `brief.md` from `design.md` inside one kind.
 */
export function pickTemplate(bank: Bank, docKind: string, targetPath: string): BankDoc | null {
  const templates = bank.all().filter((d) => d.docFunction === 'template')
  if (templates.length === 0) return null

  const wanted = path.posix.basename(targetPath)
  const dirAlias = docKind.replace(/_/g, '-')

  const targetBasename = (doc: BankDoc): string | null => {
    const raw = bank.raw(doc.path)
    if (!raw) return null
    const declared = splitFrontmatter(raw).data['template_target_path']
    return typeof declared === 'string' ? path.posix.basename(declared) : null
  }

  const declaredFor = (doc: BankDoc): string | null => {
    const raw = bank.raw(doc.path)
    if (!raw) return null
    const value = splitFrontmatter(raw).data['template_for']
    return typeof value === 'string' ? value : null
  }

  const byKind = templates.filter(
    (d) =>
      declaredFor(d) === docKind ||
      d.path.startsWith(`flows/templates/${docKind}/`) ||
      d.path.startsWith(`flows/templates/${dirAlias}/`),
  )
  const pool = byKind.length > 0 ? byKind : []

  const exact = pool.find((d) => targetBasename(d) === wanted)
  if (exact) return exact

  const byName = pool.find((d) => path.posix.basename(d.path) === wanted)
  if (byName) return byName

  // A kind with a single template needs no disambiguation.
  const named = pool.filter((d) => path.posix.basename(d.path) !== 'README.md')
  return named.length === 1 ? named[0]! : null
}

/** The index that should route a new document: its own directory, then the nearest ancestor. */
export function pickIndex(bank: Bank, targetPath: string): BankDoc | null {
  const segments = normalise(targetPath).split('/')
  segments.pop()
  while (segments.length >= 0) {
    const candidate = [...segments, 'README.md'].join('/')
    const doc = bank.get(candidate)
    if (doc) return doc
    if (segments.length === 0) break
    segments.pop()
  }
  return null
}

const LINK_LINE = /\[[^\]]*\]\([^)\s]+\.md[^)\s]*\)/

/**
 * Appends one entry to an index, copying the shape of the last entry already there — bullet,
 * table row or numbered item — so registration does not reformat a hand-written file.
 */
export function registerLine(indexRaw: string, indexPath: string, docPath: string, title: string, purpose: string): string {
  const relative = path.posix.relative(path.posix.dirname(indexPath), docPath)
  const lines = indexRaw.split('\n')

  let last = -1
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fence = !fence
    if (fence) continue
    if (LINK_LINE.test(lines[i]!)) last = i
  }

  // A section index says it is empty until something is registered in it. bank_init writes that
  // line; nothing used to clear it, so an index could carry entries under a claim of emptiness.
  const placeholder = lines.findIndex((l) => /^Empty\. A first document of this kind is registered here\.$/.test(l.trim()))
  if (placeholder !== -1) {
    lines.splice(placeholder, lines[placeholder + 1]?.trim() === '' ? 2 : 1)
    if (last > placeholder) last -= 1
  }

  if (last === -1) {
    const trimmed = lines.join('\n').trimEnd()
    return `${trimmed}\n\n- [${title}](${relative}) — ${purpose}\n`
  }

  const model = lines[last]!
  // Mirror how the existing entries write their link text: some banks backtick it, some do not.
  const backticked = /\[`[^`\]]*`\]\(/.test(model)
  const label = backticked ? `\`${title}\`` : title
  const link = `[${label}](${relative})`
  let entry: string
  if (model.trim().startsWith('|')) {
    const columns = model.split('|').length - 2
    const cells = [` ${link} `, ` ${purpose} `, ...Array(Math.max(0, columns - 2)).fill(' ')]
    entry = `|${cells.slice(0, Math.max(1, columns)).join('|')}|`
  } else if (/^\s*\d+\.\s/.test(model)) {
    const n = Number(/^\s*(\d+)\./.exec(model)?.[1] ?? '0') + 1
    entry = `${n}. ${link} — ${purpose}`
  } else {
    const bullet = /^(\s*)([-*])\s/.exec(model)
    entry = `${bullet?.[1] ?? ''}${bullet?.[2] ?? '-'} ${link} — ${purpose}`
  }

  lines.splice(last + 1, 0, entry)
  return lines.join('\n')
}

/** Refuses an unusable destination before anything is written. */
async function checkTarget(bank: Bank, target: string, original: string): Promise<void> {
  if (!target.endsWith('.md')) fail(`Path must end in .md: ${target}`)
  if (target.startsWith('..') || path.posix.isAbsolute(target)) fail(`Path must stay inside the bank: ${original}`)
  if (bank.docs.has(target)) fail(`Refusing to overwrite an existing document: ${target}`)

  try {
    await fs.access(bank.abs(target))
    fail(`A file already exists at ${target} but is not indexed. Refusing to overwrite it.`)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('A file already exists')) throw err
  }
}

interface Governed {
  target: string
  status: string
  docKind: string
  derivedFrom: string[]
  canonicalFor: string[]
}

/** The governance gates. Refusals throw; everything softer comes back as a warning. */
function checkGovernance(bank: Bank, g: Governed): string[] {
  const warnings: string[] = []

  for (const entry of g.derivedFrom) {
    const { resolved, external } = resolveFrom(g.target, entry)
    if (external) {
      warnings.push(`derived_from "${entry}" points outside the bank; it will not be checked.`)
      continue
    }
    if (!resolved || !bank.docs.has(resolved)) {
      fail(`derived_from "${entry}" does not resolve to a document of this bank (tried ${resolved ?? entry}).`)
    }
  }

  for (const key of g.canonicalFor) {
    const owners = (bank.ownerByKey.get(key) ?? []).filter((p) => p !== g.target)
    if (owners.length > 0) {
      fail(`canonical_for "${key}" is already owned by ${owners.join(', ')}. One fact, one home.`)
    }
  }

  if (bank.contract.requiresDerivedFrom && g.derivedFrom.length === 0) {
    if (g.status === 'active') {
      fail('Governance requires every active non-root document to declare derived_from.')
    }
    warnings.push('No derived_from: governance requires one before this document can become active.')
  }

  const contract = bank.contract
  if (contract.docKinds.size > 0 && !contract.docKinds.has(g.docKind)) {
    warnings.push(`doc_kind "${g.docKind}" is not among the values declared in dna/.`)
  }
  if (contract.statuses.size > 0 && !contract.statuses.has(g.status)) {
    warnings.push(`status "${g.status}" is not among the values declared in dna/.`)
  }

  return warnings
}

/** Writes the document and adds its entry to the index in one step, so neither can be forgotten. */
async function land(
  bank: Bank,
  target: string,
  contents: string,
  index: BankDoc | null,
  title: string,
  purpose: string,
  removeSource?: string,
): Promise<void> {
  await fs.mkdir(path.dirname(bank.abs(target)), { recursive: true })
  await fs.writeFile(bank.abs(target), contents, 'utf8')

  if (index) {
    const indexRaw = bank.raw(index.path)
    if (indexRaw !== undefined) {
      const updated = registerLine(indexRaw, index.path, target, title, purpose)
      await fs.writeFile(bank.abs(index.path), updated, 'utf8')
    }
  }
  if (removeSource) await fs.rm(bank.abs(removeSource), { force: true })
  await bank.refresh()
}

export async function create(bank: Bank, input: CreateInput): Promise<CreateResult> {
  if (!input.title.trim()) fail('`title` is required.')
  if (!input.purpose.trim()) fail('`purpose` is required: it is the signal bank_route ranks on.')

  let target = normalise(input.path)
  if (input.inbox && !target.startsWith(`${INBOX}/`)) target = `${INBOX}/${path.posix.basename(target)}`
  await checkTarget(bank, target, input.path)

  const status = input.status ?? 'draft'
  const derivedFrom = input.derivedFrom ?? []
  const canonicalFor = input.canonicalFor ?? []
  const warnings = checkGovernance(bank, {
    target,
    status,
    docKind: input.docKind,
    derivedFrom,
    canonicalFor,
  })

  const template = input.inbox ? null : pickTemplate(bank, input.docKind, target)
  let base: Record<string, unknown> = {}
  let body = `# ${input.title}\n`
  if (template) {
    const raw = bank.raw(template.path)
    if (raw) {
      const filled = instantiate(raw)
      base = filled.data
      if (filled.body) body = retitle(filled.body, input.title)
    }
  } else if (!input.inbox) {
    warnings.push(`No template matched doc_kind "${input.docKind}"; wrote a minimal document instead.`)
  }

  if (input.body?.trim()) {
    // The author's prose replaces the template's prompts rather than following them: a document
    // carrying both reads as half-filled, and the template's headings are guidance, not content.
    body = `# ${input.title}\n\n${input.body.trim()}\n`
    if (template) warnings.push(`Body supplied, so the prose of ${template.path} was not used.`)
  }

  const frontmatter: Record<string, unknown> = {
    title: input.title,
    doc_kind: input.docKind,
    doc_function: 'canonical',
    purpose: input.purpose,
    ...(derivedFrom.length ? { derived_from: derivedFrom } : {}),
    ...(canonicalFor.length ? { canonical_for: canonicalFor } : {}),
    ...(input.mustNotDefine?.length ? { must_not_define: input.mustNotDefine } : {}),
    status,
  }
  for (const [key, value] of Object.entries(base)) {
    if (key in frontmatter || TEMPLATE_ONLY.has(key)) continue
    // The template's own derived_from and canonical_for are placeholders (`../features/FT-XXX/...`);
    // its must_not_define is a real governance constraint the template exists to carry.
    if (key === 'derived_from' || key === 'canonical_for') continue
    if (key === 'date' && isPlaceholder(value)) {
      frontmatter[key] = today()
      continue
    }
    if (isPlaceholder(value)) {
      warnings.push(`Template left a placeholder in "${key}": ${String(value)}. Fill it before activating.`)
    }
    frontmatter[key] = value
  }
  for (const [key, value] of Object.entries(input.extra ?? {})) frontmatter[key] = value

  // lineWidth: -1 keeps a long purpose on one line instead of folding it with `>-`.
  const contents = matter.stringify(`${body.trimEnd()}\n`, frontmatter, { lineWidth: -1 } as never)

  const index = input.inbox ? null : pickIndex(bank, target)
  const registeredIn: string[] = []
  if (index) registeredIn.push(index.path)
  else if (!input.inbox) warnings.push('No index found to register this document in; navigation will not reach it.')

  if (!input.dryRun) await land(bank, target, contents, index, input.title, input.purpose)

  return {
    path: target,
    created: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    frontmatter,
    template: template?.path ?? null,
    registeredIn,
    warnings,
    preview: contents.split('\n').slice(0, 40).join('\n'),
  }
}

export interface PromoteInput {
  /** The quarantined document, e.g. `_inbox/note.md`. */
  path: string
  /** Where it should live, e.g. `engineering/gotchas-cache.md`. */
  to: string
  docKind?: string
  title?: string
  purpose?: string
  derivedFrom?: string[]
  canonicalFor?: string[]
  mustNotDefine?: string[]
  /** Publication status of the promoted document; `active` by default. */
  status?: string
  dryRun?: boolean
}

export interface PromoteResult {
  from: string
  to: string
  promoted: boolean
  dryRun: boolean
  frontmatter: Record<string, unknown>
  /** Template whose governance fields were merged in, if one matched the destination. */
  template: string | null
  registeredIn: string[]
  warnings: string[]
  preview: string
}

export interface InboxEntry {
  path: string
  title: string
  purpose: string
  docKind: string
  status: string
  ageDays: number
  bytes: number
}

/** What is waiting in quarantine, oldest first — the weekly review list. */
export function inbox(bank: Bank, now = Date.now()): InboxEntry[] {
  return bank
    .all()
    .filter((d) => d.layer === 'inbox')
    .map((d) => ({
      path: d.path,
      title: d.title,
      purpose: d.purpose,
      docKind: d.docKind,
      status: d.status,
      ageDays: Math.floor((now - d.mtimeMs) / 86_400_000),
      bytes: d.bytes,
    }))
    .sort((a, b) => b.ageDays - a.ageDays || a.path.localeCompare(b.path))
}

/**
 * Moves a captured note out of quarantine into a canonical layer. The body is the agent's, and is
 * kept as written; the frontmatter is rebuilt against the contract, and the destination template
 * contributes only its governance fields. The source is removed, so nothing is owned twice.
 */

/**
 * Rewrites the body's relative markdown links so they still resolve after the document moves.
 *
 * `bank_promote` keeps the captured body as written, deliberately — but "as written" includes paths
 * that only made sense from `_inbox/`. Measured: a note linking `../processes/rule.md` kept saying
 * that after landing in `processes/`, where the link is the bare filename, and validation does not
 * catch it because the rule for unresolved references only fires on prose that claims a rule.
 *
 * Absolute paths, URLs and anchors are left exactly as they are; so is any target that does not
 * resolve inside the bank, since guessing at a broken link is worse than moving it unchanged.
 */
function relinkBody(body: string, fromPath: string, toPath: string, bank: Bank): { body: string; rewritten: string[] } {
  const fromDir = path.posix.dirname(fromPath)
  const toDir = path.posix.dirname(toPath)
  if (fromDir === toDir) return { body, rewritten: [] }

  const rewritten: string[] = []
  const next = body.replace(/\]\(([^)\s]+\.md)((?:#[^)\s]*)?)\)/g, (whole, target: string, anchor: string) => {
    if (/^(https?:|\/|#)/.test(target)) return whole
    const resolved = path.posix.normalize(path.posix.join(fromDir, target))
    if (resolved.startsWith('..') || !bank.get(resolved)) return whole
    let updated = path.posix.relative(toDir, resolved)
    if (!updated.startsWith('.')) updated = updated.includes('/') ? updated : `./${updated}`.slice(2)
    if (updated === target) return whole
    rewritten.push(`${target} -> ${updated}`)
    return `](${updated}${anchor})`
  })
  return { body: next, rewritten }
}

export async function promote(bank: Bank, input: PromoteInput): Promise<PromoteResult> {
  const from = normalise(input.path)
  const source = bank.get(from)
  if (!source) fail(`Not a document of this bank: ${input.path}`)
  if (source.layer !== 'inbox') fail(`Only quarantined documents can be promoted; ${from} is not in ${INBOX}/.`)

  const target = normalise(input.to)
  if (target.startsWith(`${INBOX}/`)) fail('Promotion must leave the quarantine; give a destination outside _inbox/.')
  await checkTarget(bank, target, input.to)

  const title = (input.title ?? source.title).trim()
  const purpose = (input.purpose ?? source.purpose).trim()
  if (!title) fail('`title` is required.')
  if (!purpose) fail('`purpose` is required: it is the signal bank_route ranks on.')

  const docKind = input.docKind ?? source.docKind
  if (!docKind) fail('`docKind` is required: the captured note does not declare one.')

  const status = input.status ?? 'active'
  const derivedFrom = input.derivedFrom ?? source.derivedFrom.map((e) => e.raw)
  const canonicalFor = input.canonicalFor ?? source.canonicalFor

  const warnings = checkGovernance(bank, { target, status, docKind, derivedFrom, canonicalFor })

  const template = pickTemplate(bank, docKind, target)
  let base: Record<string, unknown> = {}
  if (template) {
    const raw = bank.raw(template.path)
    // Only the template's governed fields; its body would overwrite what was captured.
    if (raw) base = instantiate(raw).data
  }

  const sourceRaw = bank.raw(from) ?? ''
  const captured = retitle(splitFrontmatter(sourceRaw).body.trim() || `# ${title}`, title)
  const relinked = relinkBody(captured, from, target, bank)
  const body = relinked.body
  for (const change of relinked.rewritten) warnings.push(`Link rewritten for the new location: ${change}`)

  const frontmatter: Record<string, unknown> = {
    title,
    doc_kind: docKind,
    doc_function: source.docFunction || 'canonical',
    purpose,
    ...(derivedFrom.length ? { derived_from: derivedFrom } : {}),
    ...(canonicalFor.length ? { canonical_for: canonicalFor } : {}),
    ...(input.mustNotDefine?.length ? { must_not_define: input.mustNotDefine } : {}),
    status,
  }
  for (const [key, value] of Object.entries(base)) {
    if (key in frontmatter || TEMPLATE_ONLY.has(key)) continue
    if (key === 'derived_from' || key === 'canonical_for') continue
    if (key === 'date' && isPlaceholder(value)) {
      frontmatter[key] = today()
      continue
    }
    if (isPlaceholder(value)) continue
    frontmatter[key] = value
  }

  const contents = matter.stringify(`${body.trimEnd()}\n`, frontmatter, { lineWidth: -1 } as never)

  const index = pickIndex(bank, target)
  const registeredIn: string[] = []
  if (index) registeredIn.push(index.path)
  else warnings.push('No index found to register this document in; navigation will not reach it.')

  if (!input.dryRun) await land(bank, target, contents, index, title, purpose, from)

  return {
    from,
    to: target,
    promoted: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    frontmatter,
    template: template?.path ?? null,
    registeredIn,
    warnings,
    preview: contents.split('\n').slice(0, 40).join('\n'),
  }
}

export interface DiscardInput {
  /** The quarantined document to drop, e.g. `_inbox/note.md`. */
  path: string
  /** Why it is not worth keeping. Required, so a discard is never silent. */
  reason: string
  dryRun?: boolean
}

export interface DiscardResult {
  path: string
  title: string
  purpose: string
  reason: string
  discarded: boolean
  dryRun: boolean
  bytes: number
}

/**
 * Drops a captured note that is not worth keeping.
 *
 * The `review-inbox` prompt offers three outcomes for every note — promote it, fold it into the
 * document that already owns the fact, or drop it as transient — and the server implemented two.
 * Measured in a live review: the agent folded one note into an existing document with
 * `bank_update_section`, then reached for `rm` in a shell to clear the note it had just consumed,
 * because nothing else could. A tool that names three outcomes and supports two sends the third
 * outside every gate it has.
 *
 * Deliberately narrow: `_inbox/` only, never a document that is part of the bank proper. Deleting
 * canonical documents is not something this server should learn to do.
 */
export async function discard(bank: Bank, input: DiscardInput): Promise<DiscardResult> {
  const from = normalise(input.path)
  const source = bank.get(from)
  if (!source) fail(`Not a document of this bank: ${input.path}`)
  if (source.layer !== 'inbox') {
    fail(
      `Only quarantined documents can be discarded; ${from} is not in ${INBOX}/. ` +
        'Documents in the bank proper are removed by hand, deliberately.',
    )
  }
  if (!input.reason?.trim()) {
    fail('`reason` is required: a note is dropped on the record, or not at all.')
  }

  if (!input.dryRun) await fs.rm(bank.abs(from), { force: true })

  return {
    path: from,
    title: source.title,
    purpose: source.purpose,
    reason: input.reason.trim(),
    discarded: !input.dryRun,
    dryRun: Boolean(input.dryRun),
    bytes: source.bytes,
  }
}
