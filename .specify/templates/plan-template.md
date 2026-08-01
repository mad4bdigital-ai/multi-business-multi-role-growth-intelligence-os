# Implementation Plan: [FEATURE NAME]

**Spec**: `specs/[NNN-feature]/spec.md`  
**Branch**: `[branch]`  
**Status**: Draft

## Constitution check

| Principle/gate | Evidence | Status |
|---|---|---|
| Work Map integration and dimension discovery | `work-map-integration.json` | [pass/gap] |
| Complete schema classification | classification gate readback | [pass/gap] |
| Existing-map reuse before new-map proposal | integration decisions and comparison evidence | [pass/gap] |
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
- Work Map registry fingerprint: [value]
- Schema classification registry hash: [value]
- Known gaps: [value]

## Technical approach

Describe boundaries, components, dependencies, generated-file authority, Work Map integration decisions, and why this is the smallest safe change. Any newly discovered dimension must first be tested against reuse, extension, composition, and generator/taxonomy extension of current maps.

## Workstreams

### WS0 — Work Map and dimension integration

- Generate and review `work-map-integration.json`.
- Bind relevant maps and domains to requirements, tasks, acceptance tests, and evidence.
- Resolve taxonomy gaps through existing maps or explicit governed exceptions.

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
Work Map scaffold
→ dimension decisions
→ implementation readiness
→ contracts/state
→ implementation
→ tests
→ CI
→ merge
→ deploy
→ readback
```

## Data and migration plan

List schema changes, domain classification, existing Work Map coverage, authorization/migration runner, preflight, backfill, indexes, rollback, and same-cycle readback. State `none` when not applicable.

## API and contract plan

List canonical sources, generated outputs, compatibility, examples, errors, consumer impact, and the Developer/API and connector map decisions.

## Security plan

List threat scenarios, verification boundaries, authority resolution, no-secret controls, security tests, and the Policy/Authority map decision.

## Test plan

Map requirements and operation paths to unit, integration, contract, fault-injection, CI, deployment, production smoke tests, and every integrated or extended Work Map dimension.

## Rollout plan

Define phases, flags, canary/dark deployment, monitoring window, acceptance thresholds, rollback triggers, cleanup, and observability/release map integration.

## Evidence and completion

Define authoritative evidence for Work Map readiness, classification coverage, tasks, PR/CI, migration, deployment parity, health, smoke, unresolved gaps, and acknowledgement.

## Risks and mitigations

| Risk | Probability | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| Work Map dimension omitted | M | H | generated all-map manifest and fail-closed gate | CI finding | resolve and regenerate |
| Schema object left unclassified | M | H | canonical classification registry | classification gate | classify or approve bounded exception |
| [risk] | [L/M/H] | [L/M/H] | [control] | [signal] | [action] |
