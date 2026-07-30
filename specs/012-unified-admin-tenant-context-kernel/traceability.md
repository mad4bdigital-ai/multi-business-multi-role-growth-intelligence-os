# Traceability

| Concern | Requirements | Design | Tests | Rollout gate |
|---|---|---|---|---|
| Shared Admin and Tenant kernel | FR-001 to FR-007, FR-043 | architecture shared kernel | principal matrix integration tests | shadow parity before writes |
| Effective subject separation | FR-015 to FR-020 | principal and authority path | impersonation and expiry tests | Admin writes gate |
| Ambiguity handling | FR-008 to FR-014 | ranking precedence | ordering and collision tests | strict ambiguity flag |
| Context switching | FR-021 to FR-025 | invalidation graph | tenant and workspace switch tests | context pin rollout |
| Exact connection binding | FR-027 to FR-030 | connection adapter and two-stage readiness | multi-connection and readiness-phase tests | tenant writes gate |
| Plan and approval binding | FR-031 to FR-036, NFR-013 | execution plan and context hash precede guarded credential materialization | stale approval, concurrency, and approval-before-provider-readiness tests | high-risk writes and flow-order gate |
| Unknown outcome | FR-037 to FR-040 | outcome state machine | timeout and readback tests | reconciliation flag |
| No hardcoding | FR-041 to FR-045 | registry adapters and CI policy | static scanner and fixture tests | release blocking |
| Workspace ownership classification | FR-046, FR-057, FR-062, FR-064, NFR-011 | independent `workspaceOwnershipType`; additive `workspace_ownership_type`; operational `workspaceType` preserved | operational-type compatibility, unclassified legacy, owner-conflict, revision invalidation, migration-readback tests | governed persistence migration before rollout |
| Exact connection owner scope | FR-047 to FR-050, FR-063 | `ConnectionOwnershipScope`; immutable selected owner scope; exact brand/workspace/user predicates | personal owner, company membership, brand/workspace, cross-user, cross-brand, downstream binding tests | cross-user and cross-brand release gate |
| Deterministic connection precedence | FR-051 to FR-055 | explicit → brand → workspace → policy-allowed personal; deny silent widening | equal-rank ambiguity, invalid explicit pin, revoked brand write, personal inheritance tests | ambiguity and no-silent-fallback gate |
| Credential boundary and two-stage readiness | FR-027, FR-056 to FR-057, NFR-013 | pre-credential gates and approved plan → guarded materialization → provider readiness | no-secret, premature-materialization rejection, approval-order, credential-validity/reachability, membership/scope/revision invalidation tests | credential-boundary and readiness gate |
| Identity versus provider consent | FR-058 | separate identity and provider readiness states | Google login without consent and reconnect-required tests | provider-consent readiness gate |
| OAuth authorization and reconnect state | FR-059 to FR-060, FR-066, NFR-010 | signed exact-context state; reconnect target/revision/account binding; atomic revision-bound claim from `issued` to `claimed` before exchange | signature, sequential replay, concurrent claim, expiry, redirect, connection-revision, provider-account, and context-mismatch tests including A-55 | OAuth claim and security release gate |
| Planned connection APIs | FR-061, NFR-006, NFR-007 | planned public boundary remains unexposed until OpenAPI and implementation PR | OpenAPI 3.1 validation, strict input, no-secret projection, pagination, idempotency tests | API contract review gate |
| Legacy connection compatibility | FR-062 | additive classification and compatibility adapter | legacy personal/workspace ambiguity, no-destructive-backfill, parity tests | compatibility support-window gate |
| Migration before runtime | FR-064, NFR-012 | separate authorization, dry-run, ledger, same-cycle readback before dependent rollout | shadow/read startup blocked before readback; checksum and schema/data readback tests | migration-readback prerequisite |
| Owner-safe rollback | FR-065, NFR-012 | exact-owner guard remains independent; affected operations disable/fail closed | rollback-to-legacy-selector rejection and guard-unavailable tests | rollback isolation gate |
| ECE and Effective Authority integration | FR-063 | Context Kernel connection and owner-scope decision consumed by downstream authority/capability planes | competing-selector rejection and exact-decision binding tests | authority/capability integration gate |
| Cross-tenant isolation | NFR-008 | visibility/candidate/execution sets | direct-object and graph tests | release blocking |
| Cross-user and cross-brand isolation | NFR-009 | exact owner predicates and tenant-safe repositories | A-31 to A-34 and A-39 to A-40 | release blocking |
| API consistency | NFR-006, NFR-007 | OpenAPI contract | contract validation | API review gate |
