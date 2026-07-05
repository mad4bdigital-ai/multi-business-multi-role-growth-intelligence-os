# Capability Enablement Broker Runtime Support

## Purpose

The Capability Enablement Broker is the long-term governance entry point for role-aware capability enablement. It composes existing platform primitives into one diagnose-only decision surface before any runtime moves toward approval, credential readiness, certification, or execution.

The current runtime MVP is intentionally conservative. It classifies readiness and returns next actions, but it does not mutate authorization state or call external providers.

## Runtime surfaces

The broker is exposed through the system-layer descriptor source `capability_enablement_broker_v1`.

Descriptor tools:

- `capability_enablement_resolve`
- `capability_enablement_readiness_smoke`

The source is validated by `system_layer_descriptor_callability_audit` and release readiness. A healthy release-readiness run must show the descriptor source present, two descriptor tools, zero missing handlers, and readiness classification `capability_enablement_broker_ready`.

## Diagnose-only contract

The MVP must preserve these guarantees:

- no provider calls
- no credential payload reads
- no envelope creation from inside the broker
- no envelope auto-approval
- no credential promotion
- no dispatch certification issuance
- no apply authority grant
- no external writes
- no secrets in output

The broker may call existing no-secret internal resolvers:

- `tenantEffectiveCapabilityPreview`
- `runCapabilityResolutionDryRun`

Both calls are used only to classify readiness and produce next-action guidance.

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

## Long-term support phases

### Phase 1: Diagnose-only MVP

Status: implemented.

Scope:

- descriptor source
- resolver tool
- readiness smoke
- focused tests
- release-readiness callability evidence

No database migrations or provider executions are introduced by the MVP.

### Phase 2: Request and step ledger

Add internal SQL ledgers for durable observability:

- `capability_enablement_requests`
- `capability_enablement_steps`

These tables should record decision metadata, reason codes, selected next actions, resolver hashes, and readback evidence. They must not store credential payloads, raw secrets, or unbounded prompts.

Phase 2 remains diagnose-only unless a separate policy explicitly permits a specific orchestration step.

### Phase 3: Guided orchestration proposals

Allow the broker to propose, but not execute, bounded next-step plans:

- resource authority binding plan
- credential effective plan
- envelope request plan
- dispatch certification proposal
- execution enablement proposal

Plans must be typed, scoped, expiring, no-secret, and reviewable. Any state-changing apply remains delegated to existing governed tools.

### Phase 4: Explicit handoff execution

Only after separate approval and certification may the broker hand off to existing mutation tools. The broker still must not bypass:

- capability envelope approval
- typed confirmation
- exact resource scope
- expected SHA/checksum/context binding
- same-cycle readback
- idempotency/reservation checks
- audit logging

## Release readiness requirements

A release that changes broker behavior must include:

- focused tests for classification, secret-boundary blocking, and readiness smoke
- descriptor callability pass
- zero missing handlers
- no-secret output evidence
- no provider-call evidence
- no mutation evidence
- PR CI gate pass
- release readiness pass

## Production deployment policy

`auth.mad4b.com` follows the Hostinger production policy: normal updates flow through GitHub `main` auto-deploy, not routine SSH deployment.

Post-merge verification should confirm:

1. the merge commit is an ancestor of `main`;
2. release readiness passes on the current runtime;
3. descriptor callability includes `capability_enablement_broker_v1`;
4. Hostinger production Git HEAD is verified through the approved auto-deploy readback path.

If SSH probe execution is disabled, classify production-head verification as gated, not as runtime failure. Do not enable SSH or run manual deploys unless Auto Deploy is demonstrably unavailable and a fresh break-glass approval exists.

## OpenAPI and system tool documentation

The broker tools are descriptor-backed system tools. If an OpenAPI schema exposes system tool enumeration, it must include the two broker tools and their no-secret diagnose-only constraints. If the OpenAPI schema exposes only generic `/system/tools` dispatch, do not add fake direct HTTP paths for broker tools.

Any future public or tenant-facing API route must use OpenAPI 3.1, stable operation IDs, explicit schemas, consistent error envelopes, auth/permission documentation, and no-secret examples.

## Security notes

Secret-like input keys must block resolution before resolver or dry-run calls. The block is intentionally broad and includes keys resembling tokens, passwords, private keys, API keys, authorization headers, or client secrets.

Tenant principals must not be allowed to override tenant or user identity. Admin override use must be explicit in output metadata.

## Follow-up backlog

- Add SQL request/step ledgers.
- Add bounded readback report for recent broker decisions.
- Add docs-agent/OpenAPI generator alignment if system tool schemas are emitted into OpenAPI.
- Add tenant-safe projection after request/step ledgers are available.
- Add scenario recipes only after positive smoke certification and policy approval.
- Keep auto-actions disabled until each action class has a separate policy, approval, and readback contract.
