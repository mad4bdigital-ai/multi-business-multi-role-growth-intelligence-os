# Capability Enablement Broker Runtime Support

## Purpose

The Capability Enablement Broker is the long-term governance entry point for role-aware capability enablement. It composes existing platform primitives into one decision surface before any runtime moves toward approval, credential readiness, certification, or execution.

The broker remains conservative: it classifies readiness, records no-secret internal evidence when explicitly requested, returns guided next-action proposals, and exposes tenant-safe projections. It does not execute providers, promote credentials, approve envelopes, issue certifications, grant apply authority, or perform external writes.

## Runtime surfaces

The broker is exposed through the system-layer descriptor source `capability_enablement_broker_v1`.

Descriptor tools:

- `capability_enablement_resolve`
- `capability_enablement_proposal_preview`
- `capability_enablement_decision_report`
- `capability_enablement_tenant_projection`
- `capability_enablement_readiness_smoke`

The source is validated by `system_layer_descriptor_callability_audit` and release readiness. A healthy release-readiness run must show the descriptor source present, five descriptor tools, zero missing handlers, and readiness classification `capability_enablement_broker_ready`.

## Contract

The broker must preserve these guarantees:

- no provider calls
- no credential payload reads
- no envelope creation from inside the broker except proposal metadata that points to the existing envelope tools
- no envelope auto-approval
- no credential promotion
- no dispatch certification issuance
- no apply authority grant
- no external writes
- no secrets in output
- no tenant/user override for tenant principals

Internal SQL persistence is explicit only. `capability_enablement_resolve` records a request/step ledger only when `record_decision=true`; otherwise it remains read-only/diagnostic. Ledger writes are internal, no-secret, bounded, and never authorization state changes.

The broker may call existing no-secret internal resolvers:

- `tenantEffectiveCapabilityPreview`
- `runCapabilityResolutionDryRun`

Both calls are used only to classify readiness and produce next-action guidance.

For Admin-only virtual tools that are intentionally not provider endpoint semantic capabilities, the broker may also use a guarded virtual-admin bridge. This bridge is allowed only when the semantic resolver returns `CAPABILITY_NOT_REGISTERED` or `CAPABILITY_BINDING_MISSING`, the caller is an Admin principal, and an active `platform_tool_dispatch_bindings` row exists with `scope_class='admin'` and `surface_class` in `virtual_admin_tool` or `db_admin_tool`. The bridge is diagnostic metadata only: it does not execute the tool, call a provider, read credentials, create approvals, issue certifications, grant apply authority, or return secrets.

## Decision model

The broker may return these decision families:

- `ready_for_dispatch`
- `ready_for_preview`
- `needs_approval`
- `needs_resource_binding`
- `needs_credential`
- `needs_certification`
- `needs_execution_enablement`
- `needs_preflight`
- `blocked_missing_membership`
- `blocked_out_of_scope`
- `blocked_policy_denied`
- `blocked_apply_not_supported`
- `blocked_secret_boundary`
- `degraded_contract`

`blocked_apply_not_supported` is intentional. Apply/publish/deploy/spend/destructive intents must remain behind explicit policy, authority, typed approval, runtime certification, and readback. The broker must not silently auto-grant those flows.

## Implemented support phases

### Phase 1: Diagnose-only MVP

Status: implemented.

Scope:

- descriptor source
- resolver tool
- readiness smoke
- focused tests
- release-readiness callability evidence

### Phase 2: Request and step ledger

Status: implemented as additive schema plus explicit runtime persistence.

Tables and views:

- `capability_enablement_requests`
- `capability_enablement_steps`
- `v_capability_enablement_decision_rollup`

These surfaces record decision metadata, reason codes, selected next actions, resolver hashes, projections, and no-secret readback evidence. They must not store credential payloads, raw secrets, unbounded prompts, or external-provider responses.

### Phase 3: Guided orchestration proposals

Status: implemented as proposal-only output.

The broker can propose bounded next-step plans:

- resource authority binding plan
- credential effective plan
- envelope request/approval plan
- dispatch certification proposal
- execution enablement proposal
- existing runtime guard handoff plan

Plans are reviewable metadata only. They are not executable dispatches and do not replace existing governed tools.

### Phase 4: Explicit handoff execution

Status: intentionally not auto-executing.

The broker can return handoff proposals, but actual execution remains delegated to existing mutation tools and must still pass:

- capability envelope approval
- typed confirmation
- exact resource scope
- expected SHA/checksum/context binding
- same-cycle readback
- idempotency/reservation checks
- audit logging

## Tenant-safe projection

`capability_enablement_tenant_projection` gives tenants a bounded no-secret view of their recent broker decisions:

- capability
- operation intent
- decision
- next allowed mode
- reason codes
- created timestamp

It does not expose raw registry rows, credentials, cross-tenant data, or provider responses.

## Admin observability

`capability_enablement_decision_report` provides no-secret aggregate and recent-decision reporting for Admins. It is intended for trend analysis around:

- credential gaps
- resource-authority gaps
- certification gaps
- approval requirements
- ready-for-dispatch rate

## Release readiness requirements

A release that changes broker behavior must include:

- focused tests for classification, secret-boundary blocking, proposal previews, internal persistence, reports, tenant projection, and readiness smoke
- descriptor callability pass
- zero missing handlers
- required ledger tables and rollup view present
- no-secret output evidence
- no provider-call evidence
- no external-mutation evidence
- PR CI gate pass
- release readiness pass after schema apply and deployment

## Production deployment policy

`auth.mad4b.com` follows the Hostinger production policy: normal updates flow through GitHub `main` auto-deploy, not routine SSH deployment.

Post-merge verification should confirm:

1. the merge commit is an ancestor of `main`;
2. the ledger migration has been applied through the governed migration runner;
3. release readiness passes on the current runtime;
4. descriptor callability includes `capability_enablement_broker_v1` with five tools;
5. Hostinger production Git HEAD is verified through the approved auto-deploy readback path.

If SSH probe execution is disabled, classify production-head verification as gated, not as runtime failure. Do not enable SSH or run manual deploys unless Auto Deploy is demonstrably unavailable and a fresh break-glass approval exists.

## OpenAPI and system tool documentation

The broker tools are descriptor-backed system tools. If an OpenAPI schema exposes system tool enumeration, it must include the five broker tools and their no-secret constraints. If the OpenAPI schema exposes only generic `/system/tools` dispatch, do not add fake direct HTTP paths for broker tools.

Any future public or tenant-facing API route must use OpenAPI 3.1, stable operation IDs, explicit schemas, consistent error envelopes, auth/permission documentation, and no-secret examples.

## Security notes

Secret-like input keys must block resolution before resolver or dry-run calls. The block is intentionally broad and includes keys resembling tokens, passwords, private keys, API keys, authorization headers, or client secrets.

Tenant principals must not be allowed to override tenant or user identity. Admin override use must be explicit in output metadata.

## Remaining backlog

- Apply `1035_sprint69_capability_enablement_broker_ledgers.sql` after merge through the governed migration runner.
- Add dashboard visualizations over `v_capability_enablement_decision_rollup` if product UX needs them.
- Add docs-agent/OpenAPI generator alignment if system tool schemas are emitted into OpenAPI.
- Add scenario recipes only after positive smoke certification and policy approval.
- Keep auto-actions disabled until each action class has a separate policy, approval, and readback contract.
