# Threat Model

## Assets

- tenant isolation;
- authenticated principal identity;
- effective subject selection;
- resource and connection authority;
- credentials and provider accounts;
- execution plans and approvals;
- audit and reconciliation evidence.

## Threats and mitigations

### Cross-tenant candidate leakage

Threat: Admin or multi-tenant user resolution includes unrelated tenant resources in execution ranking.

Mitigations:

- separate visibility, candidate, and execution sets;
- tenant predicate on every graph and connection query;
- release-blocking isolation tests;
- safe projection that hides unrelated tenant metadata.

### Implicit Admin impersonation

Threat: Admin session executes as a tenant user without explicit subject binding.

Mitigations:

- mandatory effective subject for tenant mutations;
- typed approval for delegated or elevated actions;
- audit principal and effective subject separately.

### Label collision and confused deputy

Threat: similar workspace, brand, or resource labels cause the runtime to target the wrong customer.

Mitigations:

- labels never grant authority;
- explicit stable references and exact resource bindings;
- ambiguity blocks execution.

### Stale context reuse

Threat: a pin remains active after membership, authority, or resource changes.

Mitigations:

- registry revisions in context hashes;
- short expiry for high-risk contexts;
- revalidation before approval and dispatch.

### Connection substitution

Threat: unavailable connection causes silent fallback to another credential source.

Mitigations:

- exact connection binding;
- fallback prohibition for high-risk operations;
- new plan and approval required for source changes.

### Replay and duplicate execution

Threat: retries duplicate provider mutations.

Mitigations:

- idempotency keys;
- plan and context binding;
- execution ledger and provider readback;
- unknown-outcome reconciliation before retry.

### Hardcoded customer routing

Threat: source code routes requests to a fixed tenant, brand, or account.

Mitigations:

- CI scanners;
- architecture boundaries;
- registry-backed adapters;
- synthetic-only fixtures.

### Information exposure

Threat: customer response reveals SQL internals, secrets, raw provider failures, or other tenant resources.

Mitigations:

- structured external error catalog;
- redaction at infrastructure boundaries;
- customer-safe projection tests;
- no credential payloads in context objects.

### TOCTOU during repository operations

Threat: default branch or branch head changes between planning and mutation.

Mitigations:

- minimal branch bootstrap;
- exact expected branch SHA for continuation;
- overlap detection;
- no-force updates;
- same-cycle readback.
