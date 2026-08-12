# Tenant Connection Promotion Readiness

## Purpose

This evidence note records the comparison of the attached Tenant Connection review with the repository state included in PR #6952. It is intentionally a **read-only source and contract assessment**. It does not claim Production closure, live SQL readback, capability promotion, provider certification, active Tenant export creation, or Cloudflare/runtime changes.

The review confirms that the principal Tenant Connection gaps are **promotion and governance gaps rather than missing route implementations**. The existing runtime is deliberately fail-closed until certification, provenance, dispatch, authority, and readback evidence are complete.

## Capability coverage

| Capability | Source evidence | Current contract state | Treatment in this PR | Remaining boundary |
|---|---|---|---|---|
| `tenant_connection_effective_credential_plan_view` | `http-generic-api/tenantConnectionSelfRepairService.js`; `test-tenant-connection-self-repair-service.mjs` | Read-only, no provider write, no raw secret return, readback required | Promotion order and read-only semantics are regression-tested | Tenant authority/export promotion requires external evidence |
| `tenant_connection_validate_adapter_smoke` | `tenantConnectionSelfRepairService.js`; self-repair tests | Read-only provider smoke contract with adapter overlay and readback | Included in the ordered contract regression | Certification and dispatch evidence remain required |
| `tenant_connection_binding_refresh` | `tenantConnectionSelfRepairService.js`; self-repair tests | Internal write, operator approval and readback required; provider write disabled by generic contract | Explicitly covered as a governed write in the regression | Provenance, dispatch, hard-block removal, and active export remain runtime gates |
| `tenant_connection_resolver_refresh` | `tenantConnectionSelfRepairService.js`; self-repair tests | Internal write, operator approval and readback required | Included in ordered promotion contract | Registry enablement and authority evidence remain external |
| `tenant_connection_readback_certification` | `tenantConnectionShadowContractBootstrap.js`; shadow bootstrap test | Shadow contract is `certification_status: pending` and `status: shadow` | Shadow state and no-certification semantics remain fail-closed | Certification issuance is intentionally not performed |
| `tenant_connection_recertification_policy` | `tenantConnectionSelfRepairService.js`; shadow contract bootstrap | Internal write with adapter overlay, operator approval, and readback | Included in ordered promotion contract | Callable Tenant promotion remains blocked |
| `tenant_connection_provider_grant_refresh` | `tenantConnectionSelfRepairService.js`; shadow contract bootstrap | External-write-class contract, but generic shadow adapter has `supports_write: false` and provider writes disabled | Explicitly kept behind adapter/certification gates | Provider certification, provenance, dispatch, and export are not available locally |
| `tenant_connection_bounded_mutation_preflight` | `tenantConnectionSelfRepairService.js`; self-repair tests | Preview-only; requires `dry_run=true`, `preflight_only=true`, approval, and readback | Preconditions are regression-tested | No migration or live preflight is executed |
| `tenant_connection_bounded_mutation_execute` | `tenantConnectionSelfRepairService.js`; self-repair tests | Provider write class; requires adapter overlay, operator approval, `preflight_id`, live approval, readback; publish/destructive path is blocked by default | The fail-closed ordering is regression-tested | It remains blocked until adapter-specific certification and authority evidence exist |

The expected promotion ordering recorded by the regression is: **effective credential plan view → adapter smoke validation → binding refresh → resolver refresh → readback certification → recertification policy → provider grant refresh → bounded mutation preflight → bounded mutation execute**. This ordering prevents a write-capable or provider-facing surface from being treated as ready before the read-only, provenance, certification, and readback prerequisites.

## Shadow bootstrap and export boundaries

`tenantConnectionShadowContractBootstrap.js` and migration `20260714_tenant_connection_shadow_contract_bootstrap.sql` define a deliberately non-write-capable adapter. The adapter has `supports_write: false`, `shadow_only: true`, `provider_calls_allowed: false`, and `external_writes_allowed: false`. The nine contracts begin with `certification_status: pending` and `status: shadow`; the readback verifier requires zero enabled target Tenant tools and zero active Tenant exports.

The migration registers an **Admin-only internal bootstrap**. Its internal dispatch registration is not equivalent to an active Tenant capability export. The migration explicitly forbids Tenant tool enablement, active Tenant export creation, certification issuance, provider calls, external writes, Tenant authority changes, and secret return. No PR change in this evidence pass opens those boundaries.

The existing blocked-export cleanup tests also cover `tenant_agent_surface_deployment_upsert`. They require the cleanup to join the current compiled manifest, disable a Tenant tool when the manifest is `blocked`, and avoid altering compiled manifests or performing provider/credential operations. The route implementation and transaction/readback coverage therefore remain present without implying callable Tenant promotion.

## Connect bootstrap and Agent Surface

`connect_bootstrap` is already implemented as Managed-only orchestration. Its transaction path requires final readback of an active Tenant, active membership, and an active Managed backend connection before commit; rollback failures are surfaced as indeterminate rather than reported as success. The existing service and transaction tests cover these conditions. This review therefore classifies remaining work as registry/authority reconciliation, not missing route code.

`tenant_agent_surface_deployment_upsert` is also implemented and represented in the surface-callability closure. The fail-closed cleanup migration disables it when the compiled capability manifest is blocked. This PR does not promote the surface, remove the hard block, or create an active Tenant export.

## Scope and non-claims

This note does not close the live P0/P1/P2 runtime issues. Production database authority, live SQL readback, capability assurance provenance, dispatch certification, active Tenant exports, provider certification, and external reconciliation remain required before any promotion. It also does not represent a full audit of all 186 platform capability gaps; the comparison is limited to the Tenant Connection and adjacent `connect_bootstrap`/Agent Surface concerns described in the attached review.

| Boundary | Result in this PR |
|---|---|
| Provider calls | Not executed |
| External writes | Not executed |
| Production migrations | Not applied |
| Live database readback | Not claimed |
| Tenant tool enablement | Not performed |
| Active Tenant exports | Not created |
| Certification issuance | Not performed |
| Raw credentials/secrets | Not read or returned |
| Cloudflare changes | Not performed |

## References

1. `http-generic-api/tenantConnectionSelfRepairService.js` — nine route contracts, approval/readback gates, credential redaction, and bounded mutation preconditions.
2. `http-generic-api/test-tenant-connection-self-repair-service.mjs` — regression coverage for the ordered contract and fail-closed request validation.
3. `http-generic-api/tenantConnectionShadowContractBootstrap.js` — shadow adapter, nine pending contracts, zero-export readback, and apply envelope requirements.
4. `http-generic-api/test-tenant-connection-shadow-contract-bootstrap.mjs` — static and dry-run safety assertions for the shadow bootstrap.
5. `http-generic-api/migrations/20260714_tenant_connection_shadow_contract_bootstrap.sql` — additive Admin bootstrap registration with no Tenant enablement or provider side effects.
6. `http-generic-api/migrations/20260719_tenant_blocked_tool_exports_fail_closed.sql` and `http-generic-api/migrations/20260719_tenant_blocked_capability_exports_fail_closed.sql` — blocked-manifest cleanup for Tenant tools and exports.
7. `http-generic-api/tenantConnectBootstrapTransaction.js` and `http-generic-api/tenantConnectBootstrapService.js` — Managed-only transaction and final readback requirements.
8. `http-generic-api/test-surface-callability-full-closure.mjs` — implementation, transaction/readback markers, route, and OpenAPI closure for the Agent Surface route.
9. `http-generic-api/test-tenant-blocked-tool-export-registry-cleanup.mjs` and `http-generic-api/test-tenant-blocked-capability-export-cleanup.mjs` — fail-closed blocked export registry tests.
10. `http-generic-api/resource-api-surface-callability.manifest.json` — committed route/callability source manifest for `tenant_agent_surface_deployment_upsert`.

All claims above are bounded to committed source and static tests. No production or provider state is inferred from these files.
