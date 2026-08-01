# Quickstart — Spec 014

## Current allowed activity

This branch is specification-only. You may review, clarify, validate, and improve contracts. Do not implement runtime behavior from this branch until the readiness gates are satisfied.

## Validate the Spec Kit

From repository root:

```bash
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
node http-generic-api/scripts/spec-kit-completion-gate.mjs
```

Validate JSON artifacts with the repository's preferred JSON Schema validator. The minimum target is:

```text
development-automation.json
  validates against contracts/development-automation.schema.json

sample Gemini result fixtures
  validate against contracts/gemini-evidence-result.schema.json
```

## Before implementation

1. Review `spec.md`, `operation-paths.md`, `concerns.md`, and `data-model.md`.
2. Resolve OD-001 through OD-010 or record an approved deferred-with-risk decision.
3. Regenerate/review `work-map-integration.json` from the current repository Work Map registry.
4. Set `review_state` to `ready_for_implementation` and `implementation_readiness.status` to `ready` only when the gate passes.
5. Freeze contract versions and traceability.
6. Select one ready task/wave from `development-automation.json`.
7. Generate a work packet with exact source SHA, allowed paths, forbidden actions, tests, gates, evidence, rollback, and resume key.
8. Create a separate implementation branch/PR for that bounded task or coherent wave.

## Suggested planning command

The existing repository automation control plane may use the Spec lifecycle/full-workstream templates for read-only planning. The planner must treat this contract as input, not authority.

Pseudo-input:

```json
{
  "automation_key": "spec_lifecycle",
  "mode": "dry_run",
  "spec_key": "014-gemini-evidence-intake-automation",
  "task_key": "T003",
  "source_branch": "gpt/spec-014-gemini-evidence-automation-20260801"
}
```

The exact runtime input must follow the registered tool contract available at execution time; this example does not authorize or define a new callable tool.

## First implementation wave after Spec Freeze

Recommended first runtime PR:

```text
WAVE-01 / T003
Evidence intake, evidence records, usage links, review/clarification state
```

Before it starts:

- T001 and T002 complete;
- OD-003 retention policy resolved;
- new schema entities classified in existing Work Maps/domains;
- additive migration and rollback plan reviewed;
- no provider integration included.

## Pilot safety profile

- non-sensitive text and small screenshots only;
- internal users first;
- Gemini disabled until gateway/security/budget/model gates pass;
- mandatory human review;
- no automatic delete, access grant, publish, or Audit approval;
- manual processing works before provider activation.

## Closeout

`completion.json` remains `in_progress` until implementation, merge, deployment, and readback evidence exists. Do not prefill fake PR numbers, SHAs, migration runs, or production evidence.
