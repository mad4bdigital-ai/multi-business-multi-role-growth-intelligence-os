# Feature Specification: Tenant GPT Activation Lifecycle

**Branch**: `gpt/spec-012-tenant-activation-lifecycle-speckit-20260722`  
**Created**: 2026-07-22  
**Status**: Draft  
**Delivery**: Multi-PR  
**Spec owner**: Platform Admin / Activation Runtime

## Problem and verified baseline

Tenant GPT activation spans multiple independent boundaries: ChatGPT OAuth, authorization-code issuance, token exchange, protected-resource verification, tenant and workspace resolution, session-context creation, bootstrap validation, tool discovery, execution routing, delivery, acknowledgement, deployment parity, and operator recovery.

The platform currently contains working implementations for many of these stages, including OAuth code storage, resource-bound Tenant GPT access tokens, the `activation.mad4b.com` gateway, tenant session context, managed connection records, provider-bootstrap validation, governed tool registries, and GitHub-to-Hostinger production deployment. Recent operational evidence also showed a recurring class of incident where OAuth completed successfully but the user received a generic “secure tenant connection did not respond” message because the first protected request did not produce correlated runtime evidence or because the user attempt preceded the production deployment containing the repair.

The gap is not a single endpoint. It is the absence of one governed, testable, end-to-end lifecycle contract that defines:

- what each stage means;
- which source is authoritative;
- how stages correlate;
- how success and degradation are reported;
- when retry is safe;
- how unknown outcomes are reconciled;
- how deployment freshness is distinguished from user/session failure;
- and what evidence is required before the user is told to reconnect.

This specification defines that lifecycle. It does not itself change runtime behavior.

## Objective

Provide one complete, evidence-driven Tenant GPT Activation lifecycle in which a tenant user can authorize once, invoke `Activate`, receive Managed mode by default, and obtain an accurate status that distinguishes authentication, protected-resource access, membership, workspace, bootstrap, connector, provider, tool, delivery, and deployment failures.

The lifecycle must be secure, tenant-isolated, replay-safe, observable, backward-compatible during bounded migration windows, and recoverable without asking users to repeat OAuth when OAuth is not the failing stage.

## Scope

### Included

- ChatGPT OAuth authorization and callback handling.
- Authorization-code creation, persistence, one-time consumption, expiration, and binding.
- Token exchange and protected-resource audience/resource binding.
- Activation gateway host/path/method enforcement.
- Tenant/user/membership/workspace resolution from signed principal context.
- Session-context create/reuse and same-user history behavior.
- Managed-mode default selection and explicit dedicated-mode handling.
- Connection bootstrap and app integration status.
- Provider bootstrap validation and degraded-surface classification.
- Tenant tool discovery, scope filtering, and governed dispatch readiness.
- Activation operation state, evidence, delivery, and acknowledgement.
- Idempotency, retries, timeouts, unknown outcomes, reconciliation, and recovery.
- Structured errors, request IDs, audit evidence, metrics, and operational attention.
- GitHub `main` to Hostinger deployment parity and stale-runtime diagnosis.
- Rollout, rollback, compatibility windows, and closeout evidence.

### Excluded

- Business-provider writes such as publishing, sending, editing external assets, or executing campaigns.
- Billing, subscription, or payment changes.
- Rotation or disclosure of OAuth client secrets, provider credentials, JWT secrets, or backend keys.
- ChatGPT Workspace Admin UI policy changes.
- Replacing SQL/registry runtime authority with specification files.
- Rebuilding the broader agent runtime outside activation and governed tenant entry points.

## Actors and authority

| Actor | Principal/auth mode | Responsibilities | Forbidden behavior |
|---|---|---|---|
| Tenant user | Google/user JWT | Authorize, request activation, acknowledge outcome | Override tenant, workspace, audience, resource, or role |
| ChatGPT Action client | Registered OAuth client | Initiate OAuth and call declared Tenant Activation operations | Send arbitrary resource/server targets or privileged admin operations |
| Authorization server | Platform service | Validate client/callback, issue and consume codes, mint access tokens | Issue unbound or cross-resource tokens |
| Activation gateway | Resource server boundary | Enforce host/path/method and Tenant GPT access token | Trust caller-supplied tenant/user identity |
| Session-context service | Governed application service | Resolve tenant/user history, membership, scopes, and session policy | Treat transport success as activation completion |
| Bootstrap coordinator | Governed application service | Resolve mode, workspace, connections, provider bootstrap, tools | Invent action/endpoint keys or bypass registry authority |
| Connector/provider adapters | Governed infrastructure | Validate configured integrations and return bounded evidence | Expose credentials or perform unapproved writes |
| Operation/evidence ledger | SQL authority | Persist lifecycle states, evidence, retries, delivery, acknowledgement | Collapse validation, execution, and delivery states |
| Platform operator | Admin/service principal | Diagnose, recover, deploy, and reconcile with approvals | Cross tenant boundaries without admin authority or bypass readback |
| Deployment pipeline | GitHub `main` → Hostinger | Deploy reviewed code and report parity/health | Deploy unreviewed local state as normal path |

## User journeys

### US1 — First successful activation (P1)

**Given** a tenant user with a valid membership and registered ChatGPT OAuth connection  
**When** the user authorizes and sends `Activate`  
**Then** the platform validates the Activation protected resource, creates or reuses tenant session context, selects Managed mode by default, resolves workspace and connection state, validates provider/bootstrap readiness, returns scoped tenant tools, and reports an evidence-backed activation status.

### US2 — Returning user activation (P1)

**Given** a non-expired resource-bound connection and an existing tenant session  
**When** the user sends `Activate` again  
**Then** the platform reuses or creates session context according to policy without requiring OAuth, and returns a current status rather than replaying stale narrative.

### US3 — Expired or revoked authorization (P1)

**Given** an expired, revoked, malformed, wrong-issuer, or wrong-resource token  
**When** the user invokes a protected Tenant Activation operation  
**Then** the gateway rejects it with a stable authentication error and reconnect guidance only when authorization is the verified failing stage.

### US4 — Incomplete tenant bootstrap (P1)

**Given** OAuth succeeds but membership, workspace, connector, provider, or tool readiness is incomplete  
**When** the user sends `Activate`  
**Then** the platform returns the exact degraded stage, evidence, and next action without instructing the user to repeat OAuth unnecessarily.

### US5 — Transient dependency failure (P1)

**Given** an upstream timeout, 502, rate limit, or unknown response after dispatch  
**When** activation is attempted  
**Then** the platform records a durable operation, distinguishes retryable from unknown outcome, reconciles before replay, and reports a truthful non-terminal state.

### US6 — Operator diagnosis and recovery (P2)

**Given** a failed or stalled activation operation  
**When** an authorized operator investigates  
**Then** the operator can correlate OAuth, gateway, session, bootstrap, deployment, and delivery evidence using bounded no-secret diagnostics and execute governed recovery with readback.

### US7 — Deployment transition (P2)

**Given** a fix is merged while users continue to activate  
**When** a request occurs before or during deployment propagation  
**Then** the platform identifies stale runtime/deployment parity separately from user authorization or tenant configuration failure.

## Functional requirements

### OAuth and protected-resource binding

- **FR-001**: The authorization server must accept only registered Tenant GPT clients and canonical ChatGPT callback URLs.
- **FR-002**: The authorization request must resolve a registered protected-resource profile from trusted host evidence and an optional matching `resource` parameter.
- **FR-003**: Authorization codes must be one-time, short-lived, hashed at rest where persisted, and bound to user, tenant, client, callback, scope, and protected resource.
- **FR-004**: Token exchange must reject expired, reused, malformed, wrong-client, wrong-callback, and wrong-resource codes with stable errors.
- **FR-005**: New Tenant GPT access tokens must use a single protected-resource audience and include issuer, authorized party/client, purpose, tenant, user, scope, resource, issued-at, expiry, and unique token ID claims.
- **FR-006**: Legacy audience acceptance, if enabled, must be bounded by an explicit cutoff and observable as legacy compatibility evidence.
- **FR-007**: Tokens, codes, client secrets, and raw authorization headers must never be logged or returned in diagnostic evidence.

### Gateway and tenant identity

- **FR-008**: `activation.mad4b.com` must allow only declared public, OAuth, admin, Tenant Activation, and Tenant Resolution paths and methods.
- **FR-009**: Tenant protected paths must enforce signature, issuer, audience, resource, purpose, expiry, tenant, and user claims before route dispatch.
- **FR-010**: Tenant ID, user ID, role, workspace, and resource identity must derive from verified principal and registry context, not request-body overrides.
- **FR-011**: Authentication failure and authorization failure must remain distinct and produce `401` and `403` semantics respectively.
- **FR-012**: Cross-tenant, wrong-resource, multi-audience, missing-membership, and privilege-expansion attempts must fail closed.

### Session context and activation bootstrap

- **FR-013**: Activation must obtain session context before reporting platform readiness.
- **FR-014**: Session policy must support `reuse_or_create`, `create_new`, `reuse_only`, and `read_only`, with deterministic behavior and bounded history.
- **FR-015**: Session context must resolve active membership, workspace readiness, role/scopes, connected systems, tool visibility, prior session summaries, and degraded dependencies.
- **FR-016**: Managed mode must be selected by default when the user does not specify a mode.
- **FR-017**: Dedicated mode must require confirmed dedicated infrastructure readiness before installation or activation claims.
- **FR-018**: Mixed integrations must resolve per-app `integration_modes` without widening unrelated app permissions.
- **FR-019**: Bootstrap configuration must come from backend runtime/SQL authority; legacy Sheets bootstrap must not be invoked.
- **FR-020**: Provider-bootstrap validation must collect Drive, DB bootstrap, and GitHub evidence in the same cycle for Admin flows where required.
- **FR-021**: Activation status must classify `active`, `validating`, `authorization_gated`, `validation_rate_limited`, `degraded`, and `degraded_contract` from evidence rather than narrative.

### Tool discovery and governed execution

- **FR-022**: Tenant tool discovery and Tenant Resolution authorization must expose only registry-callable actions permitted by tenant, user, membership, workspace, app, protected resource, broad OAuth scopes, active dynamic operation policy, role, capability, and object-level authority.
- **FR-023**: Runtime dispatch must resolve `parent_action_key`, `endpoint_key`, public `operation_id`, and active authorization policy from registry authority and reject forbidden, missing, expired, ambiguous, or invented keys/policies.
- **FR-024**: Activation must distinguish tool visibility, dependency readiness, credential readiness, execution readiness, and authorization-policy readiness.
- **FR-025**: Provider writes, external sends, live executions, billing, repair application, approval decisions, or other sensitive actions remain blocked unless the active dynamic policy's capability, object authority, plan-bound approval, typed confirmation, idempotency, dependency, and readback requirements are satisfied.

### Durable lifecycle and evidence

- **FR-026**: Each activation attempt must have a durable operation or correlation identity spanning OAuth where available, gateway request, session context, bootstrap, tool discovery, and response delivery.
- **FR-027**: Activation state must separate validation, execution, evidence, delivery, acknowledgement, and rollback/compensation states.
- **FR-028**: Unsafe retryable mutations must use idempotency keys and operation fingerprints.
- **FR-029**: Transport failure after dispatch must be recorded as unknown outcome until authoritative reconciliation.
- **FR-030**: Recovered success must cite same-operation evidence and may not be inferred from an unrelated later success.
- **FR-031**: Delivery to the GPT client and user acknowledgement must not be conflated with activation execution success.
- **FR-032**: Operations must expose bounded, no-secret status and evidence summaries with completeness and freshness indicators.

### Deployment and operations

- **FR-033**: Runtime responses must identify build/deployment evidence sufficient to diagnose stale production without exposing internals or secrets.
- **FR-034**: Production readiness must verify GitHub `main` SHA, Hostinger deployed SHA, migration state, service health, and required contract/version parity.
- **FR-035**: A user attempt that predates a relevant deployment must be classified as stale-runtime evidence rather than current tenant failure.
- **FR-036**: Rollback must support feature disablement or release rollback without invalidating unrelated tenant sessions.
- **FR-037**: Operational attention must identify auth failures, tenant resolution failures, provider degradation, stale deployment, repeated retries, and unacknowledged operations.
- **FR-038**: Reconnect guidance must be emitted only for verified authorization failure, revoked connection, or absent required OAuth connection.
- **FR-039**: Operator recovery must use governed tools, approvals, resource authority, readback, and audit logging.
- **FR-040**: Completion must require CI, production parity, health, protected-user-path smoke, rollback readiness, and no unresolved critical concerns.

## Non-functional requirements

- **NFR-001 Security**: Default deny, least privilege, no-secret responses, strict tenant isolation, resource-bound tokens, and replay resistance.
- **NFR-002 Availability**: Dependency failures must degrade individual surfaces without misclassifying the entire tenant as unauthenticated.
- **NFR-003 Performance**: Summary activation responses should remain bounded and avoid loading full evidence graphs by default; detailed evidence uses pagination/chunks.
- **NFR-004 Observability**: Every stage must emit correlation, stage status, latency, retryability, and authoritative evidence source without sensitive values.
- **NFR-005 Compatibility**: Existing OAuth client credentials and documented Tenant Activation URLs remain stable unless a separately approved migration is defined.
- **NFR-006 Maintainability**: Shared security, state, and error logic must be centralized and tested rather than duplicated across route handlers.
- **NFR-007 Portability**: Contracts must not assume ChatGPT-specific UI behavior beyond the registered OAuth callback and Action request contract.
- **NFR-008 Auditability**: Security-sensitive and mutation-capable transitions must be reconstructable from SQL evidence and governed external readback.

## State and data requirements

See `data-model.md`. The lifecycle must model OAuth authorization code, access-token verification evidence, tenant membership/workspace resolution, activation operation, stage attempt, evidence item, connection/bootstrap status, delivery, acknowledgement, reconciliation, deployment observation, and operational attention.

No model stores raw access tokens, raw authorization codes, client secrets, provider credentials, or unbounded request/response bodies.

## Contracts

Draft contracts are located under `contracts/` and are not runtime authority until an implementation PR updates canonical sources and generated OpenAPI artifacts.

Public error responses follow a stable envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ACTIVATION_STAGE_UNAVAILABLE",
    "message": "Activation could not complete because a required stage is unavailable.",
    "details": {
      "stage": "session_context",
      "retryable": true
    },
    "requestId": "req_example"
  }
}
```

## Error taxonomy

| Code | HTTP | Stage | Retryable | User action | Readback |
|---|---:|---|---|---|---|
| `USER_JWT_REQUIRED` | 401 | gateway | No | Connect OAuth | Gateway/auth log |
| `USER_JWT_INVALID` | 401 | gateway | No | Reconnect | Token verification evidence |
| `TOKEN_RESOURCE_INVALID` | 401 | gateway | No | Reconnect/correct client | Verification evidence |
| `MEMBERSHIP_REQUIRED` | 403 | session | No | Request tenant access | Membership registry |
| `WORKSPACE_NOT_READY` | 409 | bootstrap | Sometimes | Complete workspace bootstrap | Workspace registry |
| `CONNECTION_REQUIRED` | 409 | bootstrap | No | Connect named app | Connection registry |
| `BOOTSTRAP_VALIDATING` | 202 | bootstrap | Yes | Retry later | Bootstrap evidence |
| `VALIDATION_RATE_LIMITED` | 429 | provider validation | Yes | Retry after guidance | Provider response + retry time |
| `ACTIVATION_DEPENDENCY_UNAVAILABLE` | 503 | any dependency | Yes | Retry later | Stage attempt evidence |
| `ACTIVATION_OUTCOME_UNKNOWN` | 202 | dispatch | Reconcile first | Do not blindly replay | Operation/reconciliation ledger |
| `DEPLOYMENT_STALE` | 503 | deployment | Yes | Wait for deploy or operator action | Main/deployed SHA parity |
| `ACTIVATION_CONTRACT_ERROR` | 502 | contract | No until fixed | Operator support | Schema/client evidence |

## Security and privacy

Security analysis is defined in `concerns.md` and `checklists/security.md`. Required threat cases include confused deputy, host spoofing, callback manipulation, code replay, token replay, wrong-resource token, multi-audience token, cross-tenant subject, membership revocation, stale authorization evidence, credential leakage, log injection, SSRF through resource identifiers, and privilege expansion through tool discovery.

## Observability and evidence

Minimum correlation fields:

- `request_id`;
- `operation_id`;
- `oauth_code_record_id` or redacted hash reference where applicable;
- `tenant_id` and `user_id` in governed internal evidence only;
- `session_id`;
- `stage_key` and `stage_attempt`;
- `deployment_sha`;
- `status`, `retryable`, `source`, and timestamps;
- `delivery_id` and acknowledgement state.

User-visible summaries are bounded and omit raw identifiers where not needed.

## Rollout, rollback, and compatibility

The implementation plan must use additive data/schema changes, feature-gated enforcement where compatibility is required, and a bounded legacy-audience cutoff. Runtime rollout proceeds through reviewed PRs, CI, fresh merge evidence, auto-deploy, production parity, and protected-user-path smoke. Rollback prefers feature disablement or release rollback and must preserve unrelated tenant data and connections.

## Success criteria

- **SC-001**: At least 99% of valid returning-user activation requests reach session-context resolution without OAuth reconnect guidance.
- **SC-002**: 100% of wrong-resource and cross-tenant tokens are rejected before tenant route execution.
- **SC-003**: Every activation response identifies the actual failing stage or an explicit unknown-outcome state.
- **SC-004**: No user is instructed to reconnect when OAuth token exchange and gateway verification succeeded in the same correlated attempt.
- **SC-005**: Required CI, deployment parity, health, and production smoke evidence are complete before closeout.
- **SC-006**: No raw secret, token, code, or credential appears in logs, evidence, contracts, fixtures, or GPT-visible responses.
- **SC-007**: Retry/reconciliation tests prove no duplicate unsafe operation after timeout or 5xx ambiguity.
- **SC-008**: Operational attention surfaces stalled, repeated, stale-deployment, and unacknowledged activation operations within the defined monitoring interval.

## Resolved decisions

- **ADR-001 / former Q-001**: Adopt a hybrid operation model: the general operation ledger owns shared identity, idempotency, ownership, and general lifecycle facts; an Activation-specific projection owns Activation stages, readiness, evidence, delivery, acknowledgement, reconciliation, and deployment interpretation. See `decisions/ADR-001-hybrid-activation-operation-ledger.md`.
- **ADR-002 / former Q-002**: End support for legacy generic, unbound Tenant GPT tokens through a phased migration with a hard cutoff at `2026-10-31T23:59:59Z`, targeted notices, canary enforcement, and a maximum 14-day explicitly approved emergency extension.
- **ADR-003**: Use one public Tenant GPT OAuth client and centrally governed secret for all users and tenants, while issuing resource-bound access tokens for exactly one user, tenant, protected resource, scope set, and purpose.
- **ADR-004 / former Q-003**: Keep Tenant Activation and Tenant Resolution under the same Activation protected resource and unified OAuth client. Use five stable Resolution scopes (`read`, `manage`, `diagnose`, `repair`, `approve`) while resolving route/action requirements, roles, capabilities, object authority, risk, approvals, idempotency, and readback dynamically from a governed versioned SQL policy registry. See `decisions/ADR-004-dynamic-resolution-authorization-policy.md`.

## Open questions

- **Q-004**: What service-level targets apply to session context and provider-bootstrap validation? Owner: operations. Gate: before alert thresholds.
- **Q-005**: Should deployment SHA be exposed as a public response field, response header, or only correlated internally? Owner: API/security. Gate: before contract finalization.

## Delivery state

This branch creates specification and governance artifacts only. It does not authorize runtime code changes, database migrations, provider calls, external writes, merge, deployment, credential changes, or production recovery actions.
