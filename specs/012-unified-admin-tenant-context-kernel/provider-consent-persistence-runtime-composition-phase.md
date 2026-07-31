# Provider Consent Persistence and Runtime Composition — Default-Off Phase

## Phase objective

Complete the next cohesive Spec 012 provider-consent phase behind the existing authenticated use-case boundary and the single canonical provider-authorization-state port.

This phase is intentionally unmounted and default-off. It adds production-shaped repository and callback composition contracts without applying the ownership migration, enabling routes, calling a provider, or mutating credentials in a live environment.

## Delivered runtime repositories

### Provider-consent readiness

The readiness repository combines two independent requirements:

1. live schema inspection for the exact ownership and authorization-state artifacts;
2. an externally governed enablement readback bound to the approved migration resource URI and SHA-256 checksum.

Readiness is returned as `ready` only when:

- `connection_ownership_scopes` exists;
- `provider_authorization_states` exists;
- `v_context_kernel_connection_ownership_compatibility` exists;
- all three workspace ownership columns exist;
- the migration checksum matches the approved identity;
- same-cycle migration readback is verified;
- application use cases are explicitly enabled.

Missing enablement, checksum mismatch, missing schema, or ambiguous evidence remains blocked.

### Brand-management authority

Brand authority is adapted from the canonical authority resolver. The adapter:

- accepts only an exact Tenant, Workspace, Brand, and principal tuple;
- rejects any context substitution;
- projects only `provider_connection.read` and `provider_connection.manage`;
- never derives authority from Brand existence, provider type, Workspace role, or connection ownership;
- returns no grant payload, credential, or secret-bearing evidence.

### Provider connection access

The SQL repository provides:

- stable keyset pagination by `provider_key + connection_id`;
- exact Tenant, Workspace, owner-scope, and Brand filtering;
- classified ownership only;
- no-secret connection projections;
- transactional revision-bound revoke;
- same-cycle readback requiring `revoked` and `connection_revision + 1`.

Revocation does not delete credential history or silently select another connection.

## Canonical authorization completion

`createProviderAuthorizationRuntimeRepository` preserves one public provider-authorization-state repository object.

- issue, find, and claim delegate to the existing canonical repository;
- reconnect completion delegates to the existing guarded atomic reconnect implementation;
- authorize completion locks the exact claimed state and atomically creates:
  - one encrypted user connection;
  - one Workspace link;
  - one hierarchical ownership record;
  - one consumed authorization state;
- exact ownership compatibility readback is required before commit;
- any insert, revision, ownership, state, or readback failure rolls back the whole transaction.

No plaintext provider credential is accepted by this repository. It accepts only the encrypted credential envelope produced by the credential boundary.

## Callback claim and worker handoff

The callback runtime coordinator has two explicit stages.

### Claim stage

1. Verify and atomically claim the signed authorization state through the provider-consent service.
2. Read back the claimed state and verifier revision.
3. Generate a one-time claim token.
4. Persist the claim token and provider authorization code only inside an expiring one-time handoff store.
5. Return only the handoff reference and bounded no-secret status.

No provider exchange occurs during claim.

### Resume stage

1. Atomically consume the handoff reference.
2. Re-read the exact claimed state.
3. Resolve the provider exchange adapter by the claimed provider key.
4. Exchange the code only after claim and same-cycle readback.
5. Seal the provider result through the credential-envelope boundary.
6. Enforce the signed reconnect provider-account binding when reconnecting.
7. Complete authorize or reconnect atomically through the canonical repository facade.
8. Return a bounded no-secret completion projection.

A missing, expired, replayed, or already-consumed handoff fails closed before provider exchange.

## Regression coverage

The registered regression covers:

- schema and checksum readiness;
- default-off enablement behavior;
- Brand authority context isolation and permission projection;
- stable connection-list cursor behavior;
- transactional revision-bound revoke and readback;
- atomic authorize connection/link/ownership/state completion ordering;
- claim-before-provider-exchange ordering;
- one-time worker handoff replay rejection;
- credential-envelope sealing before persistence;
- no authorization code or raw token in completion results.

## Safety state

- migration applied: false;
- live database contacted by this delivery process: false;
- provider called by this delivery process: false;
- credential payload read by application projections: false;
- credential mutated in a live environment: false;
- route mounted: false;
- OpenAPI operation added: false;
- feature flag enabled: false;
- deployment performed: false;
- Production synchronized: false;
- runtime authority granted: false;
- secrets included in evidence: false.

## Remaining activation boundary

Runtime mounting remains separately blocked by:

1. governed migration apply authorization;
2. approved environment identity;
3. exact checksum and statement-count verification;
4. same-cycle schema and ledger readback;
5. provider adapter certification;
6. credential-envelope implementation certification;
7. durable one-time handoff store certification;
8. fault injection against provider timeout, worker restart, transaction rollback, and stale state;
9. route/OpenAPI security review;
10. controlled non-Production pilot and rollback evidence.
