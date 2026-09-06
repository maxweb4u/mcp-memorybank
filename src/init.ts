import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import type { Bank } from './bank.js'

/** The starter set ships with the server; once copied it belongs to the bank and can be rewritten. */
export const STARTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'starter')

/**
 * What is copied into a bank, and what is only pointed at.
 *
 * B-10 started as "seed `flows/` by reference" and had to be narrowed, because the first full test
 * run showed what that costs: with the flows absent, `bank_route` could no longer answer a question
 * about the project's own procedure, and a person cloning the repository could not read it at all.
 *
 * So the line falls inside `flows/`. The four prose documents — the feature flow, the epic flow,
 * `workflows.md` and the index — are 68 KB, they are read by people, and routing ranks them. They
 * are copied. `flows/templates/` is 140 KB across 24 files that nobody reads as prose, that routing
 * deliberately skips (`doc_function: template`), and that four measured banks had not customised.
 * That is the part that is pointed at.
 */
const COPIED = ['dna', 'product', 'engineering']

interface Section {
  dir: string
  docKind: string
  title: string
  purpose: string
  /** One line in the root index saying when to come here. */
  route: string
  /** Documents the starter set puts in this section, which the index must register. */
  seeds?: { file: string; title: string; purpose: string }[]
}

/**
 * Every section the server knows how to index. `dna/` and `flows/` come from the starter set; these
 * are registries, so that a first document of each kind has a registered home instead of landing
 * nowhere.
 *
 * Not all of them are seeded — see {@link SEEDED}. One that is left out is still known here, and
 * `bank_create` builds its index the moment a first document needs it.
 */
export const SECTIONS: Section[] = [
  { dir: 'product', docKind: 'product', title: 'Product Documentation Index', purpose: 'Navigation for product-level documentation: why the project exists, for whom, and how success is measured.', route: 'Read when you need the problem, the audience, the outcomes, or the roadmap.', seeds: [{ file: 'context.md', title: 'Product Context', purpose: 'The problem, the audience, and the constraints everything else inherits. Seeded as a draft — fill it in first.' }] },
  { dir: 'domain', docKind: 'domain', title: 'Domain Documentation Index', purpose: 'Navigation for domain-level documentation: vocabulary, model, rules, states, and events.', route: 'Read when you need the project’s language, entities, rules, or state semantics.' },
  { dir: 'engineering', docKind: 'engineering', title: 'Engineering Documentation Index', purpose: 'Navigation for implementation documentation: architecture, conventions, testing policy, and known traps.', route: 'Read when you need architecture, coding and testing conventions, or gotchas.', seeds: [{ file: 'testing-policy.md', title: 'Testing Policy', purpose: 'What must have automated tests, what is verified manually, and the simplify review the closure gate requires. Seeded as a draft — fill it in first.' }] },
  { dir: 'ops', docKind: 'ops', title: 'Operations Documentation Index', purpose: 'Navigation for operational documentation: running locally, configuration, deployment, and recovery.', route: 'Read when you need to run, configure, deploy, or recover the system.' },
  { dir: 'adr', docKind: 'adr', title: 'Decision Records Index', purpose: 'Registry of accepted architecture and engineering decisions.', route: 'Read when you need to find an accepted decision or record a new one.' },
  { dir: 'use-cases', docKind: 'use_case', title: 'Use Cases Index', purpose: 'Registry of durable end-to-end scenarios the system supports.', route: 'Read when you need a durable end-to-end scenario rather than one delivery unit.' },
  { dir: 'features', docKind: 'feature', title: 'Feature Registry', purpose: 'Registry of feature packages: what each delivery unit built, how it was verified, and what remains.', route: 'Read when you need the delivery trail.' },
  { dir: 'epics', docKind: 'epic', title: 'Epic Registry', purpose: 'Registry of epics: initiatives larger than one delivery unit.', route: 'Read when work spans several features and needs a roadmap of its own.' },
  { dir: 'prd', docKind: 'prd', title: 'PRD Registry', purpose: 'Registry of product requirement documents.', route: 'Read when a feature package inherits scope from a larger product document.' },
  { dir: 'processes', docKind: 'process', title: 'Process Registry', purpose: 'Registry of durable working processes and session protocols.', route: 'Read when you need a recurring procedure rather than a one-off decision.' },
  { dir: 'prompts', docKind: 'prompt', title: 'Prompt Registry', purpose: 'Registry of governed prompts used against this project.', route: 'Read when you need a prompt that is part of the project, not of one session.' },
]

/**
 * The sections `bank_init` actually creates.
 *
 * `epics`, `prd` and `prompts` are deliberately absent. Measured across four banks —
 * `ebook_parser`, `tasman/research`, `idelo`, `focusreminder` — all three were index-only in every
 * one of them, while four sections carried nearly everything. An empty registry is meant to give a
 * first document a home; a registry four consecutive projects never opened is an invitation to
 * ceremony instead. They are still known, still ranked, still templated — they are simply built on
 * first use rather than in advance.
 */
const SEEDED = new Set(['product', 'domain', 'engineering', 'ops', 'adr', 'use-cases', 'features', 'processes'])

/** The section that owns a bank-relative path, when the server knows one. */
export function sectionFor(bankRelativePath: string): Section | undefined {
  const top = bankRelativePath.split('/')[0]
  return top ? SECTIONS.find((s) => s.dir === top) : undefined
}

export interface InitInput {
  /** Project name, used in the root index. */
  name: string
  dryRun?: boolean
  /** Create the skeleton even though the directory already holds documents. */
  force?: boolean
}

export interface InitResult {
  root: string
  created: boolean
  dryRun: boolean
  /** Bank-relative paths written, in creation order. */
  files: string[]
  directories: string[]
  warnings: string[]
}

function frontmatter(fields: Record<string, unknown>, body: string): string {
  return matter.stringify(`${body.trimEnd()}\n`, fields, { lineWidth: -1 } as never)
}

export function sectionIndex(section: Section): string {
  return frontmatter(
    {
      title: section.title,
      doc_kind: section.docKind,
      doc_function: 'index',
      purpose: section.purpose,
      derived_from: ['../dna/governance.md'],
      status: 'active',
      audience: 'humans_and_agents',
    },
    `# ${section.title}\n\n${section.route}\n\n## Registry\n\n${
      section.seeds?.length
        ? section.seeds.map((s) => `- [\`${s.title}\`](${s.file}) — ${s.purpose}`).join('\n')
        : 'Empty. A first document of this kind is registered here.'
    }\n`,
  )
}

/**
 * What stands in `flows/` when the procedures are not copied into the bank.
 *
 * It is a signpost, not a stub: it says where the real thing is, that the templates still work, and
 * exactly how to take ownership if this project needs its own.
 */
function flowsPointer(): string {
  return frontmatter(
    {
      title: 'Document Templates',
      doc_kind: 'governance',
      doc_function: 'index',
      purpose:
        'Where the document templates live, and how to bring them into this bank if the project needs its own.',
      derived_from: ['../../dna/governance.md'],
      status: 'active',
      audience: 'humans_and_agents',
    },
    `# Document Templates

The document templates are **not copied into this bank**. They ship with the \`memorybank\`
server and are read from there.

Nothing is missing as a result. \`bank_create\` instantiates the right template for a
\`doc_kind\` exactly as it would if the files were here, and reports which one it used.

The flows themselves — [\`feature-flow.md\`](../feature-flow.md), [\`epic-flow.md\`](../epic-flow.md),
[\`workflows.md\`](../workflows.md) — **are** here, because they are read by people and answered by
routing. Only the fill-in-the-blanks templates behind them are not.

## Why not copy them

Twenty-four files and 140 KB, identical in every bank, that nobody reads as prose and that routing
skips on purpose. Copies fork: measured across four projects none had customised a template, while
the copies had already begun to drift — and a bank cannot notice that its templates are a year
behind another bank's, because each one only ever reads its own.

## If this project needs its own

Take ownership and the copies stop being shared:

\`\`\`bash
mcp-memorybank --root <this bank> --materialize-flows
\`\`\`

That writes the current set into \`flows/templates/\` and the bank owns it from then on —
\`bank_create\` prefers what it finds here over what the server ships, always. Do it when you
actually mean to change a template, not in advance.
`,
  )
}

function rootIndex(name: string): string {
  const rows = SECTIONS.filter((s) => SEEDED.has(s.dir))
    .map((s) => `- [\`${s.dir}/README.md\`](${s.dir}/README.md)\n  ${s.route}`)
    .join('\n')
  return frontmatter(
    {
      title: 'Documentation Index',
      doc_kind: 'project',
      doc_function: 'index',
      purpose: `Root navigation for the ${name} memory bank. Read this first to understand the structure of the knowledge base.`,
      derived_from: ['dna/governance.md'],
      status: 'active',
      audience: 'humans_and_agents',
    },
    `# Documentation Index

Knowledge base for **${name}**.

## Start Here

The bank is empty apart from its own rules. Before writing anything, read
[\`dna/README.md\`](dna/README.md) — the SSoT principle, the frontmatter contract, and the
governance rules everything else follows from.

## Annotated Index

${rows}

- [\`flows/README.md\`](flows/README.md)
  Read when you need to create a feature package or an epic, move work through lifecycle gates, or
  instantiate a governed document from a template.

- [\`dna/README.md\`](dna/README.md)
  Read when you need the SSoT rules, the frontmatter contract, or the documentation governance rules.

## Task-Specific Routes

| Task | Route |
| --- | --- |
| Starting a feature | [\`flows/feature-flow.md\`](flows/feature-flow.md) |
| Recording a decision | [\`adr/README.md\`](adr/README.md) |
| Choosing how much documentation a task needs | [\`flows/workflows.md\`](flows/workflows.md) |
`,
  )
}

async function copyTree(from: string, to: string, collected: string[], base: string): Promise<void> {
  const entries = await fs.readdir(from, { withFileTypes: true })
  await fs.mkdir(to, { recursive: true })
  for (const entry of entries) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await copyTree(src, dst, collected, base)
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst)
      collected.push(path.relative(base, dst).split(path.sep).join('/'))
    }
  }
}

async function listTree(from: string, prefix: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listTree(path.join(from, entry.name), rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/**
 * Creates a bank where there is none: the skeleton, the governance set from `starter/`, and one
 * registered index per section. Everything written here becomes the bank's own — the starter is a
 * starting point, not a schema the server keeps enforcing.
 */
export async function init(bank: Bank, input: InitInput): Promise<InitResult> {
  const warnings: string[] = []
  if (!input.name.trim()) throw new Error('`name` is required: it goes into the root index.')

  const existing = bank.all()
  if (existing.length > 0 && !input.force) {
    throw new Error(
      `This bank already holds ${existing.length} documents. Refusing to seed over them; pass force to override.`,
    )
  }
  if (existing.length > 0) warnings.push(`Seeding over ${existing.length} existing documents.`)

  try {
    await fs.access(STARTER)
  } catch {
    throw new Error(`Starter set not found at ${STARTER}. The server package is incomplete.`)
  }

  const seeded = SECTIONS.filter((s) => SEEDED.has(s.dir))
  const directories = [...seeded.map((s) => s.dir), 'dna', 'flows']
  const files: string[] = []

  if (input.dryRun) {
    for (const sub of COPIED) files.push(...(await listTree(path.join(STARTER, sub), sub)))
    files.push(
      ...(await fs.readdir(path.join(STARTER, 'flows'))).filter((n) => n.endsWith('.md')).map((n) => `flows/${n}`),
      'flows/templates/README.md',
    )
    files.push(...seeded.map((s) => `${s.dir}/README.md`), 'README.md')
    return { root: bank.root, created: false, dryRun: true, files: files.sort(), directories, warnings }
  }

  await fs.mkdir(bank.root, { recursive: true })
  for (const sub of COPIED) {
    await copyTree(path.join(STARTER, sub), path.join(bank.root, sub), files, bank.root)
  }
  // The prose flows are copied; only `flows/templates/` is pointed at.
  await fs.mkdir(path.join(bank.root, 'flows', 'templates'), { recursive: true })
  for (const name of await fs.readdir(path.join(STARTER, 'flows'))) {
    if (!name.endsWith('.md')) continue
    await fs.copyFile(path.join(STARTER, 'flows', name), path.join(bank.root, 'flows', name))
    files.push(`flows/${name}`)
  }
  await fs.writeFile(path.join(bank.root, 'flows', 'templates', 'README.md'), flowsPointer(), 'utf8')
  files.push('flows/templates/README.md')

  for (const section of seeded) {
    const target = path.join(bank.root, section.dir, 'README.md')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, sectionIndex(section), 'utf8')
    files.push(`${section.dir}/README.md`)
  }

  await fs.writeFile(path.join(bank.root, 'README.md'), rootIndex(input.name.trim()), 'utf8')
  files.push('README.md')

  await bank.refresh()
  return { root: bank.root, created: true, dryRun: false, files: files.sort(), directories, warnings }
}


/** Directory aliases the template lookup already understands, kept in one place. */
const DIR_ALIAS: Record<string, string> = { use_case: 'use-case', 'feature-support': 'feature' }

/**
 * A template from the set the server ships, for a bank that has not taken ownership of `flows/`.
 *
 * Deliberately narrow: it reads one directory of the shipped starter and nothing else. It is a
 * fallback for the copy that is no longer made, not a second place where banks can keep documents.
 */
export async function shippedTemplate(
  docKind: string,
  targetPath: string,
): Promise<{ path: string; raw: string; fromServer: boolean } | null> {
  const wanted = path.posix.basename(targetPath)
  const dirs = [docKind, DIR_ALIAS[docKind]].filter((d): d is string => Boolean(d))

  for (const dir of dirs) {
    const base = path.join(STARTER, 'flows', 'templates', dir)
    let entries: string[]
    try {
      entries = (await fs.readdir(base, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name)
    } catch {
      continue
    }

    const named = entries.filter((e) => e !== 'README.md')
    const pick = entries.includes(wanted) ? wanted : named.length === 1 ? named[0]! : null
    if (!pick) continue

    const raw = await fs.readFile(path.join(base, pick), 'utf8')
    return { path: `flows/templates/${dir}/${pick}`, raw, fromServer: true }
  }
  return null
}

/**
 * Copies the shipped flows into the bank, which then owns them.
 *
 * The escape hatch for B-10: a project that really does mean to change a procedure takes the files
 * and stops sharing. `bank_create` prefers what it finds in the bank, so this needs no other switch.
 */
export async function materializeFlows(bank: Bank, opts: { force?: boolean } = {}): Promise<InitResult> {
  const existing = bank
    .all()
    .filter((d) => d.path.startsWith('flows/templates/') && d.path !== 'flows/templates/README.md')
  if (existing.length > 0 && !opts.force) {
    throw new Error(
      `flows/templates/ already holds ${existing.length} documents of its own. Refusing to overwrite them; pass force to override.`,
    )
  }

  const files: string[] = []
  await copyTree(
    path.join(STARTER, 'flows', 'templates'),
    path.join(bank.root, 'flows', 'templates'),
    files,
    bank.root,
  )
  await bank.refresh()
  return {
    root: bank.root,
    created: true,
    dryRun: false,
    files: files.sort(),
    directories: ['flows/templates'],
    warnings: existing.length > 0 ? [`Overwrote ${existing.length} documents that flows/ already held.`] : [],
  }
}


/**
 * Basenames of the templates the server ships.
 *
 * `unresolved-rule-reference` excuses a bare mention of a template filename — flow prose says
 * "recorded in `design.md`" about package shape, not about one file — and it recognised those names
 * by finding them in the bank. Once `flows/templates/` is pointed at rather than copied (B-10) the
 * evidence is gone from the bank but the names are just as real, so the rule asks here instead.
 */
export async function shippedTemplateNames(): Promise<Set<string>> {
  const names = new Set<string>()
  const base = path.join(STARTER, 'flows', 'templates')
  const visit = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) await visit(path.join(dir, e.name))
      else if (e.isFile() && e.name.endsWith('.md')) names.add(e.name)
    }
  }
  await visit(base)
  return names
}
