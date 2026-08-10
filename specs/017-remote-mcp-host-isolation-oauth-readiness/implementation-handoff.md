# Implementation Handoff — Spec 017

## Purpose

Implement the minimum source changes required to make the existing Remote MCP/OAuth 2.1 integration fail closed on resource-host identity and observable for live-readiness preparation without performing any live mutation.

## Pinned specification baseline

- Repository: `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`
- Specification base: `main@a722609b45ab3ac4617096963380ab4e1434f17d`
- Spec branch: `gpt/spec-017-remote-mcp-host-isolation-oauth-readiness-20260810`
- Spec directory: `specs/017-remote-mcp-host-isolation-oauth-readiness`

Implementation must fresh-read `main` and record a new exact implementation base if `main` has advanced.

## Required source corrections

### 1. Canonical effective-host resolver

Create/reuse one resolver shared by Remote MCP route admission and protected-resource metadata routing. It must implement deterministic normalization and the repository's approved trusted-proxy model.

Do not let arbitrary `x-forwarded-host` or `x-original-host` values become resource authority merely because the header exists.

### 2. `/mcp` host guard

Before MCP request execution:

```text
resolve effective host
→ derive host from REMOTE_MCP_RESOURCE_URL
→ exact normalized equality?
   yes: continue
   no: fail-closed not found
```

Required negatives include:

- `auth.mad4b.com/mcp`;
- the Tenant GPT/Activation resource host `/mcp`;
- unknown host `/mcp`;
- malformed or ambiguous host.

### 3. Protected-resource explicit routing

Remove unconditional cross-resource fallback. Supported resource families must be selected explicitly. Unknown hosts return not found and do not inherit another resource family's scopes or authorization server.

### 4. Admin no-secret readiness

Use an existing admin/readiness authority path where possible. Report bounded state only:

- resource URL;
- issuer URL;
- MCP/OAuth/DCR enabled state;
- DCR advertisable state;
- redirect policy readiness;
- signing-key readiness boolean;
- three OAuth table readiness states;
- `secrets_included=false`.

No secret/token/hash/raw OAuth row may be returned.

### 5. Environment contract

Update `.env.example` with all Remote MCP operational flags/configuration keys. Real secret values remain empty.

### 6. Regression coverage

Add host isolation and metadata isolation tests, then run the existing Remote MCP/OAuth suites and Full CI on the exact implementation head.

## Files expected to be investigated

At minimum:

- `http-generic-api/remoteMcpConnectorRuntime.js`
- Remote MCP route registration/mounting files
- `http-generic-api/remoteMcpOAuthProfile.js`
- protected-resource metadata route/service
- `http-generic-api/remoteMcpOAuthStore.js`
- `http-generic-api/releaseReadiness.js` or the canonical equivalent admin readiness surface
- `http-generic-api/.env.example`
- Remote MCP/OAuth test files

Paths may have moved on a newer `main`; use runtime search rather than hardcoding stale assumptions.

## Source PR acceptance

A source implementation PR is ready for review only when:

1. exact implementation base/head are recorded;
2. canonical host succeeds;
3. wrong-host MCP requests fail closed;
4. metadata no longer cross-falls between resource families;
5. existing Tenant GPT/Activation discovery regression passes;
6. readiness is no-secret;
7. env contract is complete;
8. targeted Remote MCP/OAuth tests pass;
9. Full CI and repository governance checks pass;
10. no deployment, migration apply, provider mutation, secret access, real client registration, feature activation, Production mutation, or force push occurred.

## Separate live boundary

Do not perform the following from implementation authority alone:

- DNS/TLS/reverse-proxy mutation;
- migration apply;
- signing-secret provisioning/rotation;
- redirect-origin activation;
- DCR activation/client registration;
- MCP/OAuth feature activation;
- ChatGPT/Claude/Inspector connection creation;
- Production promotion.

Use `plan.md`, `testing-strategy.md`, and `completion.json` as the live handoff after source implementation is reviewed and merged.
