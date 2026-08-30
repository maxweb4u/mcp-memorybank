---
title: "FT-001: Raise The Filter Threshold"
doc_kind: feature
doc_function: canonical
purpose: Canonical brief for raising the L1 threshold.
derived_from:
  - ../../domain/rules.md
  - path: ../../adr/ADR-001-queue-choice.md
    fit: "Only the accepted queue topology is reused."
  - ../../../outside-bank/upstream.md
status: active
delivery_status: done
---
# FT-001

## What

Raise the threshold.

The L1 threshold is defined in [domain/rules.md](../../domain/rules.md), and the
queue topology is described in ../../adr/ADR-001-queue-choice.md.

The escalation ladder is governed by escalation-ladder.md, which this bank does not have.
