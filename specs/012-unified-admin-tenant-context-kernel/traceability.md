# Traceability

| Concern | Requirements | Design | Tests | Rollout gate |
|---|---|---|---|---|
| Shared Admin and Tenant kernel | FR-001 to FR-007, FR-043 | architecture shared kernel | principal matrix integration tests | shadow parity before writes |
| Effective subject separation | FR-015 to FR-020 | principal and authority path | impersonation and expiry tests | Admin writes gate |
| Ambiguity handling | FR-008 to FR-014 | ranking precedence | ordering and collision tests | strict ambiguity flag |
| Context switching | FR-021 to FR-025 | invalidation graph | tenant and workspace switch tests | context pin rollout |
| Exact connection binding | FR-027 to FR-030 | connection adapter and readiness | multi-connection tests | tenant writes gate |
| Plan and approval binding | FR-031 to FR-036 | execution plan and context hash | stale approval and concurrency tests | high-risk writes gate |
| Unknown outcome | FR-037 to FR-040 | outcome state machine | timeout and readback tests | reconciliation flag |
| No hardcoding | FR-041 to FR-045 | registry adapters and CI policy | static scanner and fixture tests | release blocking |
| Cross-tenant isolation | NFR-008 | visibility/candidate/execution sets | direct-object and graph tests | release blocking |
| API consistency | NFR-006, NFR-007 | OpenAPI contract | contract validation | API review gate |
