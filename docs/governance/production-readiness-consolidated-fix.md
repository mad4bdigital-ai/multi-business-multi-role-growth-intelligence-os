# Production Readiness Consolidated Fix

This document records the governed code contract for the Production failure observed on Hostinger. It does not contain secret values and it does not authorize provider, database, DNS, restart, or deployment mutations.

## Scope

The consolidated change addresses four independent runtime conditions:

| Surface | Code contract | Production action still required |
|---|---|---|
| Tenant GPT OAuth | S256 PKCE remains mandatory for general clients; a confidential-client compatibility lane is limited to `mad4b-tenant-gpt` and requires `client_secret`, `state`, exact redirect binding, and one-time authorization codes | Configure the matching OAuth client secret in the governed platform secret source and reconnect the GPT Action if its OAuth configuration changed |
| Trusted ingress | Production OAuth metadata remains fail-closed until proxy header trust, ingress attestation, and caller-header stripping are all true | Attest the real Cloudflare/Hostinger ingress and verify `/\.well-known/oauth-authorization-server` readback |
| Control Plane writes | Dynamic audit and OpenAPI inventory use a dedicated control-plane writer only when `CONTROL_PLANE_WRITE_AUTHORITY_ENABLED=true`; otherwise they report degraded write authority and do not escalate privileges | Provision a least-privilege non-root writer and grants for the required tables, then enable and read back the capability |
| Runtime parity | Deployment-branch reconciliation now propagates `allowDeploymentBranch` into the normalizer, so Production manifest reconciliation no longer rejects its configured release branch as a source-branch event | Verify manifest branch, Hostinger branch, and `RELEASE_TRIGGER_DEPLOYMENT_BRANCH` are all `Production` |
| MCP catalog schema | `mcp_catalog_level` is guarded through `information_schema.columns` before list/descriptor queries; missing metadata returns `mcp_catalog_schema_migration_required` with migration name and `migration_apply_required=true`, never a raw `ER_BAD_FIELD_ERROR` | Apply and read back `20260815_custom_gpt_mcp_catalog_levels.sql` under independent DB authority; this PR does not apply it |
| Staging Admin GPT schema | The generated read-only Admin schema has one server (`https://dev.mad4b.com`), GET-only paths, and exactly one `backendApiKeyAuth` `x-api-key` scheme. The CI guard regenerates and compares the artifact | Re-import the schema into the Custom GPT editor after CI passes; use only a Staging API key and confirm no Production host/credential is present |
| Migration command aliases | Governed migration runner and reconciliation aliases resolve from `import.meta.url`, not process CWD | Verify dry-run/readback in the target runtime; apply remains separately authorized |

## OAuth security boundary

The compatibility lane is intentionally narrow. The application never makes PKCE optional for arbitrary clients. The lane is selected only when the client ID is exactly `mad4b-tenant-gpt` and the compatibility flag is enabled. Token exchange still requires validated client credentials; the authorization code remains bound to client, redirect URI, resource, scope, and state and is consumed once.

MCP and other OAuth clients continue to use `code_challenge_method=S256` and a matching `code_verifier`. Production should not use the compatibility lane for MCP.

## Control Plane writer contract

When enabled, the writer must use:

```text
CONTROL_PLANE_WRITE_AUTHORITY_ENABLED=true
CONTROL_PLANE_WRITE_DB_HOST=<approved host>
CONTROL_PLANE_WRITE_DB_NAME=<approved database>
CONTROL_PLANE_WRITE_DB_USER=<dedicated non-root writer>
CONTROL_PLANE_WRITE_DB_PASSWORD=<provider secret store only>
```

`CONTROL_PLANE_WRITE_DB_USER` must be distinct from `DB_USER`. The application rejects root/admin identities and rejects missing dedicated configuration. The PR does not contain `GRANT` statements because database grants are provider/database mutations requiring independent authority.

The minimum grants must be derived from the actual migrations and SQL paths and reviewed by the database owner. They must not be replaced by `GRANT ALL` or a root credential.

## MCP catalog migration and schema drift

The runtime code expects `mcp_catalog_level` on both `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools`, as defined by `20260815_custom_gpt_mcp_catalog_levels.sql`. The new guard checks the live information schema before exposing tools. A missing column is a readiness blocker for the catalog surface, not a reason to silently default all tools to `core`.

The correct closeout sequence is `migration file present` → `migration ledger/readback approved` → `column exists in both tables` → `indexes and seeded rows verified` → `tool list/descriptor smoke`. No migration apply, schema grant, or database mutation is included in this PR.

## Staging Admin Custom GPT schema

The staging-admin generator deliberately overrides the canonical Production bearer contract with a single Builder-safe `x-api-key` scheme for this independent read-only Staging surface. It never copies Production hosts or credentials. The generator fails closed if the generated schema contains more than one security scheme, more than one server, a non-GET operation, a forbidden Production host, or secret references. The CI workflow regenerates the file and requires a clean diff.

## Preflight and readback

Run the preflight in the target process environment without printing secret payloads:

```bash
npm run production:config-preflight
```

The command reports only presence, length, a short SHA-256 fingerprint, branch, readiness flags, and redacted errors. A successful code build is not runtime evidence. Production certification requires all of the following:

```text
/health                         -> HTTP 200
/version                        -> exact deployed SHA and branch
/deployment-info                -> exact release evidence
/.well-known/oauth-authorization-server -> metadata, after trusted-ingress attestation
```

## Hostinger change sequence

Hostinger environment variables must be added under the exact `auth.mad4b.com` Node.js application. Saving the variables triggers a redeployment. The operator must wait until the deployment is complete, confirm that the variables persist after refresh, then use Restart/Redeploy according to the provider workflow. The raw values must never be copied into Git, this document, runtime logs, or chat.

## Rollback

If the OAuth compatibility lane causes an unexpected client behavior, set `TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED=false` and redeploy after typed approval. This restores strict PKCE for the Tenant GPT client without changing MCP behavior. If the dedicated writer fails its readiness probe, disable `CONTROL_PLANE_WRITE_AUTHORITY_ENABLED` and keep the scheduler/inventory features explicitly degraded until the database owner repairs the grant contract.

## Acceptance matrix

| Test | Expected result |
|---|---|
| Missing or short `TENANT_GPT_SSO_SIGNING_SECRET` | Startup remains fail-closed |
| GPT Action authorize without PKCE, exact client ID, valid state | Authorization UI may proceed; token exchange requires client secret |
| Arbitrary client authorize without PKCE | `oauth_pkce_required` |
| MCP authorize without PKCE | `oauth_pkce_required` |
| Wrong client secret | `invalid_client` |
| Authorization-code replay | `invalid_grant` |
| Dedicated writer enabled with missing keys | Preflight blocked; no fallback |
| Dedicated writer identity equals `DB_USER` or root | Preflight/config resolution blocked |
| Production parity manifest branch `Production` | Trigger normalization accepts deployment branch |
| Staging branch `main` presented to Production reconciler | Readiness remains degraded/skipped; no implicit promotion |
| Missing `mcp_catalog_level` | Catalog readiness false with `mcp_catalog_schema_migration_required`; no silent `core` fallback |
| Staging Admin schema import | Exactly one `backendApiKeyAuth` scheme, one `dev.mad4b.com` server, GET-only operations |
| Generated staging-admin artifact drift | CI fails before promotion; no manual generated-file edits are accepted |
