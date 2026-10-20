# Admin ↔ Tenant OAuth and MCP end-to-end acceptance — 2026-10-15

> **Source audit and Staging test specification.** Baseline `main@6b439a2810eadfba53c224a274ca12ced20c14b4`. This document and its source fixes **do not** certify live Staging, install an OAuth client, issue real tokens, expand roles, modify a database, or authorize a Production release. Real Windows Docker Staging cannot be verified while its current remote computer is offline. Do not use the retired `dev.mad4b.com` as proof of live certification.

## Which lifecycle belongs to which principal?

| Actor / surface | Authentication and session | Authority and MCP boundary |
|---|---|---|
| Platform Admin | Admin platform bearer/backend guard for `/gpt/tools` and `/system/tools`. This is **not** the Tenant's own OAuth token. | Admin/System discovery and dispatch require original Admin authority. No silent Tenant impersonation; `docs/staging-oauth-and-admin-tenant-inspection-governance.md` marks cross-Tenant inspection runtime binding `not_bound` and `deny_until_bound=true`. |
| Tenant owner/admin/manager/member | Tenant GPT authorization-code/PKCE → user and active tenant membership → tenant/resource-bound access token; activation is a separate protected-resource boundary. | Tenant tools `/local/tools`, `/system/tools`, `/system/tools/call` use Tenant OAuth projections; authorize user, tenant, workspace resource, capability and operation separately. Manager/owner role **cannot** be substituted for an inactive member or another Tenant. |
| ChatGPT/Claude/generic Remote MCP client acting for a user | `/auth/mcp/oauth/register` when permitted → `authorize` → signed consent + PKCE `code` → `token` → Bearer for exact MCP resource. Refresh token rotates; revoke invalidates grant. | `/mcp` exposes protocol initialize/list and protected `tools/call`. Each call must validate access-token signature, issuer, resource/audience, client, JTI, grant state, active subject/membership, required OAuth scopes, tool binding and resource authority; write scopes separately fail closed by default. Client-profile metadata alone grants nothing. |

## Required real Staging matrix

Use four identities: `platform_admin`, `tenant_A_owner`, `tenant_A_member`, `tenant_B_owner`. Also run deactivated-user, revoked membership and revoked OAuth-grant cases. Keep real credentials out of CI artifacts and logs.

| ID | Stage | Expected behavior / proof |
|---|---|---|
| OA-01 | Admin login and refresh | Admin identity, original issuer/audience, session expiry and least privilege verified; no Tenant authority introduced by token refresh |
| OA-02 | Tenant A OAuth authorization | Registered client, exact callback, PKCE S256, explicit consent, active `user_id` + `tenant_id`, exact resource and allowed scopes; single-use code |
| OA-03 | Tenant B independent connection | Separate active membership, tenant-bound grants and readback; A's token cannot be reused as B's |
| OA-04 | Cross-environment replay | Staging client ID, token and callback denied in Production and vice versa; no cross-issuer audience fallback |
| OA-05 | OAuth refresh rotation | Old refresh rejected, new refresh active, access grants JTI-specific; expired codes and expired tokens rejected |
| OA-06 | OAuth revocation | Revoked access/refresh grant rejected **before** offering incremental scope consent; database persistence outage returns 503 (not false-success 200), safe retry returns 200, unknown token remains idempotent 200 |
| OA-07 | Deactivated user/tenant/membership | Validly signed but inactive subject rejected, including with an insufficient requested scope |
| OA-08 | Client registration | Unknown client, forged redirect, forbidden Origin, non-S256 verifier and missing consent fail closed |
| MC-01 | MCP initialize / tools/list | Correct Streamable HTTP protocol/canonical host, no assumption that public discovery grants data authority |
| MC-02 | Tenant A tool execution | Workspace list derives from active memberships; Brand list from workspace-specific grants and exact identity |
| MC-03 | Tenant A→B resource attempt | A Tenant-bound Remote MCP OAuth grant must restrict both workspace listing and Brand lookup to its own `tenant_id`, even if its user also belongs to B; `MCP_CONTEXT_DENIED` for B with no B resource metadata in error/audit |
| MC-04 | Ambiguous Brand aliases | Where different canonical Brands share a name/target key, only return grant reference without any ambiguous global Brand metadata; exact canonical ID wins |
| MC-05 | Insufficient OAuth scope | Only an active, unrevoked, membership-valid grant may request incremental consent; no automatic write scope |
| MC-06 | Admin attempting Tenant call | Reject Admin bearer substitution and cross-Tenant inspection until the explicit read-only Admin inspection runtime adapter is bound and approved; zero unapproved calls |
| MC-07 | Tenant role downgrade/removal | Immediate denial at call time; refresh must not restore removed capability |
| MC-08 | Write tool request | Require separately promoted scope, subject-resource authority, approval, capability, lease and same-cycle readback; otherwise deny |
| MC-09 | Full disconnect/reconnect | Revoke → confirm revoked JTI/refresh state → reconsent under a new grant; ensure the old token does not regain access |
| MC-10 | Logging/observability | Same-cycle correlation and actor/tenant/client IDs with no raw code, verifier, Bearer or refresh token leak |

## Repository regression evidence

- `http-generic-api/test-remote-mcp-oauth21-routes.mjs`: consent, PKCE code exchange/replay, incremental scope, refresh rotation and revoke, including storage outage and retry.
- `http-generic-api/test-remote-mcp-access-token-verifier.mjs`: exact client, JWT issuer/audience, resource, JTI, live membership, grant status and new revoked/inactive-versus-insufficient-scope tests.
- `http-generic-api/test-chatgpt-mcp-readonly-runtime.mjs`: active workspace/member grants and newly added duplicate cross-Tenant Brand alias metadata regression.
- `http-generic-api/test-remote-mcp-host-isolation.mjs`, `http-generic-api/test-remote-mcp-multi-client-profiles.mjs`, `http-generic-api/test-spec012-t031-oauth-token-route-wiring.mjs`: host/origin/client separation and Tenant-GPT token binding.
- Passing synthetic tests or generated schemas does **not** close real integration acceptance. In particular Admin read-only Tenant inspection and Act-as-User delegation remain declared **`not_bound`**; they must not be presented as enabled.

## Current blocking observations and promotion rule

1. A second Tenant isolation issue existed: the remote OAuth token contained the selected `tenant_id`, but the MCP workspace list and Brand call could look up **all memberships of the same user**, including an unrelated Tenant. Remote OAuth calls now constrain workspaces to the token Tenant and deny another Tenant's Brand selection before querying; legacy JWT membership enumeration remains unchanged. Exact live Staging same-user/two-Tenant testing is mandatory.
2. Before source fix, `chatgptMcpRuntime.js` enriched workspace-scoped Brand grants from global `brands` aliases with last-row-wins and no collision check. The change rejects ambiguous enrichment and gives exact canonical `brand_id` precedence. Verify against real Global Brand relationship data on Staging before claiming complete tenant isolation.
3. Before source fix, `remoteMcpAccessTokenVerifier.js` checked missing OAuth scopes **before** DB-backed revocation and subject membership; this could offer incremental consent on revoked/inactive sessions. Now grant/membership must be valid first. Run negative tests using actual Staging access grants and verify HTTP 401/403 behavior.
4. Before source fix, `routes/remoteMcpOAuthRoutes.js` returned HTTP 200 even when persistence of OAuth revocation failed, falsely implying that a grant was disconnected. The route now returns HTTP 503 for storage failures while preserving RFC-style HTTP 200 for invalid/unknown tokens; an actual Staging database failure/retry drill is still needed.
5. Live Staging: **unverified**, current Windows Docker device unavailable through remote connector. Database migrations, flags, OAuth client registration, host routing, secrets and provider integration are not remotely attested. Run the canonical host Staging certificate from `docs/runbooks/staging-to-production-two-gate-acceptance-20261015.md`, then the entire matrix above.
6. **No Production promotion** until all applicable OA/MC tests pass on the exact live deployed Staging SHA, with confirmed DB migrations/grants, rollback, issuer/resource separation, no cross-Tenant metadata and owner authorization bound to the Production candidate. Any failing case blocks production.
