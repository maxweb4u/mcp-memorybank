---
title: "ADR-ID: Short Decision Name"
doc_kind: adr
doc_function: template
purpose: Wrapper template for ADRs.
derived_from:
  - ../../../dna/governance.md
status: active
template_for: adr
template_target_path: ../../../adr/ADR-<timestamp>-short-decision-name.md
---
# ADR-ID: Short Decision Name

This file describes the wrapper. The instantiated ADR lives below.

## Instantiated Frontmatter

```yaml
title: "ADR-ID: Short Decision Name"
doc_kind: adr
doc_function: canonical
purpose: "Records a decision, its status and consequences."
status: draft
decision_status: proposed
date: YYYY-MM-DD
must_not_define:
  - current_system_state
```

## Instantiated Body

```markdown
# ADR-ID: Short Decision Name

## Context

Why the decision was needed.

## Decision

What was decided.
```
