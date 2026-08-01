# Quickstart — Spec 014

## Current allowed activity

This branch is specification-only. You may review, clarify, validate, generate blocked/read-only work packets, and improve contracts. Do not implement runtime behavior, activate GitHub workflows, call Gemini, modify Google Workspace, apply migrations, or deploy from this branch.

## Validate the local Spec contracts

From repository root:

```bash
node specs/014-gemini-evidence-intake-automation/tools/validate-contracts.mjs
```

The validator checks:

- manifest file presence;
- development requirement/task/acceptance/operation-path references;
- wave and task dependency cycles;
- requirement and acceptance coverage by tasks;
- CI Test Family references to requirements and tasks;
- Pipeline stage references to declared evidence contracts;
- required Pipeline/Evidence keys used by completion;
- sole generated-source writer policy;
- obvious secret or signed-URL patterns;
- completion-state contradictions.

It emits:

```text
mad4b.spec014.contract-integrity-report.v1
```

The tool is an executable Spec validator, not a substitute for the repository's JSON Schema, OpenAPI, Work Map, CI, migration, deployment, or runtime gates.

## Generate a deterministic development work packet

Example for the current specification task:

```bash
node specs/014-gemini-evidence-intake-automation/tools/generate-work-packet.mjs \
  --task T001 \
  --allow-blocked \
  --output /tmp/spec014-t001-work-packet.json
```

Example for the first runtime task after Spec Freeze:

```bash
node specs/014-gemini-evidence-intake-automation/tools/generate-work-packet.mjs \
  --task T003 \
  --allow-blocked
```

Until Work Map readiness, task dependencies, and relevant Open Decisions are resolved, the generated packet correctly reports `status=blocked`. A work packet contains:

- source revision and Work Map fingerprint;
- task, wave, Requirements, Acceptance Criteria, and Operation Paths;
- allowed paths and forbidden actions;
- dependencies and unresolved decisions;
- required Test Families and Pipelines;
- required gates and completion evidence;
- rollback posture, resume key, work-packet ID, and deterministic plan hash.

The packet is planning evidence only. It does not authorize a mutation.

## Validate through repository governance

The existing repository gates remain authoritative:

```bash
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --ci --changed
node http-generic-api/scripts/spec-kit-completion-gate.mjs --ci --changed
```

The intended CI design is defined in:

```text
ci-automation.json
contracts/ci-automation.schema.json
CI_AUTOMATION_BLUEPRINT_AR.md
checklists/ci.md
```

It adapts these repository patterns:

```text
exact candidate binding
→ changed-scope test-family routing
→ phase/task governance
→ dynamic diagnostic shards and ordered progress
→ canonical structured evidence
→ trusted PR publisher
→ read-only generated-artifact validation
→ separately authorized sole writer
→ exact-head release and completion gate
```

No new `.github/workflows` file is activated in this specification branch.

## JSON Schema targets

The minimum structured targets are:

```text
development-automation.json
  → contracts/development-automation.schema.json

ci-automation.json
  → contracts/ci-automation.schema.json

Gemini proposed result fixtures
  → contracts/gemini-evidence-result.schema.json

Draft HTTP surface
  → contracts/gemini-evidence-gateway.openapi.yaml
```

## Before implementation

1. Review `spec.md`, `operation-paths.md`, `concerns.md`, `data-model.md`, and the CI blueprint.
2. Run the executable contract validator and fix all reference/integrity findings.
3. Resolve OD-001 through OD-010 or record an approved deferred-with-risk decision.
4. Regenerate/review `work-map-integration.json` against the current repository Work Map registry.
5. Set `review_state=ready_for_implementation` and `implementation_readiness.status=ready` only after the official gate passes.
6. Freeze development and CI contract versions and traceability.
7. Select exactly one ready task or coherent wave.
8. Generate a work packet and bind the implementation PR to its exact source revision and plan hash.
9. Create a separate implementation branch/PR that stays inside the packet's allowed paths and forbidden-action boundary.
10. Require the applicable Test Families, Canonical Evidence, and exact-head completion evidence.

## Suggested planning input

The existing repository automation control plane may use the Spec lifecycle/full-workstream templates for read-only planning. The planner must treat the contract as input, not authority.

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

- T001 and T002 are complete;
- the local validator and official Spec/Work Map gates pass;
- OD-003 retention policy is resolved;
- new schema entities are classified in existing Work Maps/domains;
- additive migration and rollback plans are reviewed;
- no provider integration is included.

## First CI implementation wave

Recommended CI automation delivery after contract review:

```text
PR-CI-01
Spec Contract Validator
+ cross-reference linter
+ changed-scope Spec gate
+ exact-candidate source stamp
+ canonical JSON/Markdown summary
```

Later bounded PRs add Phase Governance, Diagnostic Shards, Canonical Evidence Router, Trusted Publisher, Generated Artifact Validator/Writer, and Release Completion Gate. They must not be introduced as one privileged workflow.

## Pilot safety profile

- non-sensitive text and small screenshots only;
- internal users first;
- Gemini disabled until gateway/security/budget/model gates pass;
- mandatory human review;
- no automatic delete, access grant, publish, or Audit approval;
- manual processing works before provider activation.

## Closeout

`completion.json` remains `in_progress` until implementation, merge, migration where required, deployment, runtime readback, manual fallback, rollback, and post-merge audit evidence exists. Do not prefill fake PR numbers, SHAs, migration runs, workflow results, or production evidence.
