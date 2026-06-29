# Operational Model

## Purpose

Define observability, SLOs, audit evidence, alerts, support states, and operational ownership for authorization and execution governance.

## Service-level indicators

### Authorization

- decision availability;
- p50, p95, and p99 decision latency;
- hard-deny rate by stable reason code;
- conditional-decision rate;
- stale-decision rejection rate;
- ambiguous-resolution rate;
- authority dependency error rate.

### Approval

- approval request creation success;
- approval decision latency;
- approval expiry rate;
- stale approval rejection rate;
- self-approval denial count;
- break-glass use and expiry count.

### Execution

- envelope issuance success;
- dispatch reservation conflicts;
- duplicate dispatch prevented;
- adapter preflight success;
- provider acknowledgement rate;
- timeout with uncertain effect rate;
- execution success/failure by capability and adapter;
- compensation and manual intervention rate.

### Verification

- readback completion rate;
- state verification rate;
- effect verification rate;
- incomplete evidence rate;
- readback mismatch rate;
- mean time from acknowledgement to verified effect.

### Reconciliation

- controller lag by authority type;
- processed and changed items;
- retries and poison items;
- stale envelope invalidation time;
- projection drift rate;
- unresolved mismatch age.

### Migration

- legacy/adaptive parity by capability;
- mismatch category counts;
- legacy route usage;
- compatibility wrapper usage;
- adaptive enforcement cohort size;
- rollback activation count.

## Initial SLO proposals

Values are proposals and require production-baseline approval.

```text
authorization decision availability >= 99.95%
p95 low-risk decision latency <= 150 ms
p99 low-risk decision latency <= 400 ms
cross-tenant false allow = 0
replayed state-changing envelope executed = 0
uncertified adapter dispatch = 0
provider mutation without execution evidence = 0
critical parity mismatches unresolved at canary = 0
p95 stale-envelope invalidation <= 60 seconds
p95 projection reconciliation lag <= 5 minutes
```

External provider latency is measured separately from internal authorization latency.

## Required dimensions

Metrics may be labeled only with bounded dimensions:

- capability key and version;
- decision effect;
- stable reason code;
- adapter key and version;
- rollout mode;
- operation class;
- environment;
- verification level;
- reconciliation controller key.

Do not label metrics with raw user IDs, resource IDs, request payloads, tokens, prompts, or unrestricted tenant identifiers.

## Structured audit events

### authorization.decision.created

Includes decision ID, subject class, capability, resource class, effect, reason codes, obligation codes, revision-vector hash, expiry, and actor attribution.

### approval.decision.created

Includes approval request ID, envelope ID, decision, approver role, policy version, expiry, and bound-evidence hash.

### execution.envelope.issued

Includes decision ID, envelope ID, capability, adapter, state, request hash, expiry, and single-use marker.

### execution.dispatch.reserved

Includes envelope ID, execution ID, idempotency identity hash, adapter, and reservation expiry.

### execution.provider.acknowledged

Includes execution ID, bounded provider reference, acknowledgement timestamp, and retry classification.

### execution.readback.completed

Includes execution ID, verification level, observed revision, evidence hash, mismatch code, and observation timestamp.

### reconciliation.action.completed

Includes controller, scope class, source revision, target count, changed count, result, and checkpoint.

Audit events never contain raw credential material.

## Alert severity

### Critical

- cross-tenant allow or execution;
- replayed envelope executed;
- uncertified adapter executed;
- state-changing dispatch after grant or approval revocation;
- raw credential or token detected in output or logs;
- external mutation without auditable execution evidence;
- adaptive allow/legacy deny mismatch in enforced cohort.

### High

- stale envelope accepted before provider dispatch;
- readback mismatch for high-impact capability;
- duplicate idempotency execution;
- relationship traversal escapes tenant scope;
- reconciliation lag exceeds security threshold;
- approval evidence binding mismatch.

### Medium

- adapter ambiguity;
- increased conditional or denial rate;
- controller retry growth;
- projection drift;
- certification approaching expiry;
- decision latency degradation.

### Low

- deprecated alias usage;
- compatibility wrapper usage;
- non-critical readback incomplete;
- stale dashboard projection.

## Operational states

```text
healthy
validating
degraded_dependency
degraded_contract
degraded_reconciliation
authorization_gated
blocked_ambiguous_authority
blocked_stale_authority
blocked_adapter_uncertified
execution_uncertain
manual_intervention_required
```

`recovered` is not an input state. It is an outcome that requires fresh validation evidence.

## Support runbooks

### Spike in authorization denies

1. identify capability and reason-code distribution;
2. compare policy, grant, relationship, and alias revisions;
3. check recent migrations and policy publication;
4. inspect shadow parity;
5. do not globally bypass policy;
6. rollback the relevant capability cohort or policy version when justified.

### Provider timeout with unknown effect

1. mark execution uncertain;
2. block blind retry;
3. run capability-specific readback;
4. classify no effect, desired effect, partial effect, or mismatch;
5. retry, compensate, or request manual intervention according to policy.

### Adapter certification revoked

1. block new dispatches;
2. invalidate affected ready envelopes;
3. identify in-flight executions;
4. complete readback for acknowledged operations;
5. evaluate fallback through a new decision;
6. preserve original evidence.

### Relationship or grant revocation

1. increment authority revision;
2. publish outbox event;
3. invalidate dependent queued envelopes;
4. reconcile projections;
5. verify no post-revocation dispatch occurred.

## Data retention

Retention classes should distinguish:

- immutable authorization and approval evidence;
- execution and verification evidence;
- bounded parity evidence;
- operational metrics;
- transient request normalization material;
- reconciliation checkpoints.

Retention policy must minimize sensitive data and preserve required compliance/audit evidence.

## Ownership

At minimum assign owners for:

- canonical capability registry;
- relationship authority;
- policy bundles;
- approval policies;
- enforcement kernel;
- each adapter family;
- evidence and reconciliation;
- API contracts;
- security review;
- production rollout and rollback.

An unowned critical surface blocks enforcement rollout.

## Dashboard model

Dashboards report independent dimensions, not one misleading readiness number:

```text
authority_ready
approval_ready
adapter_ready
connection_ready
execution_ready
verification_ready
reconciliation_current
```

Every projection includes observed time, source revision, and stale marker.
