# Authenticated Provider Consent Application Phase — Default-Off

## Phase objective

Complete the authenticated application boundary for personal-workspace, company-workspace, and brand provider-connection list, authorize, reconnect, and revoke operations without mounting a runtime route or contacting a live database or provider.

This is one cohesive default-off phase. It closes the application-orchestration gap left after the canonical provider authorization-state repository consolidation. It does not claim completion of callback execution, provider code exchange, credential replacement, migration application, or runtime rollout.

## Delivered application service

`createAuthenticatedProviderConsentUseCaseService` exposes four use cases:

- `list`;
- `authorize`;
- `reconnect`;
- `revoke`.

The service is exported from the Context Kernel application barrel but is not composed into `server.js`, Express routes, OpenAPI, workers, feature flags, or deployment manifests.

## Authority derivation

### Authenticated identity

- only `tenant_user` principals are accepted;
- `principalRef` and `userRef` are derived from `principalResolverService`;
- tenant scope is revalidated through the resolved principal and live membership evidence;
- caller-supplied `principalRef`, `userRef`, `effectiveUserRef`, `ownerUserRef`, `ownerScopeType`, or `ownerScopeRef` is rejected;
- exact workspace membership is required before workspace ownership, brand authority, connection reads, state issuance, or revocation.

### Personal workspace

- workspace ownership must be classified as `personal`;
- the authoritative workspace owner must equal the authenticated user;
- the derived owner scope is `personal_workspace` with the exact workspace reference;
- another user's personal connection cannot be listed, reconnected, or revoked.

### Company workspace

- workspace ownership must be classified as `company`;
- active membership in the exact workspace is required;
- list is available to an active workspace member;
- authorize, reconnect, and revoke require membership role `owner`, `admin`, or `manager`;
- the derived owner scope is `company_workspace` with the exact workspace reference.

### Brand

- brand operations require a company-owned workspace;
- `brandManagementAuthorityRepository.findBrandManagementAuthority` must return active authority for the exact tenant, workspace, brand, and authenticated principal;
- list requires `provider_connection.read` or `provider_connection.manage`;
- authorize, reconnect, and revoke require `provider_connection.manage`;
- the derived owner scope is `brand` with the exact brand reference.

## Governed readiness gate

Every use case calls `providerConsentReadinessRepository.findProviderConsentReadiness` before principal, workspace, brand, connection, state, or revocation access.

The phase proceeds only when the returned evidence has all of:

- `status=ready`;
- `migrationReadbackVerified=true`;
- `applicationUseCasesEnabled=true`.

Missing or blocked evidence returns `provider_consent_runtime_not_ready`. The current repository contains no runtime adapter that can produce enabled live readiness, so the phase remains default-off.

## List contract

- bounded `limit` from 1 to 100;
- opaque optional cursor passed only to the injected connection-access repository;
- exact tenant, workspace, owner-scope, and brand checks on every returned row;
- deterministic ordering by provider key and connection reference;
- allowlisted non-secret projection only;
- credential payloads, tokens, provider-account references, and provider-account binding hashes are not returned.

## Authorize contract

- provider key, requested scopes, and redirect target are accepted only after readiness and authority resolution;
- user, tenant authority, workspace ownership, brand authority, and owner scope are derived rather than trusted from caller input;
- the existing canonical `createProviderConsentService.issue` issues and persists signed authorization state;
- no provider call, credential lookup, credential read, or credential mutation occurs.

## Reconnect contract

The caller supplies only the target connection reference, requested scopes, and redirect target. The following are forbidden as caller authority:

- provider key;
- expected connection revision;
- authorization revision;
- provider-account reference;
- provider-account binding hash.

The application service reads the exact live connection ownership and derives:

- provider key;
- exact owner scope;
- target connection;
- expected connection revision;
- durable provider-account reference or binding hash.

These values are passed to the canonical signed-state service. A cross-tenant, cross-workspace, cross-user, cross-brand, inactive, revision-invalid, or binding-missing connection fails closed before state issuance.

## Revoke contract

- the exact connection is re-read through the ownership repository;
- exact tenant, workspace, brand, user, and owner-scope bindings are checked;
- the command receives the live expected connection revision rather than a caller revision;
- the revocation result must return `status=revoked` and a strictly advanced connection revision;
- invalid or non-advancing readback fails with `provider_consent_revoke_readback_invalid`;
- no credential payload is returned or materialized by the application service.

## New ports

The phase adds three explicit application ports:

1. `providerConsentReadiness`
   - `findProviderConsentReadiness`
2. `brandManagementAuthority`
   - `findBrandManagementAuthority`
3. `providerConnectionAccess`
   - `listProviderConnections`
   - `revokeProviderConnection`

No SQL adapter or runtime composition is added for these ports in this phase. They are contracts for separately governed persistence and route integration after migration readback.

## Regression coverage

`test-context-kernel-authenticated-provider-consent-use-cases.mjs` covers:

- readiness failure before principal or ownership access;
- rejection of caller-supplied identity and owner-scope authority;
- authenticated personal-workspace list;
- cross-user personal-owner rejection;
- company-workspace authorize with manager authority;
- company mutation denial for ordinary members;
- brand read and manage permission separation;
- exact brand authority binding;
- reconnect provider, revision, and provider-account binding derivation from the live connection;
- rejection of caller-supplied reconnect bindings;
- owner-scope mismatch rejection;
- revision-bound revoke command and revision-advancing readback;
- tenant-user-only enforcement;
- exact workspace membership enforcement;
- cross-brand list projection rejection;
- absence of provider calls, credential reads, credential payload output, and secrets.

The test is registered in `test-context-kernel-registry-adapters.mjs`, so the repository-wide Unit & Integration Tests execute the complete phase.

## Acceptance traceability

This phase provides direct application-contract evidence for:

- A-31 personal connection owner equals effective user;
- A-32 another member's personal connection is rejected;
- A-33 exact brand connection eligibility inputs;
- A-34 cross-brand and brand/workspace mismatch rejection;
- A-39 cross-tenant connection rejection before credentials;
- A-40 no-secret projections;
- A-49 authority validation before credential loading;
- A-51 reconnect context, revision, and provider-account binding derivation;
- A-53 migration-readback readiness blocking;
- A-62 durable provider-account binding use for reconnect.

Runtime acceptance scenarios A-42 through A-44, A-55, A-57, A-58, and A-63 still require callback/provider/credential integration and are not claimed by this application-only phase.

## Default-off evidence

- Express route added or changed: false;
- OpenAPI operation added: false;
- feature flag enabled: false;
- live readiness adapter added: false;
- SQL adapter added for the new ports: false;
- live database contacted: false;
- migration applied: false;
- provider called: false;
- credential payload read: false;
- credential mutated: false;
- deployment or Production promotion: false;
- secrets included: false.

## Remaining runtime phase

The next separately governed phase must implement:

- authoritative adapters for readiness, brand-management authority, connection listing, and revision-bound revocation;
- internal callback claim-token generation and non-exportable transport;
- provider code exchange only after atomic state claim;
- claimed-state worker-handoff resume;
- authorize-flow atomic connection creation and state consumption;
- reconnect-flow atomic credential replacement and state consumption;
- per-substep fault injection;
- runtime routes and OpenAPI only after migration ledger and same-cycle readback;
- production verification and post-merge audit.