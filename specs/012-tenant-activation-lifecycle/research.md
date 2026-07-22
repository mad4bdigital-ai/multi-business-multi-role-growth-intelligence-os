# Research: Tenant GPT Activation Lifecycle

## Research objective

Establish the verified brownfield baseline, relevant standards, existing repository authorities, architectural decisions, alternatives, and open questions needed to plan a complete Tenant GPT Activation lifecycle.

## Verified repository baseline

### Existing public and runtime surfaces

- `activation.mad4b.com` is the Tenant Activation protected-resource host.
- OAuth authorization and token exchange are implemented under `/auth/oauth/authorize`, `/auth/oauth/code`, and `/auth/oauth/token`.
- Authorization-code records are persisted and consumed through the Tenant GPT OAuth code store.
- Resource profiles and access-token verification are centralized in Tenant GPT OAuth/resource modules.
- Activation host gateway policy controls allowed host/path/method combinations.
- Tenant session context resolves membership, workspace, roles/scopes, connected systems, tools, and prior sessions.
- Provider bootstrap validation exists as a governed system tool.
- Runtime provider calls resolve from SQL/registry authority through governed dispatch.
- GitHub `main` is the production source and Hostinger auto-deploy is the normal deployment path.

### Existing governance

- SQL is primary runtime authority.
- Repository mutations require capability envelopes, approval, resource authority, readback, and audit.
- Generated canonical files must be rebuilt from `canonicals/` sources.
- Public API contracts default to OpenAPI 3.1 and structured errors.
- Activation completion requires evidence, not narrative.

### Observed operational lesson

A user may complete OAuth and still receive a generic connection failure when:

1. the first protected Action request never reaches the application;
2. gateway verification rejects it before route-level logging;
3. the runtime is older than the merged repair;
4. session-context or bootstrap dependency evidence is missing;
5. the assistant maps any activation failure to reconnect guidance.

Therefore the lifecycle must correlate stages and forbid reconnect guidance unless authorization failure is verified.

## External standards and concepts

### OAuth 2.0 Authorization Code

Authorization codes are short-lived, one-time credentials bound to client and redirect URI. The implementation must also bind the protected resource and tenant/user subject derived from verified identity.

### OAuth 2.0 Resource Indicators — RFC 8707

The `resource` parameter identifies the intended protected resource. The platform must not depend solely on an optional client-supplied parameter; trusted host/client profile resolution provides the default, and an explicit parameter must match it.

### OAuth 2.0 Authorization Server Metadata — RFC 8414

Authorization-server metadata provides issuer, authorization endpoint, token endpoint, grants, and supported authentication methods.

### OAuth 2.0 Protected Resource Metadata — RFC 9728

Protected-resource metadata identifies the resource and authorization servers. It supports future interoperability and clearer diagnosis, even when the current ChatGPT Action does not consume it automatically.

### JWT validation

A protected resource must validate signature, issuer, audience, expiry, purpose, and subject. Merely placing an audience claim in the token is insufficient if the resource server does not enforce it.

### GitHub Spec Kit

Spec Kit provides constitution-driven `specify`, `clarify`, `plan`, `tasks`, and implementation workflow. In this repository, it is integrated with existing brownfield specification directories and does not replace runtime or mutation governance.

## Architectural decisions

### D-001 — Keep authorization server and protected resource separate

**Decision**: `auth.mad4b.com` remains the authorization server; `activation.mad4b.com` remains the Tenant Activation protected resource.

**Why**: Clear security boundary, stable Action server, independent resource policy, and standards alignment.

**Rejected alternative**: Move the Action server back to `auth.mad4b.com`. This hides the resource boundary and repeats the original architectural coupling.

### D-002 — Derive resource from trusted host/client profile

**Decision**: Resolve the default protected resource from trusted original/forwarded host and registered client profile; accept an explicit `resource` only when it matches.

**Why**: Does not rely on undocumented ChatGPT forwarding behavior and prevents arbitrary targets.

**Rejected alternative**: Embed a fixed query parameter inside the OpenAPI authorization URL. This is a compatibility workaround, not a durable contract.

### D-003 — Use single-audience access tokens

**Decision**: New access tokens use one protected-resource audience.

**Why**: Prevents a token intended for Activation from being accepted by APIs that only validate a legacy generic audience.

**Rejected alternative**: Multi-audience tokens containing both generic and resource audiences. This weakens isolation.

### D-004 — Centralize token verification at the gateway

**Decision**: Shared verification logic enforces issuer, audience, resource, purpose, tenant, and user before protected route dispatch.

**Why**: Prevents inconsistent checks and route-level bypass.

### D-005 — Separate lifecycle states

**Decision**: Validation, execution, evidence, delivery, acknowledgement, and rollback/reconciliation states remain independent.

**Why**: Transport success, execution success, and user receipt are not equivalent.

### D-006 — Hybrid durable operation identity across activation stages

**Decision**: Adopt the hybrid model recorded in `decisions/ADR-001-hybrid-activation-operation-ledger.md`. The general operation ledger owns shared operation identity, tenant/user ownership, idempotency, fingerprint, general status, timestamps, and audit correlation. An Activation-specific projection linked by the same `operation_id` owns Activation stages, readiness, evidence, delivery, acknowledgement, reconciliation, and deployment interpretation.

**Why**: This preserves one durable operation identity and reuses common execution controls without overloading shared tables or creating a competing Activation ledger.

### D-007 — Reconnect guidance is stage-specific

**Decision**: Only verified authentication/connection failures may produce reconnect guidance.

**Why**: Membership, workspace, dependency, stale-deployment, and contract failures require different remediation.

### D-008 — Deployment parity is part of activation diagnosis

**Decision**: Current runtime/build evidence participates in operational classification.

**Why**: A request against an older runtime must not be diagnosed as current tenant misconfiguration.

### D-009 — Multi-PR delivery

**Decision**: Specification, implementation workstreams, and closeout are separate PRs.

**Why**: The feature crosses authentication, gateway, data, application, observability, contracts, and deployment boundaries; smaller reviewed PRs reduce risk.

## Existing authority sources to preserve

- `AI_Agent_Knowledge_Guide.md` for engineering/runtime rules.
- `system_bootstrap.md` for execution authority and controlled dispatch.
- `memory_schema.json` for platform memory/state categories.
- `module_loader.md` and `prompt_router.md` for module/route selection.
- SQL registries for actions, endpoints, policies, capabilities, connections, workspaces, sessions, evidence, and deployment state.
- Canonical OpenAPI sources under `canonicals/` and generated API artifacts.

## Candidate implementation boundaries

### Interface layer

- OAuth routes.
- Activation gateway.
- Tenant Activation and Tenant Resolution routes.
- OAuth metadata and diagnostic endpoints.

### Application layer

- Activation lifecycle coordinator.
- Session-context resolution.
- Bootstrap and readiness evaluation.
- Retry/reconciliation service.
- Delivery/acknowledgement service.

### Domain/policy layer

- Activation state machine.
- Stage classification.
- reconnect-guidance policy.
- retry/idempotency policy.
- compatibility cutoff policy.

### Infrastructure layer

- SQL repositories/ledgers.
- connection registry adapters.
- provider-bootstrap adapters.
- GitHub/deployment parity adapter.
- metrics/logging/tracing adapters.

## Research gaps

1. Inventory the existing general operation ledger and related attempt/evidence tables, then map which physical records can support ADR-001 without semantic overlap; introduce only additive Activation projections for unmet domain needs.
2. Inventory every Tenant Activation and Tenant Resolution operation currently exposed in the canonical schema.
3. Confirm exact indexes and retention for OAuth code, session, operation, evidence, and attention records.
4. Define latency/error SLOs from production measurements rather than estimates.
5. Define the consumer acknowledgement contract used by the Tenant GPT client.
6. Confirm whether build SHA should be publicly visible or internal-only.
7. Define legacy token cutoff and cleanup procedure.

## Research completion gate

Research is complete enough for planning when all gaps that affect data ownership, public contracts, security boundaries, migration, or rollout are resolved or explicitly accepted with owners and blocking tasks.
