---
doc_kind: governance
doc_function: canonical
purpose: SSoT implementation and dependency tree rules.
derived_from:
  - principles.md
status: active
---
# Document Governance

## Source Dependency Tree

The root document is `principles.md`; it has no `derived_from`.
Every `active` non-root document must define `derived_from`.
Cyclic dependencies are forbidden.

## Governance-specific Frontmatter Fields

| Field | Values | Purpose |
|-|-|-|
| `doc_kind` | `governance`, `domain`, `engineering`, `adr`, `feature` | Document type |
| `doc_function` | `canonical`, `index`, `template` | Role of the file |
