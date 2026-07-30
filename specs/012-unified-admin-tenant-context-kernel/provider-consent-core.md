# Provider Consent Core — Default-Off Slice

## Purpose

This slice introduces the non-mounted core required for tenant-owned provider consent without modifying the existing ChatGPT OAuth login routes.

It keeps two OAuth concerns separate:

1. **Tenant GPT OAuth login** — authenticates a platform user into ChatGPT and remains implemented by `/auth/oauth/*`.
2. **Provider consent** — authorizes a personal workspace, company workspace, or brand to use an external provider connection.

The old callback-compatibility PRs #2345 and #2576 are not used as implementation bases. Their `chat.openai.com` to `chatgpt.com` callback canonicalization behavior is already present on `main`; they predate the current connection-ownership and atomic authorization-state contracts.

## Added boundaries

### Signed state codec

`createProviderConsentStateCodec`:

- signs a canonical JSON envelope with HMAC-SHA-256;
- includes an explicit signature version;
- rejects malformed, tampered, expired, future-issued, or overlong state;
- returns only an opaque serialized state and a SHA-256 signature binding;
- keeps the signing secret inside the codec closure;
- never logs or exports the secret.

### Provider consent state repository

`createProviderConsentStateRepository`:

- inserts only hashed nonce and signature evidence;
- stores no raw nonce, raw claim token, provider authorization code, or credential;
- supports `authorize` and `reconnect` state issuance;
- requires reconnect target, expected connection revision, and durable provider-account binding;
- rejects reconnect-only fields on new authorization;
- atomically changes exactly one row from `issued` to `claimed`;
- binds the claim CAS to tenant, state revision, nonce hash, signature hash, signature version, provider, principal, workspace, brand, owner scope, reconnect target, expected connection revision, and expected provider-account binding;
- performs same-cycle readback and requires persisted claim-verifier evidence;
- rejects a replay or concurrent loser with `oauth_state_claim_conflict`.

### Application service

`createProviderConsentService`:

- normalizes personal-workspace, company-workspace, and brand owner scopes;
- rejects fabricated or mismatched owner scopes;
- normalizes and deduplicates requested provider scopes;
- issues short-lived signed state through an injected codec;
- persists only nonce and signature hashes;
- accepts only an already-hashed internal claim verifier;
- performs no provider call, code exchange, credential lookup, credential materialization, or credential mutation;
- returns no raw claim token and no secret-bearing evidence.

## Runtime state

This slice is deliberately default-off:

- no Express route is added;
- no existing auth route is changed;
- no OpenAPI operation is added;
- no provider adapter is called;
- no credential is loaded or mutated;
- no feature flag is enabled;
- no migration is applied;
- no database is contacted by repository tests;
- no Production deployment or promotion is performed.

The application and repository exports are available for later separately governed route integration only after the connection-ownership migration is applied and same-cycle readback is verified.

## Migration dependency

Runtime use remains blocked until all of the following are true:

1. an approved live environment is selected and its database identity is verified;
2. the checksum-bound migration preflight passes against that environment;
3. separate migration authorization and capability-envelope bindings exist;
4. typed confirmation authorizes the exact checksum and statement count;
5. the migration is applied by the governed runner;
6. ledger and schema readback complete in the same cycle;
7. provider-consent runtime integration passes isolation, replay, expiry, callback-resume, and no-secret gates.

The bound migration remains:

- file: `20260730_context_kernel_connection_ownership_persistence.sql`;
- checksum: `8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf`;
- statement count: `4`;
- status: not applied.

## Test contract

The focused command is:

```text
npm run test:context-kernel:provider-consent
```

The same test remains registered through `test-context-kernel-registry-adapters.mjs`, so the repository-wide Unit & Integration Tests execute it without relying on the focused command.

The registered coverage includes:

- HMAC issue and verification;
- signature tamper rejection;
- expiry rejection;
- personal owner-scope mismatch rejection;
- reconnect binding requirements;
- nonce and signature hashing before persistence;
- requested-scope normalization;
- exact SQL claim bindings;
- single-winner claim semantics;
- sequential replay rejection;
- absence of provider calls, credential reads, credential mutation, secrets, and raw claim-token output.

The repository-owned generated-artifact workflow regenerated and verified the bounded frontend dispatch evidence after the focused command was registered. The bounded write set contained only governed generated evidence; no runtime or OpenAPI surface was introduced by the generator.

## Canonical repository consolidation gate

The repository already contains `createProviderAuthorizationStateRepository`, which owns claimed-state readback and atomic reconnect completion. This default-off slice adds a stricter issuance and ingress-claim adapter over the same persistence aggregate so the signed nonce, signature, owner scope, reconnect revision, and provider-account binding can participate in the claim CAS.

That temporary split is not runtime authority. Before any route, provider adapter, worker callback, or feature flag can use this slice, a separate governed implementation must:

1. consolidate issuance, signed-context claim, claimed-state resume, and atomic completion behind one canonical authorization-state repository port;
2. remove or make unreachable every weaker alternate claim path;
3. retain the full signed-context CAS and reconnect completion transaction guarantees;
4. update all repository tests and consumers to the single canonical authority;
5. prove no duplicate SQL claim implementation remains reachable from runtime composition.

Until those conditions and migration readback are complete, this slice must remain unmounted and default-off.

## Remaining work

This slice does not complete Phase 5. Remaining provider-consent work includes:

- canonical authorization-state repository consolidation described above;
- authenticated personal, company-workspace, and brand list/authorize/reconnect/revoke use cases;
- live membership and brand-management authority checks;
- an internal callback adapter that generates and transports the raw claim token without logging or exporting it;
- provider code exchange after successful atomic claim;
- safe worker-handoff resume using the persisted claim verifier;
- authorize-flow atomic connection creation and state consumption;
- reconnect-flow integration with the existing atomic credential-replacement repository;
- runtime routes and OpenAPI only after migration readback;
- fault injection and production post-merge audit.
