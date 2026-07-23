# Operation Paths: Tenant GPT Activation Lifecycle

## Path notation

Each path defines actor, entry point, preconditions, authority, sequence, failures, retry/idempotency, evidence/readback, and recovery. Operation IDs are stable references for requirements, contracts, tasks, tests, and runbooks.

## OP-001 — OAuth authorization initiation

**Actor**: Tenant user through registered ChatGPT Action client  
**Entry point**: `GET /auth/oauth/authorize`  
**Preconditions**: Registered client, canonical callback, state, allowed scope, trusted request host  
**Authority**: OAuth client config, callback allowlist, protected-resource profile

**Normal sequence**:

1. Normalize client, callback, state, scope, optional resource, and trusted host evidence.
2. Validate client and callback exactly.
3. Resolve protected resource from registered host/client profile.
4. If an explicit resource is present, require exact match.
5. Render authorization UI with server-derived client/resource values and no secrets.

**Failure branches**:

- Invalid client/callback/state → `400` and no authorization UI.
- Unregistered host or resource mismatch → `400 invalid_target`.
- Dependency/config unavailable → `503` with request ID.

**Retry/idempotency**: Read-only; safe to retry with the same state only before code issuance.  
**Evidence/readback**: Authorization-stage log with client profile key, callback classification, resource origin, request ID, and no raw state/token.  
**Recovery**: Correct GPT Action configuration or restore config authority; do not ask user to reconnect an already valid connection.

## OP-002 — User identity verification and authorization-code issuance

**Actor**: Tenant user, authorization page, identity provider  
**Entry point**: `POST /auth/oauth/code`  
**Preconditions**: Valid identity assertion, state, callback, derived OAuth client/resource  
**Authority**: Identity verification, membership/JIT rules, code store

**Normal sequence**:

1. Verify identity assertion and normalize email/subject.
2. Resolve or create user/tenant/membership only under approved JIT policy.
3. Revalidate callback and protected-resource profile from trusted host.
4. Create a signed short-lived code containing user, tenant, client, callback, scope, resource, purpose, and activation context.
5. Persist a one-time hashed code record.
6. Return code and expiry to the authorization UI, which redirects to the canonical callback.

**Failure branches**:

- Invalid identity → `401`.
- Membership/JIT denied → `403`.
- Resource/client mismatch → `400 invalid_target`.
- Code-store failure → `503`; no success redirect.

**Retry/idempotency**: A repeated successful identity submission may create a new code; each code is independently one-time.  
**Evidence/readback**: Code record with status `issued`, subject/client/resource/callback hashes or bounded identifiers, expiry, and request ID.  
**Recovery**: Retry identity verification; never log or expose raw code outside the callback flow.

## OP-003 — Authorization-code token exchange

**Actor**: ChatGPT Action OAuth client  
**Entry point**: `POST /auth/oauth/token`  
**Preconditions**: Registered client authentication, unexpired unused code, matching callback and resource  
**Authority**: OAuth client registry, code store, JWT issuer policy

**Normal sequence**:

1. Authenticate client using the configured method.
2. Resolve protected-resource profile from client and trusted token-endpoint host.
3. Verify signed code and persisted code record.
4. Require client, callback, resource, user, tenant, purpose, status, and expiry match.
5. Atomically consume the code.
6. Issue a short-lived single-audience Tenant GPT access token.
7. Return OAuth token response with stable cache-control behavior.

**Failure branches**:

- Invalid client → `401 invalid_client`.
- Invalid/reused/expired code → `400 invalid_grant`.
- Wrong resource → `400 invalid_target`.
- Atomic consumption conflict → `400 invalid_grant`.
- Issuer/store unavailable → `503` and code consumption must remain consistent.

**Retry/idempotency**: Token exchange is not freely replayable. A retry after ambiguous transport must inspect code consumption status; consumed code cannot mint another token.  
**Evidence/readback**: Token exchange status, code record consumption, client/resource profile, token JTI hash/reference, no raw token.  
**Recovery**: Restart authorization only after verified code failure; do not blindly replay a consumed code.

## OP-004 — First protected Tenant Activation request

**Actor**: ChatGPT Action client with bearer token  
**Entry point**: Declared `/tenant/activation/*` operation  
**Preconditions**: HTTPS Activation host, allowed path/method, bearer token  
**Authority**: Activation gateway policy and centralized token verifier

**Normal sequence**:

1. Validate host and allowed path/method.
2. Extract bearer token without logging it.
3. Verify signature, issuer, expiry, purpose, single audience, resource, tenant, and user.
4. Resolve active membership and attach immutable principal context.
5. Create/correlate activation operation and dispatch route.

**Failure branches**:

- No/invalid token → `401` with reconnect guidance.
- Valid identity but missing membership/scope → `403` without reconnect guidance.
- Wrong host/path/method → `404/405` or gateway policy error.
- Runtime unavailable → `503` and stage evidence.

**Retry/idempotency**: Protected reads are safe; activation mutations use operation/idempotency identity.  
**Evidence/readback**: Gateway verification stage and route entry stage must correlate. A successful OAuth exchange without route entry produces an OAuth-to-gateway gap classification.  
**Recovery**: Reconnect only for verified token/connection failure; otherwise diagnose client transport, gateway, deployment, or tenant stage.

## OP-005 — Session-context resolve or create

**Actor**: Activation coordinator  
**Entry point**: `/tenant/activation/session-context` or equivalent governed service  
**Preconditions**: Verified principal, active membership  
**Authority**: SQL sessions/history, membership, workspace, scopes, connected systems

**Normal sequence**:

1. Apply session policy: `reuse_or_create`, `create_new`, `reuse_only`, or `read_only`.
2. Resolve tenant/user-scoped session and bounded prior history.
3. Resolve platform access, workspace, roles/scopes, connected systems, tool visibility, and known degraded surfaces.
4. Return summary-first context with detail/chunk references.

**Failure branches**:

- Membership missing/revoked → `403`.
- Reuse-only with no session → `404/409` defined by final contract.
- Session persistence unavailable → `503`.
- Bounded response contract failure → `degraded_contract`.

**Retry/idempotency**: Reuse is idempotent; create-new uses operation identity to avoid duplicate sessions on retry.  
**Evidence/readback**: Session ID, policy, created/reused state, membership/workspace evidence, completeness/freshness.  
**Recovery**: Recreate session if safe; never widen tenant scope or use another user’s history.

## OP-006 — Managed activation bootstrap

**Actor**: Tenant user through activation coordinator  
**Entry point**: Activate operation with no explicit mode  
**Preconditions**: Session context loaded  
**Authority**: Backend bootstrap config, workspace registry, connection registry, activation policy

**Normal sequence**:

1. Default mode to `managed`.
2. Resolve workspace and bootstrap status.
3. Resolve per-app integration modes and active connection records.
4. Read backend runtime bootstrap config.
5. Validate required connection/dependency readiness.
6. Produce activation readiness by surface.

**Failure branches**:

- Workspace absent/not ready → `WORKSPACE_NOT_READY`.
- Required app connection absent → `CONNECTION_REQUIRED` naming the app.
- Mixed-mode conflict → `409` with per-app details.
- Bootstrap authority unavailable → `503`, not authentication failure.

**Retry/idempotency**: Readiness evaluation is idempotent. Any JIT creation or installation uses a durable operation and its own authority.  
**Evidence/readback**: Workspace, connection, mode, bootstrap-source, and readiness evidence.  
**Recovery**: Complete workspace/connection step; preserve already valid OAuth/session state.

## OP-007 — Dedicated or mixed-mode activation

**Actor**: Tenant user/operator  
**Entry point**: Activate with `dedicated` or `integration_modes`  
**Preconditions**: Verified principal, explicit mode, dedicated infrastructure policy  
**Authority**: Tenant activation policy and connector registry

**Normal sequence**:

1. Validate requested mode and per-app overrides.
2. Require dedicated infrastructure active before install.
3. Resolve connection targets and capability requirements.
4. Produce readiness or an approved installation plan.

**Failure branches**: Missing infrastructure, unsupported mixed mode, permission gap, or connector dependency.  
**Retry/idempotency**: Installation is an unsafe mutation and requires operation identity, approval where applicable, readback, and rollback.  
**Evidence/readback**: Infrastructure/connector status and installation receipt.  
**Recovery**: Activate infrastructure, correct modes, or revert to Managed without deleting valid connections.

## OP-008 — Provider-bootstrap validation

**Actor**: Admin activation coordinator or authorized tenant validation flow  
**Entry point**: Governed provider-bootstrap validation tool  
**Preconditions**: Required admin/service authority for platform-owned validation  
**Authority**: Drive probe, DB bootstrap read, GitHub validation, registry contracts

**Normal sequence**:

1. Collect required validation surfaces in the same cycle.
2. Classify each as active, validating, authorization-gated, rate-limited, degraded, or contract-degraded.
3. Return summary and evidence references without secrets.

**Failure branches**: Missing transport attempt, binding mismatch, auth failure, rate limit, schema/client error, or partial validation.  
**Retry/idempotency**: Read-only validation can retry within budgets; rate limits honor retry guidance.  
**Evidence/readback**: Same-cycle surface evidence and completeness.  
**Recovery**: Targeted probe/recovery; recovered classification requires same-cycle validation.

## OP-009 — Tenant tool discovery and readiness

**Actor**: Activation coordinator  
**Entry point**: Governed tenant tool registry  
**Preconditions**: Verified tenant/user/workspace/app scopes  
**Authority**: Actions/endpoints/capability/resource/credential registries

**Normal sequence**:

1. Resolve permitted apps and capabilities.
2. Filter runtime-callable actions and endpoints.
3. Resolve dependencies and credentials without exposing them.
4. Return tool visibility and readiness separately.

**Failure branches**: Tool not registered, not callable, missing scope, missing dependency, or credential gap.  
**Retry/idempotency**: Read-only discovery.  
**Evidence/readback**: Registry keys, readiness reasons, source versions.  
**Recovery**: Register/fix binding or connection; never invent keys.

## OP-010 — Governed activation action dispatch

**Actor**: Tenant user/assistant  
**Entry point**: Selected runtime-callable tenant operation  
**Preconditions**: Activation ready, tool permitted, dependencies ready  
**Authority**: Prompt router, module loader, system bootstrap, execution policy

**Normal sequence**:

1. Resolve intent/activity and governed logic/engine compatibility.
2. Resolve action and endpoint keys.
3. Validate bindings, workflow, dependencies, credentials, and approval policy.
4. Create durable operation/attempt.
5. Dispatch through governed transport.
6. Persist result/evidence and perform authoritative readback.

**Failure branches**: Invalid binding, blocked approval, dependency unavailable, transport failure, provider error, unknown outcome, or readback mismatch.  
**Retry/idempotency**: Unsafe mutations require idempotency and reconcile-before-retry.  
**Evidence/readback**: Attempt receipt, provider/readback evidence, execution status.  
**Recovery**: Retry safe reads; reconcile ambiguous writes; do not claim success from transport alone.

## OP-011 — Activation response delivery and acknowledgement

**Actor**: Platform response layer and Tenant GPT user  
**Entry point**: Completed or non-terminal activation operation  
**Preconditions**: Bounded response object  
**Authority**: Delivery ledger and acknowledgement policy

**Normal sequence**:

1. Build user-visible summary from operation evidence.
2. Include stage status, next action, retryability, freshness, and request/operation reference.
3. Deliver response.
4. Record delivery state.
5. Record explicit or implicit acknowledgement separately when supported.

**Failure branches**: Delivery transport failure, response too large, client disconnect, or acknowledgement absent.  
**Retry/idempotency**: Retry delivery without replaying activation execution.  
**Evidence/readback**: Delivery receipt and acknowledgement state.  
**Recovery**: Re-deliver summary or allow status retrieval by operation ID.

## OP-012 — Token expiry, revocation, and reconnect

**Actor**: Tenant user and gateway  
**Entry point**: Protected call with invalid connection state  
**Preconditions**: Existing or missing connection  
**Authority**: Token verification and connection registry

**Normal sequence**:

1. Identify exact auth failure: missing token, expired token, revoked connection, invalid issuer/resource, or malformed token.
2. Return stable reconnect guidance.
3. Preserve tenant/session records unless revocation policy requires closure.

**Failure branches**: Valid auth but other stage failed—must not enter this path.  
**Retry/idempotency**: User completes a new OAuth authorization; old codes/tokens remain unusable.  
**Evidence/readback**: Auth failure and subsequent successful connection record.  
**Recovery**: Reconnect and retry Activate.

## OP-013 — Transient dependency failure and retry

**Actor**: Activation coordinator  
**Entry point**: Any stage dependency call  
**Preconditions**: Durable operation and stage attempt  
**Authority**: Retry policy and dependency classification

**Normal sequence**:

1. Classify timeout, DNS/transport, 429, 5xx, dependency unavailable, or contract failure.
2. Record attempt and retryability.
3. Apply bounded backoff/retry for safe operations.
4. Return validating/degraded state if budget expires.

**Failure branches**: Retry budget exhausted or non-retryable contract/auth error.  
**Retry/idempotency**: Reads may retry; writes require idempotency and reconciliation.  
**Evidence/readback**: Attempt count, elapsed time, retry-after, final stage state.  
**Recovery**: Later status/retry or operator intervention.

## OP-014 — Unknown outcome and reconciliation

**Actor**: Runtime coordinator/reconciler  
**Entry point**: Transport failure after possible external mutation  
**Preconditions**: Operation fingerprint and dispatch receipt  
**Authority**: Operation ledger, provider readback contract

**Normal sequence**:

1. Mark operation/attempt `unknown_outcome`.
2. Suppress blind replay.
3. Execute authoritative readback using operation fingerprint/idempotency key.
4. Classify executed, not executed, conflicting, or still unknown.
5. Resume, compensate, or escalate.

**Failure branches**: Readback unavailable or ambiguous.  
**Retry/idempotency**: Reconciliation retries are safe; mutation replay only after evidence permits.  
**Evidence/readback**: Reconciliation attempts and final classification.  
**Recovery**: Manual review for persistent ambiguity.

## OP-015 — Membership/workspace/connection remediation

**Actor**: Tenant user/operator  
**Entry point**: Activation degradation at tenant bootstrap  
**Preconditions**: Auth succeeded  
**Authority**: Membership, workspace, connection registries

**Normal sequence**:

1. Identify exact missing/inactive record.
2. Return stage-specific next action.
3. Apply approved JIT or operator remediation.
4. Read back active status.
5. Resume the same activation operation or create a linked retry.

**Failure branches**: Permission or policy denies remediation.  
**Retry/idempotency**: Upserts/installations use durable identity.  
**Evidence/readback**: Registry state before/after.  
**Recovery**: Escalate without asking for unrelated OAuth reconnect.

## OP-016 — Deployment freshness diagnosis

**Actor**: Activation coordinator/operator  
**Entry point**: Unexpected behavior after merge or release  
**Preconditions**: Request timestamp and deployment observations  
**Authority**: GitHub main SHA, Hostinger deployed SHA, release/readiness evidence

**Normal sequence**:

1. Compare request time/version with merged and deployed revisions.
2. Classify current, deploying, stale, diverged, or unknown parity.
3. Prevent stale attempt evidence from diagnosing current tenant state.
4. Retry smoke after parity is confirmed.

**Failure branches**: Deployment evidence unavailable or parity mismatch.  
**Retry/idempotency**: Read-only.  
**Evidence/readback**: Main/deployed SHA, deploy time, health, contract version.  
**Recovery**: Wait, redeploy through governed path, or rollback.

## OP-017 — Operator diagnosis and governed recovery

**Actor**: Platform admin/service principal  
**Entry point**: Operational attention or support case  
**Preconditions**: Admin authority and scoped tenant/operation identifiers  
**Authority**: Admin tool registry, resource grants, approval policies

**Normal sequence**:

1. Read operation timeline and no-secret evidence.
2. Identify failing stage and authority source.
3. Create required capability/approval for mutation.
4. Execute targeted recovery.
5. Perform same-cycle readback.
6. Update operation and user guidance.

**Failure branches**: Authorization-gated, stale approval, missing resource binding, or readback failure.  
**Retry/idempotency**: Governed by recovery operation.  
**Evidence/readback**: Approval, mutation receipt, readback, audit.  
**Recovery**: Abort without side effects or escalate.

## OP-018 — Rollback and post-rollback verification

**Actor**: Release operator  
**Entry point**: Rollback trigger after deployment  
**Preconditions**: Approved release/rollback authority, known prior stable revision, migration compatibility  
**Authority**: Release gates, GitHub/Hostinger deployment, migration policy

**Normal sequence**:

1. Freeze or disable affected feature path.
2. Confirm rollback compatibility with additive schema and active operations.
3. Roll back release or feature flag.
4. Verify main/deployed policy, health, auth, gateway, session context, and activation smoke.
5. Reconcile operations that crossed the rollback boundary.

**Failure branches**: Irreversible migration, unknown active mutation, or rollback health failure.  
**Retry/idempotency**: Release operation is durable and audited.  
**Evidence/readback**: Prior/new revision, health, smoke, reconciled operation counts.  
**Recovery**: Forward-fix or controlled maintenance mode.

## Path coverage gate

Implementation planning cannot pass until every path maps to requirements, contracts, data/state, tasks, tests, metrics, and recovery/runbook ownership.
