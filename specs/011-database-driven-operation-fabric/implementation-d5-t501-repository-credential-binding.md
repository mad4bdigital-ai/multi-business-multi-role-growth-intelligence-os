# D5 T501 Implementation — Short-Lived Repository Credential Binding

## Purpose

Bind a managed Git worker to a repository credential for a short, bounded lifetime without persisting, serializing, logging, or returning credential material. T501 resolves and contains credential authority only; remote Git transport remains T502.

## Resolution authority

The binding module reuses `credentialResolver.js` as the primary authority. It can resolve an explicit connection, credential binding, Tenant or user-owned connection, or permitted platform-owned secret reference. No action key is invented: optional action and target keys must be supplied by registry/bootstrap authority when a more specific binding is required.

When the primary resolver reports no binding, an installation token from `githubAppAuth.js` may be used only when the caller has already authorized platform fallback. The module does not silently widen fallback policy.

## Lifetime and scope

Bindings are scoped to one worker ID and one owner/repository pair. The requested lifetime must be between 30 and 900 seconds. A provider expiry can shorten, but never extend, that lifetime.

Every credential use revalidates:

- worker ID;
- repository owner and name;
- release state;
- expiry.

## Secret containment

The resolved secret is copied into a `Buffer` held by a non-enumerable symbol on an in-memory handle. Safe metadata includes source, ownership, issuance, expiry, and TTL, but never the secret or a derived identifier.

Credential use occurs through a callback that receives a temporary `Buffer` copy. The copy is zeroed in a `finally` block. Release zeroes the retained buffer and is idempotent. No credential file is created, and all evidence explicitly reports `credential_secret_exposed=false`, `persistent_credential_file_created=false`, and `secrets_included=false`.

## Safe evidence

The handle exposes only:

- credential binding ID;
- worker and repository scope;
- provider family and credential role;
- credential source and owner type;
- source binding, connection, or installation IDs where available;
- issued and expiry timestamps;
- effective TTL;
- whether credential material was read;
- whether a provider token request was required.

## Scope boundaries

T501 adds an in-memory binding module, offline tests, and documentation only in its first commit. It performs no SQL write, creates no public route, writes no credential file, executes no clone/fetch/checkout/commit/push, performs no implementation-time token request, deploys nothing, merges nothing, and changes no runtime activation. Lifecycle and orchestrator integration follow as separate commits within T501.
