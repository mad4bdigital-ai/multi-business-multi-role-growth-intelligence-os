# Specification

## Problem

Admin and tenant Custom GPT schemas mix fixed transport operations with large DB-driven capability catalogs. Generated artifacts can drift, the tenant artifact contains an empty property schema, and surface membership is partly embedded in generator code rather than governed authority.

Production already has SQL registries for tools, endpoint exports, contracts, dispatch bindings, credentials, and policies. Git-only tool schemas would regress runtime dynamism; fully DB-generated public OpenAPI would make builds non-deterministic.

## Goals

1. Keep MCP-like tools and schemas MySQL-primary and principal-aware.
2. Make public transport schemas deterministic and Builder-safe.
3. Separate Admin, Tenant, Activation, Device, and Development surfaces.
4. Revalidate SQL authority for every execution.
5. Generate edge routing policy from canonical metadata.
6. Prevent schema/proxy/runtime drift.
7. Preserve compatibility through aliases and deprecation policy.

## Non-goals

- No direct MySQL access from the edge.
- No business logic, tenant resolution, credential storage, or final authorization at edge.
- No DB-only change may alter public host/auth/fixed-operation topology.
- No Git-only declaration may enable a dynamic tool.
- No immediate legacy-route removal.

## Authority model

### Git contract plane

Git MUST control public filenames, server URLs, security schemes, fixed operations, list/call envelopes, error/pagination/chunking contracts, operation budgets, and generation rules.

### SQL capability plane

SQL MUST control dynamic tool identity, input/output schema versions, visibility, surface bindings, action/endpoint/provider bindings, credential/approval/execution/readback policies, lifecycle, availability, and runtime certification.

### Runtime rule

`callTool` MUST resolve the current tool, schema, surface binding, authority, endpoint binding, credential policy, execution policy, and readback policy from SQL. Client-provided raw URLs, action keys, provider URLs, auth modes, or descriptions MUST NOT be trusted.

## Functional requirements

### FR-001 — Admin Core

Admin Core MUST expose stable admin/system facades on `auth.mad4b.com`, with warning headroom below the Builder hard limit.

### FR-002 — Tenant Core

Tenant Core MUST expose only tenant-safe fixed routes and the tenant MCP facade using tenant OAuth. Admin visibility MUST NOT be inferred from an admin-principal catalog call.

### FR-003 — Activation surfaces

Activation fixed operations MUST be split into admin-authenticated and tenant-authenticated schemas on `activation.mad4b.com`.

### FR-004 — Device/development isolation

Device operations remain on `connector.mad4b.com`; development diagnostics remain on `dev.mad4b.com`.

### FR-005 — Dynamic discovery

`listTools` MUST return principal-filtered name, description, input/output schema, schema version, registry version, lifecycle/availability, risk metadata, pagination/chunking metadata, and `secrets_included: false`.

### FR-006 — Dynamic execution

`callTool` MUST authenticate, force tenant/workspace from signed identity, resolve current SQL rows, validate versions and input, enforce authority/credential/approval/execution policies, dispatch through governed bindings, validate output, perform readback, and persist bounded secret-safe evidence.

### FR-007 — Version conflict

Breaking schema changes create a new version. A stale caller receives `TOOL_SCHEMA_VERSION_CONFLICT`.

### FR-008 — Error envelope

Every surface uses stable code, message, bounded details, request ID, and `secrets_included: false`.

### FR-009 — Deterministic generation

Generate in a temporary directory, recursively validate all request/response schemas, enforce budgets and host separation, then write.

### FR-010 — Canonical parity

CI fails when committed generated artifacts differ byte-for-byte from canonical output.

### FR-011 — Surface membership

Fixed operations use Git metadata such as `x-mad4b-surfaces`; dynamic tools use SQL surface bindings. Hard-coded JavaScript operation sets are not authority.

### FR-012 — Activation Gateway

The gateway is stateless and enforces exact host/method/path/query/header policy, size/time limits, redirect blocking, secret-safe logs, and a fixed `auth.mad4b.com` upstream.

### FR-013 — Signed manifest

Edge policy is a signed versioned projection with canonical commit, registry version, content hash, expiry, and signature.

### FR-014 — Stale policy

Expired policy fails closed for mutations. A bounded read-only grace window is optional and observable.

### FR-015 — No edge database

The gateway never queries MySQL, decrypts credentials, selects providers, resolves membership, or transforms business results.

### FR-016 — Principal isolation

Admin and tenant catalogs are tested with distinct real authentication modes.

### FR-017 — Lifecycle governance

Selected authority tables MUST have owner, lifecycle, retention, and health policy. `runtime_unclassified` becomes blocking for selected authority tables.

### FR-018 — Backward compatibility

Legacy routes remain during dual-run with explicit deprecation metadata and measured usage.

## Security invariants

- No secrets in schemas, manifests, logs, evidence, or errors.
- No cross-tenant/brand credential reuse without explicit binding.
- No client-selected upstream origin.
- No arbitrary provider headers.
- No mutation without authority, required approval, and readback.
- No active/recovered state without same-cycle evidence.
- Unknown surface/tool/state/policy fails closed.

## Success criteria

- Published tenant schema has no null/empty property schemas.
- All generated schemas pass recursive Builder validation.
- Real admin and tenant tests prove different projections.
- Dynamic schemas change via governed SQL versioning without adding OpenAPI operations.
- Fixed transport changes remain PR-reviewed and reproducible.
- Gateway route policy and fixed OpenAPI routes have zero unexplained drift.
- Rollback restores prior schema, manifest, and runtime projection.
