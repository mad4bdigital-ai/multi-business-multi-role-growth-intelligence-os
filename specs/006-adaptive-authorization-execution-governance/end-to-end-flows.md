# End-to-End Governance Flows

## Purpose

Describe the expected control flow for read, approval-gated internal write, external high-impact mutation, revocation, timeout, and reconciliation scenarios.

## Flow 1 — Read capability without approval

Example: `activation.skills.read`.

```text
Client
  -> API validates authentication and request
  -> CapabilityResolver resolves canonical capability
  -> RelationshipAuthority resolves tenant/workspace scope
  -> GrantEvaluator reads effective grants
  -> PolicyEvaluator returns allow
  -> AdapterResolver selects internal read adapter
  -> AuthorizationDecision is recorded
  -> API or application read path executes through PEP
  -> Response projection includes source revisions and observedAt
```

Required properties:

- no provider mutation;
- active approval-gated grants remain counted as active;
- display state does not become authority;
- tenant and admin/global visibility rules are explicit;
- stale projection is marked.

## Flow 2 — Internal write requiring approval

Example: `platform.output-artifact.write`.

```text
Client
  -> decision request
  -> decision returns conditional with require_approval and require_idempotency
  -> envelope created in ready_requires_approval
  -> approval request created
  -> authorized approver submits typed confirmation
  -> append-only approval decision created
  -> envelope transitions to ready_for_dispatch
  -> execution request reserves envelope and idempotency identity atomically
  -> internal adapter writes artifact row
  -> execution evidence records row ID hash and content hash
  -> readback verifies row and expected hash
  -> execution succeeds and verification becomes verified
```

Any payload, policy, adapter, resource, or authority change before dispatch makes the approval/envelope stale.

## Flow 3 — External high-impact publish

Example: `content.wordpress.publish`.

```text
Client
  -> API validation and authentication
  -> canonical capability resolution
  -> brand and CMS-site relationship authority
  -> active grant evaluation
  -> publish policy evaluates requested status and risk
  -> certified adapter candidates resolved
  -> decision returns conditional with obligations
  -> execution envelope binds request hash, site resource, policy, relationships, grant, adapter, and expiry
  -> per-request approval binds the same evidence
  -> PEP revalidates all revisions immediately before dispatch
  -> dispatch reservation and idempotency identity are created
  -> adapter preflight validates scoped connection and provider contract
  -> adapter performs provider request
  -> provider acknowledgement evidence is stored
  -> readback fetches the created or updated post
  -> expected title/content/status hash is compared
  -> effect verification confirms public visibility when requested
```

Operational success requires the policy-defined verification level, not merely HTTP 201.

## Flow 4 — Grant revoked after decision

```text
decision issued with grant revision 482
-> grant revoked, revision becomes 483
-> outbox emits grant.changed
-> queued envelope still references 482
-> PEP compares revisions before dispatch
-> envelope becomes stale
-> dispatch returns GRANT_AUTHORITY_STALE or ENVELOPE_STALE
-> reconciler invalidates remaining dependent envelopes
-> projection counts update
```

No new provider request is allowed.

## Flow 5 — Approval payload changed

```text
request A hash = H1
-> approval decision binds H1
-> caller changes body to request B hash = H2
-> execution request presents envelope for H1
-> PEP calculates H2 and compares
-> REQUEST_HASH_MISMATCH
-> approval and envelope cannot be reused
-> new decision and approval are required
```

## Flow 6 — Two workers race to dispatch

```text
worker A -> reserve envelope version 7
worker B -> reserve envelope version 7
```

Exactly one atomic compare-and-set succeeds.

Winner:

```text
state = dispatch_reserved
reservation_id = A
row_version = 8
```

Loser receives `ENVELOPE_RESERVATION_CONFLICT` and does not call the adapter.

## Flow 7 — Provider timeout with unknown effect

```text
adapter sends provider request
-> network timeout occurs after possible provider acceptance
-> execution state becomes uncertain
-> retry is blocked
-> ExecutionReadbackReconciler queries provider by idempotency identity or resource evidence
```

Outcomes:

### Desired state found

Record acknowledgement/readback evidence and mark verified success.

### No effect found

Retry may occur with the same idempotency identity if capability and provider policy permit.

### Partial or conflicting effect found

Mark mismatch and require compensation or manual intervention.

### Readback unavailable

Remain `execution_uncertain` and retry bounded readback. Do not claim failure or success without evidence.

## Flow 8 — Adapter certification revoked

```text
adapter certification changes certified -> revoked
-> adapter registry revision increments
-> adapter.certification.changed event emitted
-> ready envelopes referencing the adapter become stale
-> in-flight acknowledged executions continue to readback
-> new decisions exclude the adapter
-> fallback is evaluated through a new decision
```

Fallback is never silently substituted into an existing approval.

## Flow 9 — Ambiguous adapter candidates

```text
candidate A priority 100 certified active
candidate B priority 100 certified active
no approved tie-breaker
```

Result:

```text
decision = deny
binding = ambiguous
error = ADAPTER_BINDING_AMBIGUOUS
```

Operators resolve the registry ambiguity. Runtime does not select by insertion order.

## Flow 10 — Relationship graph cycle

```text
workspace A contains workspace B
workspace B contains workspace A
```

Resolver detects a cycle, stops bounded traversal, records safe internal evidence, and returns `RELATIONSHIP_GRAPH_AMBIGUOUS` or a more specific cycle error. It does not infer authority from the cycle.

## Flow 11 — Projection reconciliation

```text
source grants and approval policies change
-> dashboard projection still reports prior counts
-> ProjectionReconciler reads source revisions
-> detects projection revision mismatch
-> rebuilds counts
-> writes observedAt and sourceRevision
-> dashboard becomes current
```

Execution authorization is unaffected because it never uses the projection as authority.

## Flow 12 — Break-glass operation

```text
operator requests break-glass decision
-> policy validates eligible role and resource
-> typed reason and bounded scope required
-> separate approver required unless explicit policy permits otherwise
-> short-lived single-use envelope issued
-> PEP performs full freshness validation
-> execution and readback occur
-> automatic expiry and post-use audit created
```

Break-glass does not bypass tenant isolation, evidence, idempotency, adapter certification, or readback.

## Flow 13 — Legacy compatibility wrapper

```text
legacy route receives request
-> wrapper resolves canonical capability alias
-> adaptive decision runs in shadow
-> legacy enforcement remains authoritative during shadow phase
-> parity evidence records bounded comparison
-> legacy response contract remains unchanged
```

After approved cutover for a cohort:

```text
legacy route
-> same wrapper
-> adaptive enforcement becomes authoritative
-> response remains backward compatible
-> rollback feature flag can restore legacy enforcement for that capability cohort
```

## Flow 14 — Reconciliation recovery

```text
readback mismatch detected
-> reconciliation controller acquires scoped lease
-> reloads current authority and resource state
-> performs bounded corrective action when authorized
-> reads resource again
-> appends recovery evidence
```

The controller reports `recovered` only when fresh readback matches required state and no blocking gaps remain.

## Sequence integrity rules

- no approval before a bindable decision or envelope exists;
- no dispatch before approval obligations are satisfied;
- no provider call before atomic reservation;
- no blind retry after an uncertain external effect;
- no verified-success claim before required readback;
- no fallback adapter without a new decision;
- no recovery claim without new evidence;
- no projection used as execution authority.
