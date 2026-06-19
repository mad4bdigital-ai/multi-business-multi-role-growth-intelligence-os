# Rollout and Containment Plan

## Immediate P0 containment

Apply before architectural refactoring:

1. Block all tenant dispatch to `admin_platform_tool` unless an explicit tenant-safe canonical binding exists.
2. Reject requests that contain more than one selector.
3. Disable or deny tool aliases that bypass stricter action policy.
4. Deny state-changing capabilities without explicit mutation policy.
5. Deny provider execution with `pending_validation`, revoked, expired, or scope-mismatched credentials.
6. Disable raw tenant access to credential-intake admin tools.
7. Enable kill switches for:
   - local shell
   - local file writes/deletes
   - Cloudflare mutation
   - n8n run/activate/deactivate
   - raw credential-intake creation
8. Alert on any tenant request that resolves to an admin-only alias.

## Rollout stages

### Stage 0 — Inventory and containment

- containment active
- no new high-risk capability aliases
- complete alias/surface/policy inventory
- security owner assigned to every P0 item

### Stage 1 — Shadow decision engine

- new engine evaluates all requests
- legacy engine remains execution authority except P0 deny rules
- compare canonical identity, gates, and final decisions
- no side effects from shadow engine

**Exit:** legitimate mismatch rate is reviewed and accepted; no unexplained allow-by-new/deny-by-legacy cases.

### Stage 2 — Staging enforcement

- new engine authoritative in staging
- full acceptance matrix
- bounded approved mutation tests
- performance and failure-mode testing
- connector offline/stale scenarios

**Exit:** all P0/P1 acceptance tests pass; no critical observability gaps.

### Stage 3 — Production preview enforcement

- new engine authoritative for preview
- execution remains bounded by containment and selected low-risk capabilities
- monitor denial rates and client errors

### Stage 4 — Production phased enforcement

Suggested order:

1. selector strictness
2. admin/tenant surface isolation
3. credential usability
4. state-changing approval
5. secure intake
6. device trust
7. local consent
8. high-risk integration-specific policies

### Stage 5 — Legacy retirement

- remove silent selector precedence
- remove raw tenant admin-tool mappings
- remove duplicate legacy policy branches
- archive deprecated aliases
- retain audit and migration documentation

## Monitoring

Track:

- ambiguous selector requests
- alias mapping failures
- dual-surface policy mismatches
- tenant requests to admin surfaces
- required gates not evaluated
- `dispatch_ready` invariant violations
- credential state denials
- foreign/stale/offline device denials
- approval replay attempts
- intake replay/expiry events
- shadow-vs-legacy decision differences
- resolver p50/p95/p99 latency

## Rollback rules

- Every enforcement group has an independent server-side flag.
- Rollback must preserve P0 containment.
- Never restore silent selector precedence.
- Never restore tenant access to raw admin tools.
- Never permit unvalidated credentials for execution.
- Record rollback reason, approver, start time, expected end time, and compensating controls.

## Incident triggers

Immediately disable affected capability group when:

- a tenant obtains dispatch readiness for an admin-only capability
- an allowed decision has a required gate not passed
- a foreign device/resource passes ownership checks
- a replayed approval or intake token is accepted
- a secret is emitted in a response or trace
- a high-risk mutation lacks readback/audit evidence
