# Implementation Plan: [FEATURE NAME]

**Spec**: `specs/[NNN-feature]/spec.md`  
**Branch**: `[branch]`  
**Status**: Draft

## Constitution check

| Principle/gate | Evidence | Status |
|---|---|---|
| Registry and SQL authority | [source] | [pass/gap] |
| Complete operation paths | `operation-paths.md` | [pass/gap] |
| Security and tenant isolation | `concerns.md`, checklist | [pass/gap] |
| Contract-first surfaces | `contracts/` | [pass/gap] |
| Durable/replay-safe execution | [design] | [pass/gap] |
| Evidence/readback | [design] | [pass/gap] |
| Brownfield compatibility | [analysis] | [pass/gap] |
| Testing and fault injection | [test plan] | [pass/gap] |
| Governed delivery | [rollout] | [pass/gap] |

## Verified baseline

- Production commit/evidence: [value]
- Existing routes/contracts: [value]
- Existing registries/tables: [value]
- Known gaps: [value]

## Technical approach

Describe boundaries, components, dependencies, generated-file authority, and why this is the smallest safe change.

## Workstreams

### WS1 — Contracts and state model

- [deliverable]

### WS2 — Runtime behavior

- [deliverable]

### WS3 — Governance and authority

- [deliverable]

### WS4 — Tests and fault injection

- [deliverable]

### WS5 — Rollout and closeout

- [deliverable]

## Dependency order

```text
[spec] → [contracts/state] → [implementation] → [tests] → [CI] → [merge] → [deploy] → [readback]
```

## Data and migration plan

List schema changes, authorization/migration runner, preflight, backfill, indexes, rollback, and same-cycle readback. State `none` when not applicable.

## API and contract plan

List canonical sources, generated outputs, compatibility, examples, errors, and consumer impact.

## Security plan

List threat scenarios, verification boundaries, authority resolution, no-secret controls, and security tests.

## Test plan

Map requirements and operation paths to unit, integration, contract, fault-injection, CI, deployment, and production smoke tests.

## Rollout plan

Define phases, flags, canary/dark deployment, monitoring window, acceptance thresholds, rollback triggers, and cleanup.

## Evidence and completion

Define authoritative evidence for tasks, PR/CI, migration, deployment parity, health, smoke, unresolved gaps, and acknowledgement.

## Risks and mitigations

| Risk | Probability | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| [risk] | [L/M/H] | [L/M/H] | [control] | [signal] | [action] |
