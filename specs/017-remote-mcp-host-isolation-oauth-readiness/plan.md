# Implementation Plan — Spec 017

## Baseline

Implementation must branch from a fresh read of `main`. The specification baseline was `a722609b45ab3ac4617096963380ab4e1434f17d`; if `main` advances before implementation, the implementer must re-evaluate affected routing/OAuth files and record the new pinned implementation base.

## Change strategy

The implementation should be split into source hardening and separately governed live rollout. Source work must be independently testable without DNS, provider, secret, or migration mutation.

### Phase A — Canonical request-host resolver

1. Inventory current uses of `host`, `x-forwarded-host`, `x-original-host`, Express trusted-proxy settings, and any shared URL/host normalization helpers.
2. Introduce one canonical effective-host resolver in the existing platform HTTP utility layer or the narrowest Remote MCP/OAuth shared layer.
3. Define deterministic normalization:
   - strip an allowed port component where appropriate;
   - lowercase DNS hostnames;
   - reject empty, malformed, multi-value, user-info, scheme-bearing, or ambiguous values;
   - do not accept forwarded headers as authoritative unless the request is known to arrive through the approved trusted-proxy boundary.
4. Unit-test direct-host and trusted-proxy cases separately.

### Phase B — `/mcp` resource-host isolation

1. Resolve the canonical host from `REMOTE_MCP_RESOURCE_URL`.
2. Before MCP request parsing or database-backed execution, resolve the effective request host.
3. If the effective host is not canonical, return the platform's fail-closed not-found response.
4. Preserve existing feature-flag behavior and Remote MCP protocol behavior on the canonical host.
5. Add regressions for `auth.mad4b.com`, Activation host, unknown host, malformed host, and valid canonical host.

### Phase C — Protected-resource metadata isolation

1. Replace unconditional host fallback with explicit supported resource-host matching.
2. Map Remote MCP metadata only to the configured Remote MCP resource host.
3. Preserve Tenant GPT/Activation metadata only on its explicit supported host(s)/routes.
4. Unknown hosts return not found.
5. Add regressions proving no cross-family scope leakage.

### Phase D — Operational readiness readback

1. Add or extend an admin-only readiness route/service.
2. Return only bounded operational state:
   - configured resource URL;
   - configured OAuth issuer URL;
   - MCP/OAuth/DCR enabled booleans;
   - whether DCR is currently advertisable;
   - redirect-origin policy readiness;
   - signing-key readiness boolean only;
   - existence/readiness of `remote_mcp_oauth_clients`;
   - existence/readiness of `remote_mcp_oauth_authorization_codes`;
   - existence/readiness of `remote_mcp_oauth_grants`;
   - secrets-included=false.
3. Do not return secret lengths, fingerprints unless already approved by secret authority, token hashes, grant rows, user identifiers, or credentials.
4. Make schema-unavailable conditions explicit without mutating schema.

### Phase E — Configuration contract

Update `http-generic-api/.env.example` to include:

```text
REMOTE_MCP_ENABLED=false
REMOTE_MCP_OAUTH_ENABLED=false
REMOTE_MCP_OAUTH_DCR_ENABLED=false
REMOTE_MCP_LEGACY_USER_JWT_ENABLED=false
REMOTE_MCP_OAUTH_ALLOW_LOOPBACK=false
REMOTE_MCP_RESOURCE_URL=https://mcp.mad4b.com
REMOTE_MCP_AUTHORIZATION_SERVER_URL=https://auth.mad4b.com/auth/mcp
REMOTE_MCP_RESOURCE_DOCUMENTATION_URL=https://mcp.mad4b.com/docs
REMOTE_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://www.chatgpt.com,https://claude.ai,https://www.claude.ai
REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS=
REMOTE_MCP_OAUTH_SIGNING_SECRET=
```

The example must state that the real signing secret comes only from approved secret authority and must not equal `JWT_SECRET`.

### Phase F — Exact-head source validation

On the exact implementation head:

1. run targeted host-isolation tests;
2. run existing Remote MCP profile tests;
3. run OAuth route tests;
4. run access-token verifier tests;
5. run metadata-routing tests;
6. run disabled-startup-boundary tests;
7. run full CI;
8. run architecture/context/governance checks required by the repository;
9. verify no migration/provider/deployment mutation occurred.

## Separately governed live rollout

Source completion is not authorization for the following steps.

### Live Phase 1 — Non-production routing while disabled

- deploy the exact reviewed source SHA to the controlled non-production runtime;
- configure DNS/TLS for `mcp.mad4b.com`;
- configure reverse proxy so the runtime receives deterministic canonical host information;
- keep `REMOTE_MCP_ENABLED=false` and DCR disabled;
- verify wrong-host `/mcp` fails closed at the public edge and application layer.

### Live Phase 2 — Persistence and secret readiness

- apply `20260801_remote_mcp_oauth21_operational.sql` through governed migration tooling;
- read back all three tables and required indexes;
- provision a dedicated Remote MCP OAuth signing secret;
- configure canonical resource and issuer values;
- configure bounded allowed origins;
- do not expose secret material in evidence.

### Live Phase 3 — OAuth metadata canary

- set `REMOTE_MCP_OAUTH_ENABLED=true` while MCP remains disabled;
- verify protected-resource and authorization-server metadata;
- verify DCR remains absent while disabled;
- verify signed authorization-request fail-closed paths.

### Live Phase 4 — Bounded DCR window

- approve the exact callback Origin emitted by the target client;
- set `REMOTE_MCP_OAUTH_DCR_ENABLED=true` for the bounded registration window;
- verify `registration_endpoint` appears;
- register one non-production client;
- retain client credentials only in approved secret storage;
- disable DCR again unless an ongoing registration policy is separately approved.

### Live Phase 5 — MCP canary and client acceptance

- set `REMOTE_MCP_ENABLED=true` in canary;
- verify `initialize`, `tools/list`, protected tool challenge, authorization-code PKCE, refresh rotation, revocation, tenant isolation, and wrong-resource denial;
- run MCP Inspector;
- run ChatGPT Developer mode;
- run Claude Custom Connector if in rollout scope;
- run one neutral standards-compliant client;
- record exact deployed SHA and bounded evidence.

### Live Phase 6 — Promotion and rollback rehearsal

- prove disable ordering;
- prove DCR can be disabled independently;
- prove grants can be revoked without dropping tables;
- prove runtime rollback to the previous verified SHA;
- only then consider Production promotion under the repository's separate governed promotion contract.

## Implementation PR boundaries

The implementation PR may modify source, tests, documentation, and non-secret configuration examples. It must not contain:

- real secrets;
- real registered client credentials;
- provider state mutations;
- applied migration evidence falsely represented as source state;
- account-specific connection IDs;
- Production deployment authorization.
