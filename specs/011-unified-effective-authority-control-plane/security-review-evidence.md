# UEACP Feature Security Review Evidence

## Review status

- Feature: `011-unified-effective-authority-control-plane`
- Pull request: `#2888`
- Reviewed head: `a5ea354fb98df3662f08d3e36a2e21b604e34021`
- Reviewed base: `e73aa51a1c62a737df7fb16df39a75ee2dec762d`
- Required CI checks: `4/4 pass`
- Review result: `in_progress_with_open_gates`
- Security-owner approval: not recorded
- Merge, deployment, migration execution, scheduler activation, provider calls, external writes, and enforcement cutover: not performed

This document records an implementation-focused security review of the current shadow-only slice. It does not replace approval by the designated security owner and does not authorize migration execution, live parity claims, shared PEP enforcement, or legacy cutover.

## Reviewed trust boundaries

### Authentication and route authorization

- Admin authority routes require the configured backend authentication middleware and an Admin principal.
- Tenant authority routes use the centralized user-JWT middleware rather than route-local token verification.
- Tenant routes require `mode=user_jwt`, `user_id`, and `tenant_id` before invoking the application service.
- Missing authentication, missing Admin authority, missing Tenant identity, and unavailable authentication dependencies use distinct fail-closed error paths.
- No generic Admin execution bypass or zero-tenant-as-Admin proof is introduced by the UEACP routes.

Evidence surfaces:

- `http-generic-api/routes/effectiveAuthorityRoutes.js`
- `http-generic-api/test-effective-authority-routes.mjs`
- `http-generic-api/test-effective-authority-composition.mjs`

### Tenant and platform scope isolation

- Tenant request fields cannot override the signed Tenant identity in `/me/authority/...` controllers.
- A Tenant request that supplies `tenantId` in query or body is rejected as `AUTHORITY_UNSUPPORTED_FIELD` before the application service is called.
- The Subject Scope resolver rejects Tenant A requesting Tenant B with `CROSS_TENANT_AUTHORITY_SCOPE_DENIED` and status `403`.
- Effective Authority now resolves Subject Scope before capability lookup, so a rejected cross-tenant request performs no capability lookup, connector query, projection summary, or evidence write.
- Tenant connector SQL predicates are parameterized and bind only the resolved Tenant ID.
- Activation projection derives Tenant scope from the signed subject and does not propagate an untrusted Tenant override.
- The platform placeholder tenant UUID normalizes to no Tenant filter and does not become proof of Admin authority.

Evidence surfaces:

- `http-generic-api/src/application/authorityScope/authorityScopeService.js`
- `http-generic-api/src/application/effectiveAuthority/effectiveAuthorityService.js`
- `http-generic-api/src/api/effectiveAuthority/effectiveAuthorityController.js`
- `http-generic-api/src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js`
- `http-generic-api/test-authority-scope-foundation.mjs`
- `http-generic-api/test-effective-authority-cross-tenant-matrix.mjs`
- `http-generic-api/test-effective-authority-scope.mjs`
- `http-generic-api/test-ueacp-activation-scope-regression.mjs`
- `http-generic-api/test-activation-effective-authority-envelope.mjs`

Result: the checklist gate **Cross-tenant negative tests pass** is supported and marked complete.

### Secret and sensitive-data handling

- Effective Authority manifests and drift evidence are checked by `assertNoSecretEvidence` before persistence or projection.
- Separated credential evidence keys such as `credential_ref`, `credential-ref`, and `credentialRef` are rejected.
- Evidence writes use parameterized SQL; principal identifiers are not interpolated into SQL text.
- Decision evidence is canonicalized, size-bounded, hashed with SHA-256, and read back in the same cycle.
- Activation and reconciliation outputs explicitly preserve `provider_calls=false`, `credential_payload_reads=false`, `external_writes=false`, and `secrets_included=false`.
- Activation surface manifests exclude principal IDs and raw evidence JSON bodies from projected output.

Evidence surfaces:

- `http-generic-api/src/domain/effectiveAuthority/effectiveAuthority.js`
- `http-generic-api/src/infrastructure/effectiveAuthority/effectiveAuthorityEvidenceRepository.js`
- `http-generic-api/test-effective-authority-evidence-repository.mjs`
- `http-generic-api/test-effective-authority-domain.mjs`
- `http-generic-api/activation-surfaces/effective_authority_shadow_decisions.json`
- `http-generic-api/activation-surfaces/authority_projection_drift_events.json`

Result: the checklist gate **Secret-like schema rejection is tested** is supported and marked complete.

### Shadow-only enforcement boundary

- All implemented manifests, Activation projections, reconciliation results, and ledger rows preserve `authority_granted=false` and `enforcement_mode=shadow_only`.
- `legacy_runtime_authoritative=true` and `execution_authority_changed=false` are explicit in Activation and reconciliation output.
- Connector projection exposes readiness candidates but does not activate an executor.
- Shared PEP enforcement is not implemented by this slice; therefore no write or provider cutover is possible from UEACP state.

Evidence surfaces:

- `http-generic-api/src/domain/effectiveAuthority/effectiveAuthority.js`
- `http-generic-api/src/application/effectiveAuthority/activationEffectiveAuthorityProjectionService.js`
- `http-generic-api/src/application/effectiveAuthority/effectiveAuthorityReconciler.js`
- `http-generic-api/openapi.yaml`
- `http-generic-api/test-activation-effective-authority-openapi.mjs`

### Scheduler and failure behavior

- Reconciliation scheduling is disabled unless `UEACP_RECONCILIATION_ENABLED` is explicitly enabled.
- The interval is bounded from 300 to 86400 seconds.
- Reconciliation defaults to preview; persistence requires a separate flag and enabled evidence mode.
- Overlapping ticks are prevented.
- Scheduler errors degrade to bounded error codes and no-secret structured logs.
- The default server startup creates no reconciliation timer while the feature flag is disabled.

Evidence surfaces:

- `http-generic-api/src/application/effectiveAuthority/effectiveAuthorityReconciliationScheduler.js`
- `http-generic-api/effectiveAuthorityReconciliationRuntime.js`
- `http-generic-api/test-effective-authority-reconciliation-scheduler.mjs`
- `http-generic-api/test-effective-authority-reconciliation-startup.mjs`
- `docs/ueacp-shadow-reconciliation.md`

### Database and migration safety

- Both migrations are additive and contract-tested.
- The capability migration is idempotent and does not modify connector rows.
- The ledger migration creates new tables and includes constraints forcing no authority grant, provider call, credential read, external write, or secret inclusion.
- No destructive `DROP`, `TRUNCATE`, `DELETE`, or `ALTER TABLE` operation is present in the reviewed migrations.
- Neither migration has been executed; live schema constraints and query plans have not been verified.

Evidence surfaces:

- `http-generic-api/migrations/20260721_ueacp_connector_inventory_read.sql`
- `http-generic-api/migrations/20260721_ueacp_shadow_decision_ledger.sql`
- `http-generic-api/test-ueacp-migration-contract.mjs`
- `http-generic-api/test-ueacp-shadow-decision-ledger-migration.mjs`

## Findings

### No critical or high-severity defect found in the implemented shadow slice

The reviewed implementation does not expose an execution-authority grant, provider mutation path, credential payload read, or external write through UEACP. This finding applies only to the current shadow-only implementation and does not certify future PEP or write enforcement.

### Open security gates

1. **Security-owner threat-model approval** — the threat model exists, but approval by the designated security owner is not recorded.
2. **Break-glass governance** — separate approval, expiry, operation binding, and audit evidence remain outside this implemented slice.
3. **Ledger retention and access policy** — retention duration, access roles, deletion policy, and audit review ownership are not approved.
4. **Policy publication and rollback** — governed publication, revision rollback, and invalidation evidence remain incomplete.
5. **Live migration and query-plan verification** — migrations are not applied, so indexes, constraints, schema readback, and representative `EXPLAIN` evidence remain open.
6. **Shared PEP shadow certification** — dispatch-time parity and mutable-authority revalidation are not certified; enforcement cutover remains prohibited.
7. **Live capability parity** — `connector.inventory.read` is not registered in the live registry, so compile and projection previews return zero manifests and cannot establish alignment.

## Merge-readiness conclusion

Security review status remains `in_progress`. The implemented shadow-only slice may continue through code review, but the PR is not security-approved for merge or release while the security-owner review, break-glass governance, ledger retention/access approval, policy publication/rollback, migration readback, live parity, and PEP certification gates remain open.

## Safety readback

- Production runtime changed: `false`
- Migration executed: `false`
- Scheduler enabled: `false`
- Evidence persistence enabled: `false`
- Provider call made: `false`
- Credential payload read: `false`
- External write made: `false`
- Enforcement cutover authorized: `false`
- Legacy removal authorized: `false`
- Secrets included: `false`
