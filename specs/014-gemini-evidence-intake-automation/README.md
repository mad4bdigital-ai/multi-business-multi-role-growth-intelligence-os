# Spec 014 — Gemini Evidence Intake and Development Automation

## Status

Specification-only draft. This directory does not authorize runtime code, migrations, Gemini calls, Google Workspace mutations, GitHub workflow activation, credential changes, deployment, or production activation.

## Purpose

Define a governed evidence-intake and client-survey subsystem that uses Gemini as a multimodal extraction and recommendation provider while preserving deterministic policy, human approval, tenant/Brand isolation, audit evidence, replay safety, and manual fallback.

The Spec Kit introduces two connected machine-readable contracts:

1. `development-automation.json` defines **what must be developed**, in which wave, under which dependencies, authority, tests, and evidence.
2. `ci-automation.json` defines **how the repository proves the work is correct**, on which exact candidate SHA, through which test families, pipelines, canonical evidence, diagnostics, governed writer controls, and completion gates.

Together they allow repository automation to determine:

- which requirements exist;
- which implementation waves own them;
- which tasks are ready or blocked;
- which contracts and operation paths apply;
- which changed paths and test families are affected;
- which CI, security, migration, deployment, and readback gates are required;
- which authoritative evidence closes each task;
- which human decisions remain unresolved;
- whether a report belongs to the current PR head or a stale candidate;
- whether a repair may only be proposed or may be written by a separately governed writer.

## Canonical artifacts

### Product and delivery

- Product and operational intent: `spec.md`
- Machine-readable delivery contract: `development-automation.json`
- Delivery contract schema: `contracts/development-automation.schema.json`
- Work Map review: `work-map-integration.json`
- Dependency-ordered work: `tasks.md`
- Operation paths: `operation-paths.md`
- State model: `data-model.md`
- Traceability: `traceability.md`

### CI and development governance

- Machine-readable CI contract: `ci-automation.json`
- CI contract schema: `contracts/ci-automation.schema.json`
- Arabic CI adaptation blueprint: `CI_AUTOMATION_BLUEPRINT_AR.md`
- CI checklist: `checklists/ci.md`

### Gemini and runtime boundaries

- Gemini proposed-result contract: `contracts/gemini-evidence-result.schema.json`
- Draft HTTP boundary: `contracts/gemini-evidence-gateway.openapi.yaml`
- Security checklist: `checklists/security.md`
- Operations checklist: `checklists/operations.md`
- Completion state: `completion.json`

## Extracted CI model

The CI contract adapts useful repository patterns rather than copying workflows literally:

```text
Exact candidate checkout
→ changed-scope classification
→ static and contract gates
→ unit/integration/security tests
→ task/wave phase governance
→ diagnostic shards plus ordered progress
→ canonical evidence routing
→ trusted PR evidence publication
→ read-only generated-artifact validation
→ separately authorized sole writer
→ exact-head release and completion gate
```

Diagnostic logs help repair failures but are not success authority. Canonical structured summaries are bound to repository, candidate kind, candidate SHA, source head, task/wave, plan hash, and no-secret assertions.

## Lifecycle

```text
Specify
→ validate development and CI contracts
→ clarify open decisions
→ approve Work Map integration
→ freeze contracts
→ generate one bounded implementation work packet
→ implement bounded PR wave
→ verify exact-head CI and phase evidence
→ merge through governed authority
→ migrate/deploy through separate authority
→ production readback
→ completion gate and closeout
```

## Automation intent

The automation contracts are orchestration inputs, not execution authority. They may be consumed to generate plans, issues, PR scopes, test matrices, checklists, status summaries, repair candidates, and evidence requests. Every mutation still requires the nested tool's existing authority, approvals, confirmations, exact SHA/checksum binding, and readback.

A validator may detect stale generated output and produce an exact-head repair artifact. It must not silently commit or push. A remote writer, if later implemented, is separately authorized, path-restricted, exact-head bound, no-force, and followed by validation dispatch and pushed-SHA readback.

## Safety boundary

Gemini may extract, classify, summarize, embed, and propose. It must not independently approve, delete, grant access, select an ambiguous tenant/Brand, publish externally, mutate protected resources, or treat model output as authoritative evidence.

CI may validate, diagnose, summarize, and propose repair. It must not invent approvals, reuse stale evidence, widen a task's allowed paths, bypass nested authority, or declare completion without exact authoritative delivery and runtime evidence.
