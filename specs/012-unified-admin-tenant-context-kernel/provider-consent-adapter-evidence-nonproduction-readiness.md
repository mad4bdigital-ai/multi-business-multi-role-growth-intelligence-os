# Provider Consent Adapter Evidence and Non-Production Readiness — Default-Off

## Objective

Deliver concrete, testable adapter contracts and evidence composition for Provider Consent without activating the runtime, applying a migration, contacting a live provider, reading a live credential, mounting a route, changing OpenAPI, deploying, or synchronizing Production.

This phase converts the preceding activation-certification contracts into evidence-producing non-Production implementations while preserving every activation blocker.

## Delivered layers

### 1. Durable SQL handoff store contract

`createSqlProviderConsentHandoffStore` provides an exact compare-and-set storage contract for:

- atomic insert of one handoff reference;
- lease acquisition only from `ready` or `retryable` state;
- expiry and maximum-attempt enforcement;
- exact lease readback;
- provider and persistence checkpoint CAS;
- retryable or terminal release CAS;
- one-time completion only after a completion checkpoint exists;
- status-only reconciliation readback with no sealed payload projection.

The adapter accepts only explicitly non-Production environments. It does not create the table, apply schema, open a database connection by itself, or register itself in runtime composition.

The required storage shape is represented by the adapter statements and includes:

- `handoff_ref` unique identity;
- lifecycle `status` and `stage`;
- `expires_at`, `max_attempts`, and `attempt_count`;
- `lease_ref` and `lease_expires_at`;
- sealed handoff payload;
- sealed provider checkpoint;
- sealed completion checkpoint;
- retry time and safe error code;
- certification version identity;
- created, updated, and completed timestamps.

A future schema implementation must bind an independently computed SHA-256 schema digest into the adapter certification. This phase does not create or apply that schema.

### 2. Provider exchange simulation adapter

`createNonProductionProviderExchangeAdapter` provides a provider-bound simulation surface with:

- exact `providerKey` binding;
- explicit `simulationOnly` transport context;
- mandatory idempotency key;
- bounded certified timeout;
- retry classification for rate limits and transient transport failures;
- no provider payloads in public errors;
- certification identity and transport identity;
- explicit `liveProviderCalled: false` evidence.

The adapter rejects Production construction. It does not contain a provider endpoint, client secret, credential, authorization header, or live transport registration.

### 3. AES-256-GCM credential envelope

`createAes256GcmProviderCredentialEnvelopeService` provides a concrete credential-sealing boundary for non-sensitive simulation evidence:

- 32-byte key resolution through an injected key resolver;
- 12-byte IV;
- AES-256-GCM encryption and authentication tag;
- context-bound additional authenticated data containing Provider, Tenant, Workspace, Brand, and owner scope;
- envelope key reference and key version identity;
- SHA-256 provider-account binding;
- safe scalar account metadata only;
- sorted granted scopes;
- no raw credential projection.

The public service exposes sealing only. Envelope opening is retained under a `_testing` surface for contract verification and is not exported through the infrastructure barrel.

The service rejects Production construction and does not access a live key manager in this delivery process.

### 4. Adapter evidence and readiness service

`createProviderConsentAdapterEvidenceService` certifies four evidence families:

- durable handoff capabilities and schema identity;
- provider exchange simulation and retry/idempotency identity;
- credential envelope encryption, rotation, metadata, and binding identity;
- migration plan identity while remaining `planned_not_applied`.

A readiness result is emitted only for `test`, `development`, `staging`, or `non_production`. It remains blocked or rejects evaluation when any activation surface is enabled.

A successful result means only:

`ready_for_controlled_non_production_pilot`

It explicitly does not authorize:

- migration application;
- database mutation;
- public route or OpenAPI exposure;
- runtime authority;
- live provider exchange;
- live credential access or mutation;
- deployment;
- Production promotion or synchronization.

The result includes a stable SHA-256 digest over the normalized evidence pack and contains no secrets.

### 5. Provider Consent unknown-outcome reconciliation

`createProviderConsentUnknownOutcomeReconciliationService` performs readback-only classification across durable handoff status and canonical authorization state.

Supported outcomes are:

- `confirmed_applied`;
- `confirmed_not_applied`;
- `still_unknown`;
- `conflict`.

Covered scenarios include:

- completion checkpoint plus consumed state;
- consumed state with a missing terminal handoff marker;
- provider checkpoint with claimed state;
- leased state awaiting lease expiry;
- claimed state before provider checkpoint;
- terminal authorization state without checkpoints;
- contradictory completion and claimed state;
- unsupported handoff state.

Every result proves:

- automatic retry is forbidden;
- no provider call is repeated;
- no credential payload is read;
- no secret is included.

## Migration identity retained without application

The readiness contract retains the previously governed migration identity:

- file: `20260730_context_kernel_connection_ownership_persistence.sql`;
- SHA-256: `8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf`;
- expected statements: `4`;
- typed confirmation: `APPLY_20260730_CONTEXT_KERNEL_CONNECTION_OWNERSHIP_PERSISTENCE`;
- resource: `db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql`.

This phase does not provide that typed confirmation, select a live environment, run a dry-run, create an authorization envelope, apply SQL, or perform readback.

## Registered regression coverage

The Context Kernel registry aggregate now executes:

- `test-context-kernel-provider-consent-adapter-evidence-nonprod-readiness.mjs`;
- `test-context-kernel-provider-consent-unknown-outcome-reconciliation.mjs`.

The tests cover:

- SQL lifecycle operations and exact CAS results;
- status-only readback;
- Production construction rejection;
- provider-bound simulation and idempotency context;
- encryption with deterministic non-sensitive test key and IV;
- absence of plaintext credentials from the envelope projection;
- authenticated envelope opening under the testing-only helper;
- readiness evidence digest and default-off output;
- Production readiness rejection;
- applied, not-applied, still-unknown, and conflict reconciliation;
- unsupported handoff status rejection;
- no automatic retry.

## Safety state

- migration applied: false
- live database contacted by this delivery process: false
- database mutated: false
- live provider called: false
- live authorization code exchanged: false
- live credential read: false
- live credential mutated: false
- live key manager contacted: false
- route mounted: false
- OpenAPI operation added: false
- feature flag enabled: false
- runtime authority granted: false
- deployment performed: false
- Production synchronized: false
- secrets included in evidence: false

## Remaining blockers before a controlled non-Production pilot

1. independently reviewed handoff table schema and schema digest;
2. governed creation of the handoff schema in an explicitly selected non-Production environment;
3. certified non-Production key resolver backed by an approved key-management system;
4. provider-specific simulation scenarios for each supported provider family;
5. same-cycle evidence for lease expiry, provider timeout, rate limit, worker restart, and post-commit response loss;
6. exact migration authorization and readback, performed separately;
7. runtime composition behind a default-off environment gate;
8. route and OpenAPI security review before any external surface exists;
9. explicit Production readiness and promotion authorization.

## Next cohesive phase boundary

The next phase is **Provider Consent Controlled Non-Production Composition — Still Default-Off**.

It may compose the certified adapters only after non-Production schema and key-resolution evidence exist. It must retain no public route, no Production configuration, no live user credential, no automatic retry, and no migration application without separate governed authorization.
