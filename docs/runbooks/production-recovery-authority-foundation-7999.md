# Production Recovery authority foundation — #7999

## Scope

This source-only canary slice adds the server-side authority primitives that can be safely constructed before Production mutation authority exists:

- Ed25519 execution-ticket signer/verifier;
- deterministic server-side approval material derived from a deployment-owned secret;
- durable approval challenge references backed by the independent Recovery Control Store;
- server-side approved-execution material resolution without returning an approval token to the caller;
- the existing durable Recovery Store and fenced lock with exact execution-ticket verifier identity;
- the existing server-managed Production deployment identity wrapper.

The foundation deliberately does **not** provide or fake the remaining consequential authorities:

- mutation executor;
- Hostinger host-local mutation executor;
- independent role-aware same-cycle readback verifier;
- immutable partial-receipt store;
- durable role-selection proof resolver;
- Governance Migration Ledger finalizer.

Therefore this slice does not create a valid `production_live` graph and does not change runtime configuration.

## Safety

Construction performs no database connection, provider call, workflow dispatch, deployment, migration, grant, or Production mutation. The Recovery Control Store factory is injected and must retain the exact execution-ticket verifier object created by this foundation.

Approval tokens are not persisted. A server-owned HMAC secret deterministically derives the approval material from the immutable challenge binding only after the exact approval is resolved server-side. Execution tickets use Ed25519 and the signature covers the canonical ticket hash produced by the existing Recovery ticket contract.

No private key, approval secret, token, database identifier, credential, or module configuration is committed by this slice.

## Remaining #7999 canary work

A subsequent reviewed slice must provide the six deferred components through deployment-owned authorities and then create the concrete server-managed binding module. It must keep `production_live` disabled until fresh signed Staging Phase B evidence, exact Production deployment attestation, complete live-authority readiness, and separate activation authorization are all present.

This PR is not execution authority for #6813 reconstruction and does not authorize the already-recorded Production baseline rebuild confirmation.
