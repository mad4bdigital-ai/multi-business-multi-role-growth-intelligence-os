# UEACP Implementation Evidence

## Status

- Feature: `011-unified-effective-authority-control-plane`
- Status: `in_progress`
- Pull request: `#2888`
- Branch: `gpt/011-unified-effective-authority-control-plane-20260720`
- Evidence head: `2a095927d522818d9bdac40abc094a326388b2ef`
- Evidence base: `9296f28d8a48b1ee4c9fc17c6fe5b346ead983c4`
- Required CI checks: `4/4 pass`
- Merge, deployment, migration execution, provider mutation, external write, and enforcement cutover: not performed

This file records implementation evidence only. It does not close `tasks.md`, authorize migration execution, claim live parity, or approve enforcement cutover.

## Implemented and Tested

### Domain and authority resolution

- Typed authority contracts for Principal, Subject Scope, Capability, Resource, Decision, Gap, readiness, and version evidence.
- Platform Admin and Tenant scope normalization through the shared authority-scope foundation.
- Zero-tenant UUID normalization prevents the platform placeholder from becoming a real tenant filter.
- Deterministic connection selection and ambiguity blocking.
- Set-order invariant: `Executable Candidate ⊆ Projected ⊆ Authorized ⊆ Registered`.
- No-secret evidence validation covering separated credential metadata keys such as `credential_ref`.

### Read-only APIs and Activation

- Admin routes under `/authority/...` and Tenant routes under `/me/authority/...` use one Application service and separate authentication boundaries.
- Centralized user JWT middleware is used; route-local JWT verification is prohibited.
- Connector inventory projection uses cursor pagination and explicit scope filtering.
- `authorized_access.effective_authority` is an optional backward-compatible Activation field.
- The Activation projection is non-authoritative and preserves:
  - `authority_granted=false`
  - `enforcement_mode=shadow_only`
  - `legacy_runtime_authoritative=true`
  - `execution_authority_changed=false`
  - `provider_calls=false`
  - `credential_payload_reads=false`
  - `external_writes=false`
  - `secrets_included=false`

### Evidence and reconciliation

- Optional shadow decision and projection-drift ledgers are implemented behind `UEACP_SHADOW_EVIDENCE_MODE`.
- Default evidence mode is `disabled`.
- Decision evidence uses canonical JSON, SHA-256, bounded payload size, parameterized SQL, and same-cycle hash readback.
- Reconciliation compares active registered authority scopes with connector projection counts.
- A synthetic `system_reconciler` principal is used for reconciliation evidence.
- The periodic scheduler is wired to startup but disabled unless `UEACP_RECONCILIATION_ENABLED` is explicitly enabled.
- The scheduler prevents overlapping runs and defaults to preview rather than persistence.

### API contract and observability

- Primary `http-generic-api/openapi.yaml` documents the optional Activation projection using OpenAPI 3.1.
- Parser-backed tests verify that `authorized_access` and `effective_authority` remain optional.
- Structured startup and reconciliation events exclude manifests, principal identifiers, credential material, and secret values.
- Operational guidance is documented in `docs/ueacp-shadow-reconciliation.md`.

## Migration Evidence

### Capability registration

- File: `http-generic-api/migrations/20260721_ueacp_connector_inventory_read.sql`
- Purpose: register `connector.inventory.read` in `platform_semantic_capabilities`.
- Contract evidence: additive, idempotent, transaction-bound, no destructive SQL.
- Pinned checksum in CI: `4227bc9f3168200c9f55e3579ef036addad020bffeeed7de4b316569a085c046`.
- Governed statement count: `2`.
- Execution status: not executed.

### Shadow evidence storage

- File: `http-generic-api/migrations/20260721_ueacp_shadow_decision_ledger.sql`
- Tables: `effective_authority_shadow_decisions`, `authority_projection_drift_events`.
- SQL constraints force shadow-only, no-authority, no-provider-call, no-credential-read, no-external-write, and no-secret rows.
- Execution status: not executed.

The governed migration runner reads the deployed `main` migration directory. Branch-only migrations cannot receive a live runner dry-run before they are present in the deployed source. CI migration-contract tests therefore provide pre-merge evidence; they do not replace post-merge governed dry-run, apply authorization, or schema readback.

## Live Parity Evidence

Platform capability compile and projection previews were executed for `connector.inventory.read` against the live registry.

- Compile-preview manifests: `0`
- Projection-preview manifests: `0`
- Cause: `connector.inventory.read` is not registered in the live capability registry before migration execution.
- Result: live parity is not claimed.

Live shadow parity remains blocked until capability registration is applied and read back through the governed migration path.

## Task Evidence

### Completed slices

- `T004` typed authority contracts.
- `T005` non-configurable safety invariants.
- `T006` reason-code and no-secret redaction rules.
- `T015` deterministic connection selection and ambiguity blocking.
- `T017` no-secret Effective Authority Manifest.
- `T018` bounded shadow decision evidence.
- `T020` additive migration design against the live table census.
- `T030` connector readiness dimensions.
- `T031` Admin authority diagnostics.
- `T035` backward-compatible legacy fields.
- `T041` Admin visibility versus mutation tests.
- `T044` connection ambiguity tests.
- `T046` no-secret serialization tests.

### Partial slices

- Principal and Subject Scope resolution do not yet cover the complete support delegation, impersonation, and revoked-principal matrix.
- Resource Graph resolution and policy/grant evaluation are not complete for every platform resource family.
- Decision and drift ledgers exist, but version-vector invalidation and full lifecycle consumers are incomplete.
- Dynamic Tabs, Dashboard, and Tool Catalog consume existing Activation surfaces, but exact-ID cross-projection parity certification is incomplete.
- Reconciliation covers Registered, Authorized, Projected, and Executable Candidate counts; full Observed-state parity, alerts, ownership, and SLO telemetry remain open.
- OpenAPI is updated, while canonical regeneration and closeout remain open.

### Not authorized or not complete

- Shared PEP enforcement at dispatch.
- Canary or write enforcement.
- High-risk capability certification.
- Legacy authorization path removal.
- Migration execution.
- Production deployment and verification.
- Post-merge audit.
- Spec Kit closeout.

## Safety Readback

- Branch runtime behavior changes exist, but no branch code has been deployed.
- Legacy runtime remains authoritative.
- Scheduler and evidence persistence are disabled by default.
- No provider mutation or external write was performed.
- No credential payload was read.
- No migration was applied.
- No merge or deployment was performed.
- No enforcement cutover or legacy removal was authorized.
- `secrets_included=false`.

## Remaining Gates

1. Complete delegation, resource-graph, invalidation, and shared PEP shadow slices.
2. Update affected canonicals and run `node build-canonicals.mjs`.
3. Complete feature-specific security review.
4. Merge only after final CI and release-readiness evidence on a fresh base.
5. After merge, execute checksum-bound migration dry-run and apply under separate authorization.
6. Verify capability registration, ledger schema, and no-secret constraints through same-cycle readback.
7. Run live Admin and Tenant shadow parity with synthetic revoked and delegated principals.
8. Complete production verification and post-merge audit before closing the Spec Kit.
