# Semantic Capability and Tenant-Effective Resolution

## Status

Shadow foundation. No provider mutation is enabled by this change. Existing tenant tools and endpoint exports remain authoritative until a separately approved canary or active cutover.

## Problem

The platform currently stores actions, endpoints, connections, grants, tool bindings, exports, and runtime certifications in separate registry surfaces. Each surface may be valid on its own while the complete tenant execution chain is incomplete. This can produce symptoms such as `unknown_tool`, `endpoint_not_found`, ambiguous connection selection, or an active tool whose effective authority is no longer ready.

The underlying failure class is capability availability drift, not a provider-specific WordPress failure.

## Decision

Introduce semantic capabilities as a stable domain contract above provider actions and endpoints.

```text
Tenant principal
  -> canonical workspace
  -> active membership
  -> semantic capability
  -> provider binding
  -> workspace-linked validated connection
  -> action grant
  -> resource authority
  -> canonical endpoint identity
  -> runtime certification
  -> derived tool projection
```

The first shadow binding is:

```text
content.article.create_draft
  -> wordpress_rest
  -> wordpress_api
  -> wordpress_create_post
```

The binding is explicitly `shadow`. It does not create an active tenant export and cannot call WordPress.

## Registry surfaces

### `platform_semantic_capabilities`

Provider-independent capability definitions. A capability declares the resource, operation, risk class, approval, audit, connection, authority, and readback requirements.

### `platform_capability_provider_bindings`

Maps a semantic capability to one provider implementation. Bindings include priority, adapter and policy keys, deterministic connection-selection policy, and rollout mode.

Supported rollout modes are:

- `shadow`: resolve and compare only; no derived export is activated.
- `canary`: eligible for bounded tenant/workspace allowlists after explicit approval.
- `active`: eligible for normal derived export reconciliation.
- `disabled`: excluded from effective resolution.

### `platform_endpoint_aliases`

Maps imported, historical, or operationId-style endpoint keys to a canonical endpoint key. Aliases preserve backward compatibility while runtime execution resolves one canonical identity.

### `tenant_capability_shadow_decisions`

No-secret decision ledger for old-versus-new resolver comparisons. It stores status, selected non-secret binding metadata, a manifest hash, and comparison classification. It does not store credentials, request bodies, or provider responses.

## Read models

### `v_platform_endpoint_canonical_identity`

Normalizes endpoint identity and exposes a deterministic execution hash based on provider family, method, normalized path/function, and canonical endpoint key.

### `v_platform_capability_export_projection`

Computes desired export state from semantic capability definitions, provider bindings, rollout mode, and endpoint readiness. This is the source for future export reconciliation; the current migration does not mutate `platform_endpoint_tool_exports`.

### `v_platform_capability_export_reconciliation`

Compares the desired projection with existing endpoint exports and classifies missing exports, unsafe exports, shadow-without-export, or aligned legacy exports.

### `v_tenant_effective_capability_candidates`

SQL read model that joins workspace, membership, provider binding, app link, connection, action grant, resource authority, and canonical endpoint readiness. Runtime selection remains in the application resolver so ambiguity and principal context are handled explicitly.

## Runtime resolver

`tenantEffectiveCapabilityResolver.js` provides two direct system-layer descriptor tools:

- `tenant_effective_capability_preview`
- `tenant_capability_shadow_compare`

These tools are descriptor-backed and execute inside the system layer. They do not call `/system/tools/call` or `/gpt/tools/call`, avoiding recursive dispatch.

The resolver:

1. Derives tenant and user identity from the authenticated principal. Admin-only diagnostic overrides are accepted only for admin principals.
2. Resolves a canonical workspace, preferring the legacy-compatible `workspace_id = tenant_id` default where present.
3. Requires active membership.
4. Loads the semantic capability and ordered provider bindings.
5. Selects workspace-linked connections deterministically:
   - explicit linked connection pin: 1000
   - validated primary: 900
   - validated non-primary: 800
   - active primary: 600
   - active non-primary: 500
6. Blocks equal top-score candidates as `ambiguous_connection`.
7. Requires an active action grant for the selected connection and parent action.
8. Requires a resource grant appropriate to read or mutation intent.
9. Resolves endpoint aliases to one canonical endpoint.
10. Blocks multiple active canonical endpoint rows.
11. Reads runtime certification and current export state.
12. Returns a derived tool projection and manifest hash without enabling it.

No credential or encrypted value is selected or returned.

## Error taxonomy

The resolver returns layer-specific statuses rather than a generic tool error:

- `workspace_not_registered`
- `workspace_not_ready`
- `workspace_membership_required`
- `capability_not_registered`
- `capability_binding_missing`
- `connection_not_found`
- `ambiguous_connection`
- `connection_not_validated`
- `capability_not_granted`
- `resource_authority_missing`
- `canonical_endpoint_unavailable`
- `ambiguous_canonical_endpoint`
- `runtime_certification_missing`
- `capability_export_missing`
- `shadow_ready`
- `canary_ready`
- `ready`

## Tool export policy

Tool exports are projections, not independent authority. A future reconciler may apply the projection only when:

- capability and binding are active;
- rollout is `canary` or `active`;
- workspace, membership, resource authority, connection, and action grant are effective;
- canonical endpoint identity is unambiguous and ready;
- runtime dispatch certification is current;
- input/output contracts are valid;
- approval policy is satisfied;
- audit and readback requirements are configured.

A shadow binding must not produce an active export.

## Rollout

### Phase 0 — foundation

Create additive tables, views, resolver, direct descriptors, docs, and contract tests. No provider call. No tenant export mutation.

### Phase 1 — shadow comparison

Run `tenant_capability_shadow_compare` for selected historical and live requests. Measure:

- legacy-ready/new-blocked;
- legacy-blocked/new-ready;
- connection ambiguity;
- missing workspace links;
- missing action/resource grants;
- canonical endpoint duplication;
- export drift.

### Phase 2 — read-only canary

Promote selected low-risk read capabilities to `canary` for an explicit tenant/workspace allowlist. Require same-cycle readiness and audit evidence.

### Phase 3 — preview mutations

Enable preview-only content, hosting, email, workflow, and repository mutation capabilities. No provider apply.

### Phase 4 — bounded apply

Enable one capability at a time with capability envelope, idempotency, approval where required, audit, and same-cycle readback.

### Phase 5 — legacy retirement

Convert legacy provider-specific tool names to compatibility aliases, monitor usage, deprecate, and remove only after the migration window.

## Rollback

Rollback is non-destructive:

1. Set provider bindings to `rollout_mode = 'disabled'`.
2. Stop invoking shadow comparison descriptors.
3. Keep existing tenant tools and exports unchanged.
4. Retain shadow evidence for audit.
5. Drop new views/tables only in a separately reviewed cleanup migration after confirming no consumers.

## Security boundaries

- Tenant principals cannot override tenant or user identity.
- The resolver never reads encrypted credentials.
- Provider URLs, authorization headers, tokens, and secrets are not accepted as tool input.
- Connection IDs must already be linked to the workspace.
- A generic runtime endpoint dispatcher is not exposed through these descriptors.
- Shadow comparison writes only a bounded no-secret decision record.

## Readiness smoke

The system-layer descriptor source exposes `tenant_effective_capability_readiness_smoke` as an admin-only, read-only diagnostic. It checks the four migration-owned tables, four migration-owned views, initial capability and alias seeds, descriptor wiring, and explicit no-provider/no-mutation/no-secret guarantees.

If Migration `311_sprint69_semantic_capability_effective_resolution.sql` is not authorized and applied, the smoke returns `semantic_capability_schema_not_applied`. It does not create schema objects, write shadow decisions, call providers, or bypass the governed migration authorization registry.
## Governed migration authorization boundary

`311_sprint69_semantic_capability_effective_resolution.sql` intentionally does not authorize itself and must not be added to the legacy bootstrap allowlist. The governed migration runner checks `governed_migration_authorization_registry` before reading or applying the file.

After merge, a separately approved operational change must create the authorization row before staging or production execution. That authorization is not part of this PR and must record risk tier, preflight requirement, confirmation requirement, and whether apply or record-only modes are allowed.

Once the merged migration file is present in the deployed checkout, the required sequence is:

1. Create and read back the separately approved authorization row.
2. Run `migration_apply_guarded_dry_run --migration 311_sprint69_semantic_capability_effective_resolution.sql`.
3. Require `status=pass`, `risk_count=0`, and an 11-statement count match.
4. Apply only through the governed runner with typed confirmation `APPLY_311_SPRINT69_SEMANTIC_CAPABILITY_EFFECTIVE_RESOLUTION` and a separate explicit deployment approval.
5. Read back the eight expected schema objects and confirm the WordPress binding remains `shadow` with no active derived export.

Automated migration reconciliation additionally requires an explicit active policy rule for this exact filename. Absence of that rule must remain `diagnose_only`, never implicit auto-apply.

## Definition of done for canary promotion

- Migration applies cleanly in staging.
- Descriptor readiness reports both handlers present.
- Contract tests and integration tests pass.
- Shadow mismatch report is reviewed.
- No active export exists for shadow bindings.
- Connection ambiguity is zero for the canary scope.
- Endpoint canonical identity is unique.
- Release readiness and security review pass.
- Promotion is explicitly approved.
