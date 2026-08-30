import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import type { Bank } from './bank.js'

/** The starter set ships with the server; once copied it belongs to the bank and can be rewritten. */
const STARTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'starter')

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
 * The fourteen-directory skeleton every mature bank in the wild shares. `dna/` and `flows/` come
 * from the starter set; the rest are empty registries, created so a first document of each kind
 * has a registered home instead of landing nowhere.
 */
const SECTIONS: Section[] = [
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

function sectionIndex(section: Section): string {
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

function rootIndex(name: string): string {
  const rows = SECTIONS.map((s) => `- [\`${s.dir}/README.md\`](${s.dir}/README.md)\n  ${s.route}`).join('\n')
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

  const directories = [...SECTIONS.map((s) => s.dir), 'dna', 'flows']
  const files: string[] = []

  if (input.dryRun) {
    files.push(...(await listTree(STARTER, '')))
    files.push(...SECTIONS.map((s) => `${s.dir}/README.md`), 'README.md')
    return { root: bank.root, created: false, dryRun: true, files: files.sort(), directories, warnings }
  }

  await fs.mkdir(bank.root, { recursive: true })
  await copyTree(STARTER, bank.root, files, bank.root)

  for (const section of SECTIONS) {
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
