# Provider Consent Activation Certification — Default-Off Pilot

## Objective

Certify the recovery, adapter, credential-boundary, scope, metadata, and revocation contracts required before Provider Consent can be composed in a non-Production pilot.

This phase remains unmounted and default-off. It does not apply the ownership migration, expose a route, exchange a live authorization code, mutate a live credential, deploy an application, or synchronize Production.

## Certified durable handoff boundary

The pilot accepts a handoff adapter only when its certification explicitly proves:

- atomic create;
- lease compare-and-set;
- checkpoint compare-and-set;
- one-time terminal completion;
- expiry enforcement;
- encrypted payload persistence.

The adapter seals the authorization code, claim verifier, state context, provider-result checkpoint, and completion checkpoint through a purpose-bound payload cipher. Public projections never include those values.

## Recovery state machine

The callback worker progresses through durable stages:

1. `claimed_handoff_ready`
2. leased claimed state
3. `provider_completed` checkpoint
4. atomic authorization persistence
5. `persistence_completed` checkpoint
6. one-time terminal completion

A worker crash after provider exchange resumes from the credential checkpoint and does not repeat the provider call. A crash after persistence resumes from the completion checkpoint and does not repeat the database completion. Replay after terminal completion fails closed.

Retryable failures release the lease with a bounded retry time. Non-retryable failures mark the handoff unavailable for further execution. Lease, checkpoint, and terminal writes are all exact-CAS operations.

## Provider exchange certification

A provider exchange adapter is usable by the pilot only when certification proves:

- exact provider-key binding;
- idempotency-key support;
- a bounded timeout between 1 and 60 seconds;
- certified status and version identity.

The idempotency key is derived from the signed state reference and claim revision. Provider exchange occurs only after atomic claim and claimed-state readback.

## Credential-envelope certification

The credential adapter must certify:

- AES-256-GCM envelope semantics;
- exclusion of secrets from application projections;
- a named safe-metadata policy version.

The pilot requires a durable provider-account reference or binding hash. It rejects provider mismatch, reconnect account substitution, oversized encrypted envelopes, and forbidden secret-bearing metadata.

Only allowlisted scalar metadata is retained:

- account ID;
- display name;
- email;
- domain;
- avatar URL;
- organization ID.

Nested or unknown metadata is not persisted. Keys resembling tokens, credentials, secrets, passwords, authorization headers, or API keys are rejected.

## Granted-scope enforcement

Every scope embedded in the signed authorization state must be present in the provider-granted scope set. Missing scopes fail before credential persistence. Extra scopes remain observable only inside the certified envelope boundary and are not treated as authority.

## Revocation consistency

The certified revocation repository locks both:

- the exact `connection_ownership_scopes` row;
- the matching `user_app_connections` row.

Inside one transaction it verifies Tenant, Workspace, owner scope, Brand, provider key, active status, and expected connection revision. It then revokes both records and requires same-cycle readback proving:

- ownership status is `revoked`;
- base connection status is `revoked`;
- connection revision advanced exactly once;
- provider identity remained consistent.

Any mismatch rolls back the complete transaction.

## Fault-injection coverage

The registered regression covers:

- missing handoff certification capabilities;
- encrypted no-secret handoff projections;
- crash after provider checkpoint;
- crash after persistence checkpoint;
- provider call non-repetition after recovery;
- persistence non-repetition after recovery;
- terminal replay rejection;
- requested-versus-granted scope mismatch;
- secret-bearing metadata rejection;
- atomic ownership/base-connection revocation and dual readback.

## Safety state

- migration applied: false;
- live database contacted by this delivery process: false;
- live database mutated: false;
- provider called by this delivery process: false;
- live authorization code exchanged: false;
- credential payload read outside the certified boundary: false;
- live credential mutated: false;
- route mounted: false;
- OpenAPI operation added: false;
- feature flag enabled: false;
- deployment performed: false;
- Production synchronized or promoted: false;
- runtime authority granted: false;
- secrets included in evidence: false.

## Remaining activation blockers

This phase does not authorize activation. A later governed wave must still provide:

1. explicit authorization to apply `20260730_context_kernel_connection_ownership_persistence.sql`;
2. exact migration checksum, statement-count, ledger, schema, and same-cycle readback evidence;
3. a real durable handoff implementation with independent certification evidence;
4. a real provider exchange adapter with timeout, retry, idempotency, identity, and rate-limit evidence;
5. a real credential-envelope adapter with key-management and rotation evidence;
6. controlled non-Production execution using non-sensitive test accounts;
7. rollback and unknown-outcome reconciliation evidence;
8. route and OpenAPI security review;
9. Production readiness and post-promotion verification.

Until every blocker is satisfied, the pilot contracts remain default-off and unmounted.
