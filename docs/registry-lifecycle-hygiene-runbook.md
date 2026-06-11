# Registry Lifecycle Hygiene Runbook

This runbook tracks cleanup for lifecycle registry drift such as `runtime_unclassified` and `planned_placeholder` rows.

## Goal

Classify runtime tables and planned placeholders without inventing data or activating empty surfaces.

## Target classifications

- `runtime_registry`
- `runtime_canonical`
- `runtime_log`
- `tenant_registry`
- `tenant_runtime`
- `resource_authority`
- `planned_placeholder`
- `deprecated`

## Activation rule

A placeholder should only move to active when it has:

- an owner workflow
- a route or API contract
- tests
- readback evidence
- lifecycle registry update

## Automation boundary

The remaining-scope scorecard tracks the hygiene gap statically. A future governed DB cleanup should produce a dry-run diff first, then apply classifications in small batches.

No placeholder should be filled with synthetic production data just to reduce counts.
