# Implementation Plan: Governed Hostinger Storage Orchestration

**Spec**: `specs/014-governed-hostinger-storage-orchestration/spec.md`  
**Branch**: `gpt/hostinger-safe-storage-cleanup-ssh-20260801`  
**Status**: Implementation in progress — non-production core only

## Constitution check

| Principle/gate | Evidence | Status |
|---|---|---|
| Work Map integration and dimension discovery | `work-map-integration.json` binds 19 maps and 16 domains | pass |
| Complete schema classification | Current coverage matrix has zero unresolved/intentionally unclassified objects; proposed entities mapped to existing domains | design pass; migration gate pending |
| Existing-map reuse before new-map proposal | No new map proposed; existing maps reused/extended | pass |
| Registry and SQL authority | Existing Context Kernel, authority, approvals, resource graph, migration runner | pass by design |
| Complete operation paths | `operation-paths.md` OP-001–OP-012 | pass |
| Security and tenant isolation | `concerns.md`, `threat-model.md`, checklist | pass by design |
| Contract-first surfaces | OpenAPI and JSON Schemas under `contracts/` | pending creation/validation in this package |
| Durable/replay-safe execution | Immutable plan, idempotency, lease, journal, reconciliation | pass by design |
| Evidence/readback | Provider + SSH + runtime readback contract | pass by design |
| Brownfield compatibility | Additive, default-off, one shared service | pass |
| Testing and fault injection | `testing-strategy.md`, synthetic apply and unknown-outcome drills | planned |
| Governed delivery | phased rollout, exact-head CI, no force push | pass |

## Verified baseline

- Provider incident evidence: Hostinger stated plan storage limit was reached and temporarily increased the limit.
- Current `main` synchronized into feature branch at `a0ad040abfd7b99c6d6536ac9f6b80fcf0879d70` through merge commit `44e131117e3959099c8607cca4f5fc139ef5a228`.
- Existing runtime implementation in branch: conservative shell tool, cleanup/orchestration policies, pure authority resolver, tests, CI guard, and docs.
- Existing relevant platform surfaces: Context Kernel, Unified Effective Authority, Capability Envelope, Resource Authority, approval center, remote runtime targets, operational alerts, audit/evidence, migration runner, release governance.
- Work Map registry fingerprint: `b6f6ef53c0ddf181ef0c070e5b48905a618b28748c36f803146901d23ddbe36a`.
- Work Map index source hash: `b875f59334d878209754ce9dc95b3f319982bd2af83076dd34c0c1fd0e174a47`.
- Coverage source hash: `f5b3be7e6549d47fec89925fff685cf8bfcf7683573090e8b62a2b6f05eac831`.
- Known gaps: hPanel quota ingestion, live Hostinger layout certification, durable persistence, route wiring, worker adapter, pinned host key, approval/lease composition, synthetic/live readback.

## Technical approach

### Boundary

One application-domain service receives normalized Admin/Tenant requests. It composes existing context and authority systems, creates/reads immutable orchestration state, and issues a fixed provider invocation to a dedicated worker only after runtime certification.

```text
Admin/Tenant route
-> context resolution
-> target/resource resolution
-> authority policy
-> operation envelope/idempotency
-> snapshot/plan/approval/lease state
-> dispatch readiness
-> fixed worker adapter
-> journal/readback/reconciliation
-> context-safe projection
```

### Components

1. `HostingerStorageOrchestrationPolicy`: pure operation/context/ownership decision logic.
2. `HostingerStorageOrchestrator`: application service for operation envelopes, idempotency, approval/lease/readiness, projection, and reconciliation.
3. Storage repositories: targets, snapshots, operations, plans, items, impacts, approvals, leases, runs, incidents.
4. Admin/Tenant route adapters: separate HTTP surfaces, shared service.
5. Hostinger SSH provider adapter: fixed script path/actions, pinned host key, credential resolver, bounded output.
6. hPanel quota evidence adapter: supported provider API/export/manual governed evidence until automated source is available.
7. Promotion preflight adapter: read-only dependency of `main`→`Production` release.
8. Observability/incident integration.

### Smallest safe change

The rollout starts with pure policy and read-only inventory. No live mutation is enabled until all authority and provider requirements are independently certified. Existing deployment and tenant behavior remains unchanged.

## Workstreams

### WS0 — Work Map and dimension integration

- Maintain `work-map-integration.json` current with main.
- Classify every proposed schema object into existing domains and maps.
- Regenerate Work Maps only through governed producers.
- Re-run readiness after any main movement affecting maps/classification.

### WS1 — Contracts and state model

- Finalize OpenAPI Admin/Tenant contract.
- Finalize operation, plan, and evidence schemas.
- Design additive schema/migration set.
- Define lifecycle, invalidation, retention, and projections.

### WS2 — Authority and application orchestration

- Complete pure orchestrator core.
- Bind Context Kernel and Effective Authority.
- Bind approval center, delegation/break-glass, Resource Authority, Capability Envelope, and lease service.
- Implement tenant/admin projection policies.

### WS3 — Provider adapters and runtime

- Implement hPanel quota evidence ingestion.
- Certify actual Hostinger resource/deployment layout.
- Implement fixed SSH worker adapter with pinned host key.
- Implement reserve release without pre-allocation under inode exhaustion.
- Keep apply dispatch disabled until synthetic certification.

### WS4 — Tests and fault injection

- Unit/contract tests for authority and state.
- Filesystem synthetic tests.
- Cross-tenant leakage tests.
- TOCTOU/inode replacement tests.
- Approval/revision/lease/replay tests.
- Host-key mismatch, timeout, partial output, worker crash.
- Unknown outcome and reconciliation tests.
- Promotion block and readback completeness tests.

### WS5 — Rollout and closeout

- Read-only Admin/Tenant scan.
- Plan/inspect/approval center.
- Synthetic apply.
- Tenant-exclusive canary.
- Platform/shared canary.
- Reserve and release integration.
- Deployment-history cleanup and promotion gate.
- Exact Production readback and incident-prevention evidence.

## Dependency order

```text
Work Map readiness
-> contract/state freeze
-> additive migration design and classification
-> pure orchestration core
-> read-only repositories/routes
-> quota + SSH scan adapters
-> plan/approval/lease persistence
-> synthetic fixed-worker apply
-> reconciliation certification
-> tenant-exclusive canary
-> platform/shared canary
-> release/preflight integration
-> Production closeout
```

## Data and migration plan

### Proposed additive migration waves

1. `storage_provider_accounts`, `storage_targets`, `storage_target_bindings`.
2. `storage_pressure_snapshots`, policy revision/readback support.
3. `storage_cleanup_operations`, plans, items, impacts.
4. approvals and execution leases.
5. runs, run items, reconciliation results.
6. emergency reserves and incident links.
7. read-only Admin/Tenant projections and operation/tool registrations default-off.

### Governance

- No SQL is created or applied by the specification PR unless explicitly added as a later implementation task.
- Every object is classified in the canonical schema classification registry before migration PR merge.
- Apply uses governed migration runner with typed authorization.
- Same-cycle readback validates schema, indexes, constraints, seeds, and tool registration.
- Rollback before live data may remove additive objects through a separate approved migration; after live data, disable and preserve evidence.

## API and contract plan

### Admin contract

- Target/account snapshots and incidents.
- Plan create/inspect/request/approve/apply/readback.
- Reserve status/create/release.
- Policy and release preflight.

### Tenant contract

- Owned resource snapshot.
- Plan create/inspect/request/approve/apply/readback.
- No account-wide, reserve, policy, or shared apply operations.

### Compatibility

- New versioned routes only.
- Default-off feature and dispatch flags.
- Responses use structured errors and stable identifiers.
- OpenAPI generation remains canonical-source governed when runtime wiring begins.

## Security plan

- Explicit context and effective subject before target discovery.
- Target/resource audience and ownership revision.
- Admin/Tenant separation and dual-role context selection.
- Tenant Operator cannot approve/apply.
- Admin tenant mutation requires delegation/break-glass and support case.
- Shared impact set and approvals.
- Capability Envelope, Resource Authority, lease, typed confirmation.
- Fixed provider operation and pinned host key.
- No secret persistence/output.
- Per-item stat revalidation and plan consumption.
- Security tests mapped in `threat-model.md` and `testing-strategy.md`.

## Test plan

| Layer | Coverage |
|---|---|
| Pure unit | context, roles, ownership scopes, revisions, approval matrix, state transitions |
| Contract | OpenAPI and JSON Schema examples/errors/projections |
| Repository | policy JSON, Work Map readiness, shell syntax, no-dangerous-command guard |
| Filesystem synthetic | scan/plan/inspect/apply, protected paths, inode replacement, replay |
| Integration | Context Kernel, authority, approval, lease, repositories, worker dispatch |
| Fault injection | timeouts, worker crash, host-key mismatch, changed files, duplicate response, unknown outcome |
| Security | cross-tenant IDs, absolute paths, secret-like output, support delegation, shared impact |
| Migration | schema preflight/apply/readback/rollback design |
| Release | critical/emergency pressure blocks promotion without cleanup |
| Production smoke | status/health/version/deployment-info, File Manager/environment probe, hPanel usage |

## Rollout plan

See `rollout.md`. Every phase has:

- default-off flag;
- target allowlist;
- authority/certification prerequisites;
- success metrics;
- monitoring window;
- rollback trigger;
- readback and human acknowledgement.

Apply remains disabled until Phase 4 synthetic certification. Shared/deployment cleanup remains disabled until final phases.

## Evidence and completion

Required authoritative evidence:

- current Work Map manifest and classification.
- task/requirement/acceptance traceability.
- exact PR head/base and successful CI.
- approved migration and same-cycle readback when created.
- route/registry flags and target allowlist.
- pinned SSH host key evidence.
- synthetic apply and unknown-outcome drills.
- canary before/after byte/inode/readback.
- no-secret evidence.
- Production branch/SHA and runtime parity.
- hPanel storage pressure below accepted threshold.
- File Manager and environment-variable write recovery probes.
- unresolved gaps classified and owned.

## Risks and mitigations

| Risk | Probability | Impact | Prevention | Detection | Recovery |
|---|---|---|---|---|---|
| Work Map dimension omitted | L | H | all-map manifest and CI gate | readiness findings | resolve/regenerate |
| Schema object unclassified | M | H | canonical classification registry | classification CI | classify before migration |
| Tenant crosses ownership boundary | M | Critical | context/resource/ownership binding | isolation tests/audit | block and security incident |
| Admin steals tenant authority | M | Critical | delegation/break-glass requirement | denial tests/audit | revoke/incident review |
| Active deployment deleted | L | Critical | protected root and active-SHA exclusion | layout/readback tests | rollback release/provider restore |
| TOCTOU candidate replacement | M | H | inode/device/ctime/mtime revalidation | per-item skip evidence | generate new plan |
| Shared impact omitted | M | Critical | impact resolution fail-closed | unresolved impact finding | block and re-plan |
| Host-key spoof/rotation | L | Critical | pinned fingerprint | worker mismatch | security review/repin |
| Storage full prevents recovery state | M | H | read-only scan and emergency reserve | write probe | reserve release/provider boost |
| Provider outcome unknown | M | H | durable journal and no retry | unknown_outcome state | reconciliation/support |
| Stale hPanel evidence | M | H | freshness requirement | stale evidence code | refresh/block release |
| Worker exposes secret | L | Critical | reference-only credentials/redaction | secret scanner | stop/revoke/incident |
| Branch drifts from main | H | M | ancestry-preserving sync, no force | compare readback | sync and rerun CI |
