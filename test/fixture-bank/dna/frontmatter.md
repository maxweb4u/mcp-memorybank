---
doc_kind: governance
doc_function: canonical
purpose: Schema of required and optional fields of YAML frontmatter.
derived_from:
  - principles.md
status: active
---
# Frontmatter Schema

## Required

| Field | Type | Description |
|---|---|---|
| `status` | enum | `draft` / `active` / `archived` |

## Optional

| Field | When | Description |
|---|---|---|
| `delivery_status` | Feature owner | `planned` / `in_progress` / `done` / `cancelled` |
| `decision_status` | ADR | `proposed` / `accepted` / `superseded` / `rejected` |
