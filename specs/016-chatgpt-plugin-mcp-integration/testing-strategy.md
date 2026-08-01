# Testing Strategy

## Principles

- Test the MCP server directly before testing ChatGPT selection behavior.
- Prove denial and recovery paths, not only happy paths.
- Verify metadata against actual handler behavior.
- Use exact source, runtime, connection, package, and review fingerprints.
- Never use production customer secrets or broad customer datasets in tests.
- A transport success is not proof of a successful write.

## Test layers

### 1. Static contract validation

Validate:

- JSON and YAML parse;
- JSON Schema draft compatibility;
- OpenAPI 3.1 structure;
- package paths and manifest fields;
- tool names, titles, descriptions, schemas, and annotations;
- no duplicate tool names or ambiguous operation bindings;
- no secret literals or live connection technical IDs;
- manifest inventory and traceability references.

### 2. Unit tests

Cover:

- MCP envelope parsing and protocol-version selection;
- protected-resource metadata generation;
- bearer challenge generation;
- token claim validation;
- Context Kernel selector matching;
- tool eligibility filtering;
- annotation parity;
- bounded pagination and output sizing;
- redaction and evidence shaping;
- error taxonomy and retryability;
- idempotency and confirmation binding for future write tools.

### 3. Integration tests

Use controlled identity, registry, database, operation, and provider fakes or test instances to verify:

- initialization with no privileged dependencies;
- anonymous versus authenticated tool catalogs;
- valid and invalid OAuth grants;
- tenant/workspace/Brand resolution;
- tenant-safe projections;
- capability and policy decisions;
- operation creation and status readback;
- connector/provider isolation without credential disclosure;
- dependency timeouts, circuit breakers, and fail-closed behavior.

### 4. MCP Inspector acceptance

For every endpoint candidate:

1. initialize;
2. inspect instructions;
3. list tools;
4. call each tool with valid inputs;
5. call each tool with missing, malformed, inaccessible, oversized, and adversarial inputs;
6. verify schemas, results, errors, annotations, and authorization;
7. record catalog and server fingerprints.

### 5. ChatGPT developer-mode evaluation

Evaluation classes:

- direct supported requests;
- indirect supported requests;
- follow-up requests using stable IDs;
- ambiguous requests requiring clarification or no call;
- inaccessible resource requests;
- write requests during read-only phase;
- unsupported arbitrary database, HTTP, provider, repository, or secret requests;
- prompt-injection content from user or connected data.

Metrics:

- correct tool selection ≥ 95% on supported evaluation prompts;
- no-call or safe refusal ≥ 99% on unsupported prompts;
- argument-schema validity ≥ 99%;
- cross-tenant leakage = 0;
- secret leakage = 0;
- unexpected mutation = 0.

## OAuth conformance matrix

| Case | Expected result |
|---|---|
| no token for protected tool | 401 bearer challenge with protected-resource metadata |
| valid token and scope | authorized execution |
| valid token, insufficient scope | 403 structured scope denial |
| expired token | 401 and reauthentication path |
| revoked token | 401/403 according to token type; no cached acceptance |
| wrong issuer | reject |
| wrong audience/resource | reject |
| altered signature | reject |
| missing subject | reject protected user tools |
| resource omitted during authorization | fail conformance |
| PKCE method other than approved S256 | reject or refuse registration |
| reused authorization code | reject |

## Isolation matrix

At minimum create:

- two tenants;
- two workspaces per tenant where supported;
- two Brands per workspace;
- users with tenant admin, workspace admin, Brand manager, read-only, and no-access roles;
- user-owned and workspace-owned connections;
- operations owned by different principals and resources.

Test every tool across:

- same tenant/same Brand;
- same tenant/different authorized Brand;
- same tenant/inaccessible Brand;
- different tenant with known ID;
- fabricated ID;
- deleted or suspended membership;
- revoked role during an active session.

Expected leakage across denied boundaries: zero rows, zero tool metadata, zero provider identity, zero existence detail beyond neutral policy-approved messages.

## Annotation parity tests

For each tool:

- trace the handler and downstream operation family;
- detect database writes, queue dispatch, external calls, public effects, and irreversible transitions;
- compare actual behavior with `readOnlyHint`, `openWorldHint`, and `destructiveHint`;
- fail CI on mismatch or unknown behavior.

Phase-1 acceptance requires all exposed tools to be proven read-only.

## Boundedness and performance

Test:

- maximum request bytes;
- maximum schema depth;
- maximum result rows and bytes;
- pagination cursor validation;
- field allowlists;
- slow dependency timeouts;
- concurrent initialization and tool-list load;
- rate limits by client, principal, tenant, and tool;
- P50/P95/P99 latency;
- backpressure and circuit-breaker behavior.

## Write-tool tests for future phase

Before any write tool is enabled:

- same idempotency key repeated concurrently;
- different key with same semantic intent;
- timeout before dispatch;
- timeout after dispatch;
- unknown provider outcome;
- confirmation missing, expired, reused, wrong principal, wrong target, or wrong input hash;
- resource changed after confirmation;
- authorization revoked immediately before dispatch;
- successful readback;
- failed readback;
- compensation success and failure;
- operation status follow-up from another tenant.

Acceptance: at most one side effect per idempotency key and no replay after unknown outcome without reconciliation.

## Privacy and secret tests

Scan:

- source;
- package templates;
- generated manifests;
- MCP content and `structuredContent`;
- `_meta`;
- HTTP errors and headers;
- application logs;
- traces and metrics labels;
- CI artifacts;
- submission/reviewer artifacts.

Forbidden values include access tokens, refresh tokens, client secrets, backend API keys, authorization headers, provider credentials, raw grants, database URLs, private keys, and live account-specific plugin connection IDs.

## Availability and recovery tests

Inject failures for:

- authorization server;
- token verification keys;
- Context Kernel;
- database;
- capability registry;
- evidence store;
- operation engine;
- connector/provider;
- DNS/TLS/edge route.

Verify retryability classification, backoff, fail-closed authority, no duplicate writes, and support-ready evidence IDs.

## Package and review parity

Compare deterministic fingerprints for:

1. source tool catalog;
2. deployed endpoint;
3. MCP Inspector;
4. ChatGPT developer connection;
5. plugin package;
6. submission scan;
7. approved snapshot;
8. published version.

Any unexplained mismatch blocks promotion or publication.

## Production acceptance

Required evidence:

- main/Production/runtime parity according to the repository release contract;
- public HTTPS and TLS health;
- OAuth discovery and callback health;
- read-only smoke tests using controlled data;
- isolation canary;
- revoke/disable drill;
- alert routing;
- rollback rehearsal;
- no-secret log sample;
- post-deploy metadata fingerprint.

## Evidence format

Every test wave records:

- exact source SHA;
- deployed version and environment;
- test-data classification;
- tool-catalog fingerprint;
- start/end timestamps;
- passed, failed, skipped, and blocked counts;
- bounded failure codes;
- artifact paths;
- reviewer and approval state;
- secrets-included flag fixed to `false`.
