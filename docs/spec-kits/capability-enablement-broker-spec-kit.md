# Capability Enablement Broker Spec Kit

Status: proposed
Owner surface: Growth Intelligence Platform governance
Change type: specification only
Runtime mutation: none
Secrets included: false

## Executive Summary

The Capability Enablement Broker is a governance-first orchestration layer that converts a request to enable or run a capability into a deterministic decision and, when policy allows, into the minimum safe enablement actions required before dispatch.

It composes existing platform authorities instead of bypassing them:

- tenant effective capability resolution
- dynamic capability dry-run
- credential effective planning
- resource authority binding
- capability envelope creation and approval
- dispatch certification
- scenario evidence and readback
- execution enablement gates

The broker answers one question:

> For this actor, tenant, workspace, resource, capability, operation intent, and risk class, what is the next allowed mode and what evidence is required?

The broker must never return secrets, bypass runtime guards, or grant apply authority automatically.

## Non-Goals

The broker is not a free-form dispatcher, a runtime guard replacement, a certification shortcut, a credential sharing mechanism, or an apply/publish/spend/deploy bypass.

The first implementation must be orchestration only. Provider writes stay under existing family-specific adapters and guards.

## Existing Foundations

| Surface | Broker Role |
| --- | --- |
| `tenantEffectiveCapabilityResolver.js` | Determines tenant capability, grants, bindings, resource authority, endpoint alias, and certification gaps. |
| `scripts/capability-resolution-dry-run.mjs` | Produces no-execution resolution envelopes with selected source tier, gates, and blocking gaps. |
| `scripts/capability-resolution-envelope-create.mjs` | Persists immutable no-secret capability envelopes with SHA-256 hash and TTL. |
| `scripts/capability-resolution-envelope-approve.mjs` | Creates approval evidence and flips ready envelopes to ready_for_dispatch. |
| `capabilityResolutionEnvelopeGuard.js` | Enforces envelope validity before state-changing execution. |
| `runtimeDispatchCertificationIssuer.js` | Issues bounded dispatch certifications and rejects `apply_allowed=true`. |
| `credentialRoutes.js` | Provides credential effective plan and tenant credential promotion surfaces. |
| `routes/systemLayerRoutes.js` | Provides descriptor-driven tool registration and readiness patterns. |

## Governance Model

The broker separates five concepts:

| Dimension | Question | Source |
| --- | --- | --- |
| Permission | Is the actor allowed to ask? | membership, grants, role policy |
| Authorization | Is this exact resource authorized? | resource authority bindings, workspace grants |
| Credential | Is a credential pointer available and valid? | user app connections, credential bindings |
| Certification | Has the runtime path passed bounded evidence? | runtime dispatch certification registry |
| Execution | Is the operation allowed now? | envelope guard, preflight ledgers, execution enablement |

The broker prepares authority. Execution adapters remain authoritative for provider calls.

## Canonical Decisions

- enabled
- ready_for_preview
- ready_for_dispatch
- needs_approval
- needs_resource_binding
- needs_credential
- needs_credential_promotion
- needs_certification
- needs_preflight
- needs_execution_enablement
- blocked_missing_membership
- blocked_out_of_scope
- blocked_policy_denied
- blocked_secret_boundary
- blocked_apply_not_supported
- blocked_provider_adapter_missing
- degraded_contract

Every decision includes `reason_codes`, `next_actions`, and `secrets_included=false`.

## Tool Contract

Tool key:

```text
capability_enablement_resolve
```

Input:

```json
{
  "type": "object",
  "required": ["capability_key", "operation_intent"],
  "properties": {
    "capability_key": { "type": "string", "minLength": 1, "maxLength": 191 },
    "operation_intent": { "type": "string", "enum": ["read", "preview", "write", "dispatch", "apply", "publish", "deploy", "spend"] },
    "requested_mode": { "type": "string", "enum": ["diagnose", "auto", "create_envelope", "certify_if_possible", "continue"], "default": "auto" },
    "tenant_id": { "type": "string", "maxLength": 64, "description": "Admin-only override." },
    "workspace_id": { "type": "string", "maxLength": 64 },
    "workspace_key": { "type": "string", "maxLength": 191 },
    "user_id": { "type": "string", "maxLength": 64, "description": "Admin-only override." },
    "brand_key": { "type": "string", "maxLength": 128 },
    "business_activity_type": { "type": "string", "maxLength": 191 },
    "app_key": { "type": "string", "maxLength": 128 },
    "resource_ref": { "type": "object", "additionalProperties": true },
    "resource_uri": { "type": "string", "maxLength": 512 },
    "runtime_surface": { "type": "string", "maxLength": 191 },
    "idempotency_key": { "type": "string", "maxLength": 191 },
    "typed_confirmation": { "type": "string", "maxLength": 256 },
    "evidence_ref": { "type": "string", "maxLength": 1000 }
  },
  "additionalProperties": false
}
```

Output:

```json
{
  "ok": true,
  "decision": "needs_certification",
  "request_id": "ceb_...",
  "actor": {
    "caller_type": "admin",
    "role_key": "platform_admin",
    "tenant_id": "...",
    "user_id": "..."
  },
  "capability": {
    "capability_key": "repo_patch_apply",
    "app_key": "github",
    "risk_class": "high",
    "operation_intent": "write"
  },
  "checks": {
    "membership": "passed",
    "resource_authority": "passed",
    "credential": "not_required_or_platform_managed",
    "envelope": "ready_requires_approval",
    "certification": "missing",
    "readback_contract": "present"
  },
  "auto_actions_taken": ["envelope_created"],
  "next_actions": [
    { "action": "approve_envelope", "required_role": "platform_admin", "reason_code": "approval_required" }
  ],
  "envelope_id": "...",
  "approval_hold_id": null,
  "certification_key": null,
  "secrets_included": false
}
```

## Proposed Tables

### `role_capability_auto_policy`

Registry-driven role authorization for broker auto-actions.

Fields:

- `policy_id`
- `role_key`
- `capability_family`
- `capability_key`
- `operation_intent`
- `max_risk_class`
- `can_create_envelope`
- `can_auto_approve_envelope`
- `can_create_resource_binding`
- `can_promote_tenant_credential_binding`
- `can_issue_dispatch_certification`
- `can_issue_apply_authority`
- `requires_typed_confirmation`
- `requires_human_approval`
- `status`
- timestamps

Initial posture:

| Role | Read | Preview | Dispatch | Apply |
| --- | --- | --- | --- | --- |
| platform_admin | auto | auto | approval or policy | never auto |
| tenant_owner | own tenant | own tenant | low or medium only | never auto |
| tenant_operator | granted only | granted only | approval required | blocked |
| freelancer | assigned workspace only | assigned workspace only | approval required | blocked |
| client_reviewer | review only | review only | blocked | blocked |

### `capability_scenario_recipes`

Maps capability families to bounded evidence strategies.

Initial recipes:

| Scenario | Family | Strategy |
| --- | --- | --- |
| `wordpress_draft_smoke` | wordpress_publish | Create draft, read status draft, verify title marker. |
| `github_advisory_comment_readback` | github_repo_mutation | Comment on approved plan, read marker hash. |
| `github_repo_patch_documentation_branch` | github_repo_mutation | Non-protected docs branch, expected base SHA, branch head readback. |
| `cloudflare_txt_record_smoke` | cloudflare_dns | Create temporary TXT, read it back, delete, verify absence. |
| `local_connector_health_readback` | local_connector_config | Registry status, tunnel health, connector health. |
| `google_ads_budget_preflight_only` | ads_budget | Budget preflight ledger only, no provider spend mutation. |
| `hostinger_dev_restart_readback` | remote_ssh_runtime | Dev target only, restart, health/readback, no production default. |

### `capability_enablement_requests`

Immutable request ledger fields:

- `request_id`
- `tenant_id`
- `workspace_id`
- `user_id`
- `actor_role`
- `capability_key`
- `operation_intent`
- `requested_mode`
- `resource_uri`
- `decision`
- `risk_class`
- `envelope_id`
- `approval_hold_id`
- `certification_key`
- `evidence_ref`
- `secrets_included`
- timestamps

### `capability_enablement_steps`

Step-level audit fields:

- `step_id`
- `request_id`
- `step_key`
- `tool_key`
- `status`
- `decision`
- `evidence_ref`
- `error_code`
- `step_json`
- `secrets_included`
- `created_at`

## Broker Algorithm

```text
1. Normalize request and principal.
2. Resolve tenant, workspace, brand, resource, and actor role.
3. Run tenant effective capability preview.
4. Run credential effective plan if capability requires credentials.
5. Run dynamic capability dry-run.
6. Resolve role_capability_auto_policy.
7. Classify missing gates.
8. If resource binding is missing and policy allows, create scoped binding.
9. If credential binding is missing and policy allows, create promotion request or promote pointer.
10. If envelope is required and policy allows, create envelope.
11. If envelope approval is required and policy allows, approve envelope.
12. If certification is missing, locate scenario recipe.
13. If recipe evidence is available and policy allows, issue dispatch-only certification.
14. Return final decision and next actions.
```

The broker writes request and step rows before and after each state-changing internal action.

## Auto-Action Rules

The broker may create an envelope when:

- membership is valid
- resource scope resolves
- no secrets are present
- capability exists
- role policy allows envelope creation
- requested operation is not apply

The broker may approve an envelope when:

- decision is `ready_requires_approval`
- `blocking_gap_count=0`
- `dispatch_allowed=true`
- role policy allows auto approval
- risk class is within role max risk
- typed confirmation rules are satisfied

The broker may issue dispatch certification when:

- role policy allows dispatch certification
- scenario recipe is active
- same-cycle bounded evidence exists
- readback contract is verified
- tool or action key exists
- `dispatch_allowed=true`
- `apply_allowed=false`

The broker must never auto-issue apply authority.

## Runtime Enforcement

Execution adapters keep this order:

```text
validate input
validate protected target rules
resolveCapabilityExecutionEnvelope
resolve credential server-side
execute family-specific provider call
readback
mark envelope referenced
write audit evidence
return no-secret result
```

## Error Model

Errors use structured envelopes:

```json
{
  "ok": false,
  "error": {
    "code": "RESOURCE_AUTHORITY_MISSING",
    "message": "The requested resource is not authorized for this actor and operation.",
    "details": {
      "resource_type": "github_repo",
      "resource_uri": "github://owner/repo",
      "operation_intent": "write"
    },
    "requestId": "req_..."
  },
  "secrets_included": false
}
```

Stable reason codes:

- MEMBERSHIP_REQUIRED
- WORKSPACE_CONTEXT_MISSING
- CAPABILITY_NOT_REGISTERED
- CAPABILITY_NOT_GRANTED
- CONNECTION_MISSING
- CONNECTION_NOT_VALIDATED
- CREDENTIAL_BINDING_MISSING
- RESOURCE_AUTHORITY_MISSING
- ENVELOPE_REQUIRED
- ENVELOPE_APPROVAL_REQUIRED
- DISPATCH_CERTIFICATION_MISSING
- READBACK_CONTRACT_MISSING
- EXECUTION_ENABLEMENT_DISABLED
- APPLY_AUTHORITY_NOT_AUTO_GRANTABLE
- SECRET_BOUNDARY_FAILED
- POLICY_DENIED

## Security Requirements

- Never return tokens, API keys, passwords, private keys, OAuth tokens, service account JSON, or decrypted credential material.
- Tenant principals cannot override tenant_id or user_id.
- Admin override must be audited.
- Resource authority is object-level and operation-specific.
- Mutations require no-secret evidence and same-cycle readback.
- Apply, spend, publish, deploy, DNS mutation, repository mutation, and destructive operations require typed approval.
- Platform-managed fallback requires quota disclosure and audit logging.
- Provider errors are translated into no-secret structured envelopes.

## OpenAPI and Tool Catalog Requirements

Every broker endpoint or tool must include:

- operation summary
- operationId
- tags
- strict input schema
- success response
- error response
- security requirements
- examples
- idempotency notes
- status code mapping

Recommended tool keys:

- `capability_enablement_resolve`
- `capability_enablement_continue`
- `capability_enablement_request_get`
- `capability_enablement_readiness_smoke`
- `capability_enablement_policy_preview`

## File Placement

Recommended first implementation files:

```text
http-generic-api/capabilityEnablementBroker.js
http-generic-api/capabilityEnablementPolicies.js
http-generic-api/capabilityEnablementRecipes.js
http-generic-api/test-capability-enablement-broker.mjs
http-generic-api/migrations/YYYYMMDD_capability_enablement_broker.sql
docs/spec-kits/capability-enablement-broker-spec-kit.md
```

## Descriptor Wiring

Add a descriptor source:

```js
export const CAPABILITY_ENABLEMENT_SYSTEM_TOOLS = Object.freeze([
  {
    name: "capability_enablement_resolve",
    displayName: "Resolve Capability Enablement",
    description: "Resolve and optionally prepare governed capability enablement for the current actor, resource, operation, and risk. No provider execution. No secrets.",
    tags: ["capability", "enablement", "governance", "no_secrets", "readback"]
  },
  {
    name: "capability_enablement_readiness_smoke",
    displayName: "Capability Enablement Readiness Smoke",
    description: "Read-only smoke for policy tables, descriptor wiring, envelope helper imports, and no-secret contracts."
  }
]);
```

Register through the system layer descriptor registry rather than ad hoc routing.

## MVP Scope

### MVP 1: Diagnose and Plan

- resolve actor and scope
- run tenant effective capability preview
- run dry-run
- run credential effective plan if needed
- classify gaps
- write request ledger
- return decision and next actions
- no auto mutation

### MVP 2: Envelope Orchestration

- create envelope when policy allows
- approve envelope when policy allows
- write step ledger
- no provider execution

### MVP 3: Credential Promotion Orchestration

- identify valid credential candidate
- create tenant credential promotion request
- promote only for admin or tenant owner policy
- never copy or return secrets

### MVP 4: Scenario Certification

- resolve recipe
- require evidence_ref and readback
- issue dispatch-only certification
- never grant apply authority

### MVP 5: Tenant Self-Service

- expose tenant-safe projection
- allow tenant owner approval, binding request, or credential setup request
- no admin override exposure

## Test Plan

Unit tests:

- admin read request returns enabled when all gates pass
- tenant owner preview returns ready_for_preview for own workspace
- tenant operator dispatch returns needs_approval
- missing membership returns blocked_missing_membership
- missing credential returns needs_credential
- missing resource authority returns needs_resource_binding
- certification missing returns needs_certification
- apply request returns blocked_apply_not_supported unless explicit apply policy exists
- secret-like fields are redacted

Integration tests:

- descriptor tool appears in admin system catalog
- readiness smoke passes with all tables present
- envelope create and approve sequence writes request and step ledgers
- runtime guard rejects expired envelope
- tenant principal cannot override tenant_id
- certification issuer rejects apply_allowed=true

Regression tests:

- blocked envelope is never approved
- envelope with blocking gaps is never auto-approved
- missing readback recipe prevents certification
- stale evidence_ref prevents certification
- high-risk tenant operator dispatch requires approval

## Rollout Plan

1. Land this spec only.
2. Add additive migration tables.
3. Add read-only readiness smoke.
4. Add diagnose-only broker tool.
5. Add envelope creation behind admin-only flag.
6. Add tenant owner preview path.
7. Add recipe-backed certification for one low-risk family.
8. Expand families only after scenario evidence and readback.

Feature flags:

- `CAPABILITY_ENABLEMENT_BROKER_ENABLED`
- `CAPABILITY_ENABLEMENT_AUTO_ENVELOPE_ENABLED`
- `CAPABILITY_ENABLEMENT_AUTO_APPROVAL_ENABLED`
- `CAPABILITY_ENABLEMENT_AUTO_CERTIFICATION_ENABLED`
- `CAPABILITY_ENABLEMENT_TENANT_SELF_SERVICE_ENABLED`

Initial defaults:

- broker enabled: false
- diagnose-only: true in staging
- auto envelope: false
- auto approval: false
- auto certification: false
- tenant self service: false

## Observability

Metrics:

- `enablement_requests_total`
- `enablement_decisions_total`
- `enablement_auto_actions_total`
- `enablement_blocking_gaps_total`
- `enablement_secret_boundary_failures_total`
- `enablement_certifications_issued_total`
- `enablement_approval_required_total`

Audit evidence:

- request ledger row
- step ledger rows
- envelope ID and hash
- approval hold ID
- certification key
- readback evidence reference

## PR Acceptance Criteria

A PR implementing this spec is review-ready only when:

- contracts are documented
- migrations are additive and reversible where practical
- tests cover role, scope, missing gate, approval, and secret boundary cases
- runtime guards remain authoritative
- tenant override rules are enforced
- all responses include `secrets_included=false`
- OpenAPI or tool schema is updated
- no provider write occurs in diagnose mode
- no apply authority is auto-granted

## Recommended First Implementation PR

The first code PR after this spec should implement only:

- additive tables
- broker module with diagnose-only mode
- readiness smoke
- descriptor registration
- unit tests for decision classification

It must not:

- execute provider calls
- issue certifications
- promote credentials
- auto-approve envelopes
- expose tenant mutation paths

This keeps the first implementation reviewable while establishing the dynamic governance foundation.
