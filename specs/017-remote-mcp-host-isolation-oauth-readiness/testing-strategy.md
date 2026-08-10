# Testing Strategy — Spec 017

## Principles

- Source tests must be deterministic and must not depend on public DNS or provider mutation.
- Host isolation must be tested before authentication/tool execution to prove the boundary is structural rather than incidental.
- Existing Tenant GPT/Activation OAuth behavior must be covered as a compatibility regression.
- Live client acceptance is separate from source CI and must record the exact deployed SHA.
- No test fixture may contain real secrets, access tokens, refresh tokens, registration access tokens, or real client credentials.

## Unit tests — effective host resolver

Required cases:

1. direct canonical host;
2. direct canonical host with permitted port form;
3. uppercase DNS host normalized to lowercase;
4. approved trusted-proxy forwarded host;
5. client-supplied forwarded host outside trusted-proxy boundary ignored/rejected;
6. comma-separated forwarded host rejected unless the approved proxy contract defines an exact deterministic extraction rule;
7. scheme-bearing host rejected;
8. user-info host rejected;
9. blank host rejected;
10. malformed port rejected;
11. unknown host normalized but not authorized.

## Integration tests — `/mcp`

| Case | Expected |
|---|---|
| canonical MCP host + feature enabled | existing MCP behavior |
| `auth.mad4b.com/mcp` | 404/fail closed |
| Activation host `/mcp` | 404/fail closed |
| unknown host `/mcp` | 404/fail closed |
| malformed/ambiguous host `/mcp` | 404/fail closed |
| canonical host + feature disabled | existing disabled boundary |

Tests must prove wrong-host rejection occurs before protected tool DB queries where instrumentation can establish that boundary safely.

## Integration tests — protected-resource metadata

Required cases:

- canonical MCP resource host returns only Remote MCP metadata;
- canonical Tenant GPT/Activation resource host returns only its explicit metadata;
- issuer host without an explicitly assigned protected-resource contract does not inherit Activation metadata;
- unknown host returns not found;
- Remote MCP scopes do not appear on Tenant resource metadata;
- Tenant scopes do not appear on Remote MCP metadata.

## OAuth/DCR tests

Preserve and extend existing cases:

- OAuth disabled → metadata/flows fail closed as designed;
- DCR disabled → no `registration_endpoint`;
- DCR enabled but redirect-origin policy unusable → no `registration_endpoint`;
- DCR enabled + exact approved redirect origin → `registration_endpoint` advertised;
- unapproved redirect Origin rejected;
- exact registered redirect URI required;
- PKCE `S256` required;
- wrong resource denied;
- invalid/expired signed authorization request denied;
- refresh rotation and replay denial preserved;
- revocation preserved.

## Readiness tests

Readiness should be tested with mocked/configurable schema and environment states.

Required combinations:

1. all flags disabled, schema absent;
2. OAuth enabled, MCP disabled;
3. DCR true but redirect policy absent;
4. DCR true with redirect policy ready;
5. signing secret missing;
6. signing secret ready;
7. one OAuth table missing;
8. all OAuth tables ready;
9. DB unavailable;
10. malformed resource/issuer configuration.

Negative assertions:

- no secret values;
- no secret length/fingerprint unless separately approved contract requires a non-sensitive fingerprint;
- no client secrets;
- no registration access tokens;
- no access/refresh tokens;
- no authorization codes;
- no raw grant/client rows;
- no raw authorization header;
- `secrets_included=false`.

## Configuration contract tests

Where repository tooling supports env-template validation:

- every runtime-consumed `REMOTE_MCP_*` operational key must be represented in `.env.example` or intentionally documented elsewhere;
- secret values remain empty placeholders;
- canonical URL defaults/examples are parseable;
- no live account-specific identifiers are committed.

## Existing regression suite

At minimum run on exact implementation head:

```bash
node test-remote-mcp-oauth21-profile.mjs
node test-remote-mcp-access-token-verifier.mjs
node test-remote-mcp-oauth21-routes.mjs
node test-remote-mcp-multi-client-profiles.mjs
node test-chatgpt-mcp-readonly-runtime.mjs
node test-chatgpt-mcp-metadata-routing.mjs
node test-remote-mcp-disabled-startup-boundary.mjs
```

Then run repository Full CI plus required architecture/context/governance checks.

## Live acceptance matrix

Live acceptance is separately authorized. Record one exact deployed SHA and evaluate:

- DNS resolution for `mcp.mad4b.com`;
- valid TLS chain and hostname;
- reverse-proxy Host/forwarded-host behavior;
- public wrong-host `/mcp` denial;
- public protected-resource metadata;
- authorization-server metadata;
- schema readback for three OAuth tables;
- signing-key readiness boolean;
- DCR disabled state;
- bounded DCR registration state when authorized;
- authorization-code + PKCE flow;
- access-token expiry;
- refresh rotation;
- refresh replay denial;
- access-token/grant revocation;
- tenant/workspace/Brand isolation;
- wrong-resource denial;
- MCP Inspector connection;
- ChatGPT Developer mode connection;
- Claude connector when in scope;
- generic neutral-client connection;
- reconnect/refresh after token expiry;
- disable and rollback drill.

## Closeout rule

Spec 017 is not complete merely because source CI passes. Completion requires source hardening plus the separately governed live-readiness evidence listed in `completion.json`, or an explicit decision to close the spec at a narrower non-production boundary with the remaining live gates documented as unresolved.
