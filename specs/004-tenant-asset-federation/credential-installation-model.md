# Credential, Connection, and Installation Model

## 1. Separation of concerns

Shared assets describe what an app, plugin, action, tool, or workflow can do. They never contain tenant credentials.

Runtime readiness is a separate chain:

```text
shared asset visibility
→ contextual authority
→ exact action/endpoint grant
→ connection selection
→ credential eligibility
→ installation validation
→ certification
→ quota/budget
→ approval if required
→ dispatch
```

A failure at any stage must be visible and typed.

## 2. Credential ownership

Supported ownership scopes:

- platform-managed credentials where entitlement and integration mode allow;
- tenant-owned credentials;
- workspace-scoped credentials;
- brand-scoped credentials;
- user-owned credentials for user-specific integrations;
- connection-owned secret references.

Credentials remain in existing vault/secret/connection authorities. Neither shared assets, variants, preferences, composition profiles, nor manifests store secret values.

## 3. Integration modes

A tenant may select:

- `managed` — platform-managed connection where policy and entitlement permit;
- `dedicated` — tenant/user supplies credentials and owns the connection;
- `hybrid` — per-app source policy chooses managed or dedicated.

Integration mode is not an execution grant. It selects eligible connection sources only.

## 4. Connection selection

Connection resolution follows these rules:

1. principal and tenant must match;
2. connection must support the requested shared asset/action;
3. exact workspace/brand/activity/user scope must be honored;
4. revoked, expired, error, or unauthorized connections are excluded;
5. the most specific valid binding is selected;
6. equal-ranked valid connections produce `connection_binding_ambiguous`;
7. credential material is not read during catalog, preview, composition, or variant resolution.

User preference may rank equally authorized and equally ready connections but cannot choose an ineligible connection.

## 5. Installation evidence

A registry record saying `active` is not operational installation evidence.

An installation becomes active only after same-cycle validation confirms:

- connection identity;
- credential metadata and required scopes;
- provider or connector reachability where the validation policy permits;
- required app/plugin/action bindings;
- tenant ownership;
- expiry and revocation state;
- no secret return;
- readback of the installation row.

No bulk backfill is allowed solely from catalog or registry status.

## 6. Certification

Certification is independent from installation. It may include:

- schema compatibility;
- action template validation;
- read-only smoke test;
- permission-scope test;
- provider error normalization;
- rate-limit behavior;
- write dry-run behavior;
- approval and same-cycle readback verification.

A base plugin certification does not automatically certify a tenant connection, and a tenant connection does not automatically certify a customized variant.

## 7. Shared asset and optional variant behavior

### Shared asset

A tenant can use the shared app/plugin/action directly after authority and readiness pass. No tenant asset copy is created.

### Optional variant

A variant may customize non-secret configuration, prompts, output mapping, ordering, or allowed registered action templates. It may reference an eligible connection binding but cannot contain:

- secret values;
- Authorization headers;
- refresh/access tokens;
- unregistered provider URLs;
- hidden credential fields;
- cross-tenant connection IDs.

Variant certification may be required when patches affect runtime behavior.

## 8. User experience states

The tenant-facing catalog should distinguish:

- available shared asset;
- entitled but not granted;
- granted but connection required;
- credentials required;
- credential validation in progress;
- installed but certification required;
- ready for read;
- write approval required;
- quota or budget blocked;
- variant conflict;
- ready for exact execution.

Missing evidence must be represented as unknown/pending, not zero or false readiness.

## 9. Current pending connector cleanup model

Each operationally pending connector must be classified as:

- real tenant integration awaiting credentials or installation;
- managed platform connector awaiting validated installation evidence;
- internal transport that should not appear as installable;
- duplicate endpoint or connector representation;
- stale record to archive;
- development-only connector awaiting environment certification.

The cleanup phase must preserve provider bindings and avoid creating synthetic installations.

## 10. Security invariants

- authorization completes before credential materialization;
- secret-like keys are rejected from preference, variant, composition, and adaptation payloads;
- logs and manifests contain only opaque secret references and readiness summaries;
- connection tests are bounded and audited;
- credential-touching changes require the existing approval policy;
- provider writes are never part of profile preview, simulation, or design review;
- revocation invalidates future manifests and canaries immediately through authority/version invalidation.
