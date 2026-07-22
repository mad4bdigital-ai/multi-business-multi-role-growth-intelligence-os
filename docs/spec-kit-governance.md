# Spec Kit Governance for the Growth Intelligence Platform

## Purpose

This repository adopts GitHub Spec Kit concepts for specification-driven brownfield delivery while retaining the platform's existing registry, capability, approval, audit, and readback governance.

The default lifecycle is:

```text
Constitution
→ Specify
→ Clarify
→ Plan
→ Tasks
→ Implement
→ Verify
→ Merge
→ Deploy
→ Closeout
```

Specifications are the source of intent. SQL and governed registries remain runtime authority. Spec Kit never authorizes a mutation by itself.

## Repository layout

```text
.specify/
  memory/constitution.md
  templates/
specs/
  NNN-feature-name/
    manifest.json
    spec.md
    research.md
    concerns.md
    operation-paths.md
    plan.md
    data-model.md
    contracts/
    quickstart.md
    tasks.md
    checklists/
    completion.json
docs/history/
```

Active delivery remains under `specs/`. Completed or superseded historical material moves to `docs/history/<topic>/` only after closeout and preserved traceability.

## Branch and numbering policy

- Scan active specifications and choose the next highest numeric prefix.
- Branch format: `gpt/spec-NNN-feature-YYYYMMDD` for Admin-assisted specification work.
- One branch owns one coherent feature specification.
- Duplicate historical numbers may remain, but new work uses the next maximum number and a unique semantic name.
- A spec branch must not carry unrelated runtime repairs.

## Brownfield specification policy

A brownfield spec must identify:

1. verified production baseline and evidence timestamp;
2. existing routes, registries, tables, policies, and consumers;
3. observed incident or product gap;
4. compatibility and migration constraints;
5. target behavior and non-goals;
6. operation paths and cross-cutting concerns;
7. implementation and closeout gaps.

Do not rewrite history or claim a capability exists because it appears in a draft contract.

## Artifact lifecycle

### Specify

Create `manifest.json`, `spec.md`, `research.md`, `concerns.md`, `operation-paths.md`, checklists, and initial contracts.

### Clarify

Resolve ambiguities affecting security, data ownership, public contracts, authority, lifecycle state, rollout, or rollback. Unresolved issues remain explicit with an owner and blocking gate.

### Plan

Create `plan.md`, `data-model.md`, `quickstart.md`, and contract details. Run the constitution check before implementation planning.

### Tasks

Create dependency-ordered `tasks.md` with requirement and operation-path traceability. Mark only genuinely independent tasks `[P]`.

### Implement

Implementation occurs in separate governed PRs when the specification is multi-PR. Each mutation requires its own capability and approval authority. The specification PR does not authorize runtime, database, provider, merge, or deployment mutations.

### Verify and closeout

`completion.json` remains pending until authoritative evidence confirms PR/CI, migration if any, deployment parity, health, runtime smoke, rollback posture, and unresolved gaps.

## Operation-path quality gate

Each operation path must contain:

- actor and authenticated principal;
- entry point and input;
- preconditions and authority sources;
- state transitions;
- normal and alternate sequence;
- structured errors and retryability;
- idempotency and replay behavior;
- observability and evidence;
- success readback;
- rollback, recovery, or support handoff.

A sequence diagram without denial, timeout, retry, and readback branches is incomplete.

## Cross-cutting concerns gate

At minimum evaluate:

- authentication and authorization;
- tenant/workspace/Brand isolation;
- resource and audience binding;
- privacy and no-secret handling;
- idempotency and replay;
- availability, dependency failure, and backpressure;
- performance and bounded responses;
- observability, lifecycle evidence, and alerts;
- compatibility, deprecation, and cutoff policy;
- migration, rollout, rollback, and cleanup;
- testing, documentation, and operator support.

## Repository automation integration

Use the Repository Automation Control Plane `spec_lifecycle` template for placement and lifecycle checks. Planning is read-only. Repository mutation still requires a ready capability envelope and the nested repository tool's own approval/readback contract.

## Generated files and canonical authority

Generated root canonical files are indexes. Edit sources under `canonicals/` and run `node build-canonicals.mjs`. OpenAPI generated artifacts must be rebuilt from their canonical source. A specification may draft contracts under its own `contracts/` directory without making them runtime-callable.

## Merge and deployment

A specification PR must pass required CI and remain fresh with `main`. Runtime implementation, migration, merge, and deployment are separate governed stages. Production normally deploys automatically from GitHub `main` to Hostinger; closeout requires production/main parity and health readback.

## References

- GitHub Spec Kit: `https://github.com/github/spec-kit`
- Spec Kit documentation: `https://github.github.com/spec-kit/`
- Platform repository automation: `docs/repository-automation-control-plane.md`
- Platform engineering authority: `AI_Agent_Knowledge_Guide.md`
