# Threat Model

## Scope

This threat model covers authorization decisions, relationship resolution, grants, approvals, execution envelopes, adapter selection, credential resolution, provider dispatch, readback, reconciliation, and operational projections.

## Protected assets

- tenant and workspace isolation;
- resource ownership and authority paths;
- capability grants and policy decisions;
- approval integrity;
- execution envelopes and idempotency reservations;
- adapter certification and rollout configuration;
- credential references and provider bindings;
- execution and readback evidence;
- audit integrity and operator attribution.

## Trust boundaries

1. External caller to HTTP interface.
2. Interface to application authorization kernel.
3. Authorization kernel to relationship and grant repositories.
4. Application orchestration to execution workers or queues.
5. Enforcement point to adapter runtime.
6. Adapter runtime to provider API.
7. Provider response to readback verifier.
8. Reconciliation scheduler to internal registries and evidence stores.
9. Dashboard projections to source authority.

Data crossing each boundary is untrusted until validated.

## Primary threats

### Cross-tenant object access

An authenticated actor supplies another tenant, workspace, brand, connection, or resource identifier.

Mitigations:

- derive tenant scope from authenticated authority;
- tenant-scope repository queries by construction;
- perform object-level authorization after resource resolution;
- reject conflicting caller-supplied tenant context;
- test direct object reference substitution.

Residual risk: incorrect authority-source mapping during migration.

### Confused deputy

A service or adapter has broader provider credentials than the caller and accidentally performs an operation outside the caller's authority.

Mitigations:

- bind decisions and envelopes to subject, tenant, resource, and capability;
- resolve credentials only after authorization and adapter selection;
- pass scoped execution context to adapters;
- prohibit adapters from selecting their own tenant or credential scope;
- enforce at the final execution boundary.

### Approval laundering

An approval for one request is reused for another request, resource, adapter, or policy revision.

Mitigations:

- canonical request hashing;
- immutable approval decisions;
- bind approval to revision vector, adapter version, resource revision, nonce, and expiry;
- invalidate on any bound-evidence change;
- prohibit in-place renewal.

### Replay

An attacker or duplicate worker reuses a valid execution envelope.

Mitigations:

- short TTL;
- single-use state-changing envelopes;
- atomic dispatch reservation;
- nonce and idempotency key;
- consumed-state readback;
- conflict on idempotency-key reuse with a different request hash.

### Time-of-check/time-of-use

Authority is valid at decision time but revoked before provider dispatch.

Mitigations:

- revision vector on every decision;
- same-cycle freshness check at the enforcement point;
- invalidate queued work after grant, relationship, policy, adapter, or connection changes;
- bounded envelope TTL.

### Adapter substitution

A different adapter is used after approval, potentially with different side effects or credential scope.

Mitigations:

- bind approval and envelope to adapter key and version;
- enforce certification and rollout status at dispatch;
- require a new decision after adapter change;
- deterministic selection with ambiguity denial.

### Alias escalation

A route, skill, tool, UI action, or legacy key maps to a more powerful capability than intended.

Mitigations:

- versioned alias registry;
- one active canonical mapping per alias scope;
- ambiguity blocks resolution;
- alias changes require audit and shadow parity;
- discovery never grants authority.

### Policy injection or policy language escape

Untrusted data becomes executable policy or bypasses typed validation.

Mitigations:

- no dynamic code or unrestricted expression evaluation;
- typed fields and operators;
- schema validation, depth limits, and field allowlists;
- immutable versioned policy bundles;
- policy test fixtures and deny-precedence tests.

### Relationship graph abuse

Cycles, excessive traversal, unexpected inheritance, or cross-tenant edges produce unintended authority.

Mitigations:

- tenant-scoped tuples;
- cycle detection;
- bounded traversal depth and result count;
- relation-specific inheritance rules;
- revision evidence and path explanation;
- no generic transitive closure across relation types.

### Stale cache authorization

Cached grants, policies, or relationships remain valid after revocation.

Mitigations:

- cache keys include revision evidence;
- low TTL for authorization material;
- event invalidation plus periodic reconciliation;
- state-changing operations require fresh validation;
- explicit stale state rather than silent fallback.

### Idempotency collision or poisoning

A key is reused across subjects, tenants, capabilities, or different payloads.

Mitigations:

- scope idempotency records by tenant, subject, capability, resource, and request hash;
- reject same key with different hash;
- store bounded result references;
- expire reservations safely;
- use unique indexes and transactional reservation.

### Partial provider success

The provider applies a mutation but the client sees timeout or failure and retries.

Mitigations:

- provider-specific idempotency where available;
- pre-dispatch reservation;
- readback before retry;
- separate execution and verification states;
- compensation or manual-intervention state;
- bounded retry policy.

### Evidence forgery or audit rewriting

Execution evidence is overwritten or fabricated.

Mitigations:

- append-only evidence rows;
- source and payload hashes;
- immutable decision and approval records;
- actor and adapter attribution;
- reconciliation records corrections as new evidence, not mutation.

### Sensitive-data leakage

Credentials, tokens, prompts, unrestricted payloads, or cross-tenant identifiers appear in responses, logs, or evidence.

Mitigations:

- credential references only;
- strict response schemas;
- structured redaction;
- bounded previews and hashes;
- dedicated redaction tests;
- `sensitiveValuesIncluded=false` assertions.

### Dashboard authority inversion

Operational projections are treated as execution authority.

Mitigations:

- projections remain read-only derivatives;
- execution always calls the authority kernel;
- projection timestamps and source revisions are visible;
- stale projections are marked, never silently trusted.

### Break-glass abuse

Emergency paths become routine bypasses.

Mitigations:

- separate capability and approval policy;
- typed reason and short expiry;
- no self-approval unless explicitly authorized;
- mandatory audit and post-use review;
- narrow resource and operation scope;
- automatic revocation.

## Abuse-case acceptance tests

- substitute another tenant's resource ID;
- revoke a grant between decision and dispatch;
- change payload after approval;
- change adapter after approval;
- replay a consumed envelope;
- create equal-priority adapters;
- introduce a relationship cycle;
- reuse an idempotency key with a different request hash;
- force provider timeout after mutation;
- attempt to return a token through evidence;
- execute from a dashboard projection without a fresh decision;
- attempt break-glass execution after expiry.

## Security sign-off gate

Enforcement rollout is blocked until every primary threat has:

1. an implemented control;
2. a deterministic test;
3. an observable failure code;
4. an audit event;
5. a documented residual risk owner.
