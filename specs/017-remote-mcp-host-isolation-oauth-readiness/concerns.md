# Concerns and Risks — Spec 017

## R1 — Cross-resource OAuth metadata leakage

**Risk**: a request on the wrong host receives metadata from another resource family, causing clients to request unrelated scopes or use an unintended authorization contract.

**Control**: explicit supported-host routing with not-found fallback only.

## R2 — Wrong-host MCP execution

**Risk**: `/mcp` executes on an issuer, Activation, or unknown virtual host because routing is path-only.

**Control**: canonical MCP host guard before MCP parsing/database work.

## R3 — Forged proxy headers

**Risk**: an external client supplies `x-forwarded-host` or `x-original-host` and influences resource routing.

**Control**: define trusted-proxy authority explicitly; ignore forwarded-host authority outside that boundary.

## R4 — Ambiguous host normalization

**Risk**: comma-separated forwarding chains, schemes, user-info, malformed ports, case differences, or alternate representations bypass exact host matching.

**Control**: deterministic parser and normalization with malformed/ambiguous values rejected.

## R5 — DCR advertised before persistence readiness

**Risk**: authorization-server metadata shows a registration endpoint while the three OAuth tables are absent, causing live registration failures and misleading readiness.

**Control**: live rollout must apply/read back the governed migration before opening the DCR window; readiness should expose schema readiness.

## R6 — DCR overexposure

**Risk**: DCR remains enabled continuously with an unnecessarily broad redirect-origin allowlist.

**Control**: bounded DCR windows by default, exact HTTPS Origin approval, loopback separately disabled/enabled, post-registration disable unless ongoing DCR policy is approved.

## R7 — Signing-key coupling

**Risk**: Remote MCP access tokens reuse platform `JWT_SECRET`, coupling compromise and rotation domains.

**Control**: dedicated Remote MCP OAuth signing secret, independently provisioned and never returned by readiness.

## R8 — Readiness endpoint becomes a secret oracle

**Risk**: diagnostics expose secret length, raw DB rows, client IDs, registration tokens, hashes, or user grant details.

**Control**: bounded booleans/canonical URLs only; explicit negative tests and `secrets_included=false`.

## R9 — Source readiness confused with deployment readiness

**Risk**: green CI is treated as proof that DNS/TLS, migration, secret, proxy, OAuth, DCR, or client acceptance are live.

**Control**: separate completion states and separately governed live phases; exact deployed SHA required in closeout evidence.

## R10 — Tenant GPT/Activation regression

**Risk**: fixing fallback behavior breaks existing explicit Tenant GPT/Activation discovery.

**Control**: inventory its canonical routes/hosts and retain dedicated regression coverage before changing metadata dispatch.

## R11 — Proxy and application disagree on host

**Risk**: public edge routes `mcp.mad4b.com` correctly, but application sees another Host due to proxy rewrite, producing false denials or incorrect discovery.

**Control**: deployment contract must declare which host header is preserved, which proxy headers are trusted, and test the same behavior from the public edge.

## R12 — Port handling drift

**Risk**: non-production hosts with explicit ports fail or bypass matching inconsistently.

**Control**: canonical normalization rules must distinguish hostname identity from deployment port according to the configured resource URL and tests.

## R13 — OAuth migration drift

**Risk**: production schema differs from `20260801_remote_mcp_oauth21_operational.sql` or only part of the migration exists.

**Control**: governed migration ledger plus exact table/index readback; do not auto-create tables from readiness.

## R14 — Client callback drift

**Risk**: ChatGPT/Claude callback URI or Origin changes and DCR policy is widened by guesswork.

**Control**: capture the exact callback emitted by the exact client flow and approve only its exact HTTPS Origin.

## R15 — Refresh behavior not proven live

**Risk**: synthetic refresh rotation passes but a target client disconnects after access-token expiry.

**Control**: live acceptance must include expiry/refresh/reconnect and refresh replay denial.

## R16 — Logging sensitive OAuth material

**Risk**: new routing/readiness instrumentation logs authorization requests, tokens, registration credentials, hashes, or raw headers.

**Control**: log safe error classes and bounded identifiers only; add redaction tests where practical.

## Rollback concern

Dropping OAuth tables is explicitly forbidden as an incident rollback mechanism. Rollback should progress from DCR disable → client/grant disable/revocation → MCP disable → OAuth disable → runtime rollback, preserving durable evidence.
