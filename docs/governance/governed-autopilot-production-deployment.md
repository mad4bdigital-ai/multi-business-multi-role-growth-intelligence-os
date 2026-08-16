# Governed AutoPilot for Staging and Production Deployment

## Purpose

This document defines the governed automation and readback boundaries for the Windows External-SSD Staging environment and the protected Hostinger Production promotion path. It converts the failures observed during the Activation Gateway and Remote MCP/OAuth rollout into deterministic repository contracts rather than operator memory.

The authorities remain deliberately separated:

- **Staging execution** may manage only the pinned local Staging tree, local secrets, Docker services, and the dedicated Staging Tunnel/Worker boundary.
- **Production promotion** remains a separately authorized exact-candidate operation.
- **Hostinger Production Runtime Readback R7** remains strictly **GET-only** and may only determine whether the promoted Production runtime and public OAuth discovery are current.
- **Live MCP POST/transport verification is not implemented by this PR or by R7.** A real `POST /mcp` initialize handshake remains a separately authorized operational verification after merge/deployment and must not be inferred from GET-only evidence.

No source change in this PR authorizes Cloudflare, Hostinger, DNS, database, migration, secret-rotation, or Production deployment mutation.

## Findings converted into controls

| Observed failure or race | Governed control |
|---|---|
| AutoPilot was started with only `-Ref main` | Require an exact 40-character `-ExpectedCommit`; reject ref-only execution |
| Local Scheduled Task used an obsolete logon value | Contract-test the installer and require the supported `Interactive` logon form |
| Known AutoPilot backup files blocked integrity checks | Quarantine only known backup files outside the repository; fail closed on every unknown dirty file |
| Staging Activation env keys or local secrets were missing | Generate only local ignored secrets and repair only non-secret Staging defaults without printing secret values |
| Staging Tunnel scope could include Activation or Production | Keep Tunnel ingress limited to `dev.mad4b.com` and `mcp_dev.mad4b.com`; keep `activation-dev.mad4b.com` on its independent Worker |
| Hostinger runtime started without the SSO signing secret | Require the dedicated Production secret as a startup/preflight contract; never invent a Production substitute in CI |
| Git promotion succeeded while public runtime returned 503 | Treat branch promotion and runtime activation as separate states; R7 must remain negative until public identity endpoints prove the exact SHA/branch |
| MCP OAuth metadata can fail closed when ingress trust is incomplete | Require the three-part trusted-ingress contract and test it under Production semantics |
| Root discovery trusted forwarded-host input differently from MCP | Route host-sensitive public surfaces through one shared trusted-host authority |
| Repository DNS policy assumed one record type while provider evidence used another | Make the invariant proxied Hostinger Production routing with an explicit `A`/`CNAME` allowed set, without mutating provider state |
| General runtime health can be green while ChatGPT OAuth discovery is broken | Extend GET-only R7 to verify both MCP protected-resource and OAuth authorization-server metadata |
| A maintenance PR touched an already-integrated parallel feature | Permit only one explicit schema-valid single-PR maintenance contract that covers every changed runtime file and declares `secrets_included=false` |
| The maintenance gate required a field forbidden by its own schema | Add optional `secrets_included` to the E2E schema with `const:false` and regression-test the maintenance path |

## Trusted ingress boundary

Production OAuth metadata is fail-closed. All three controls are required in Production-like environments:

```text
REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true
REMOTE_MCP_TRUSTED_INGRESS_ATTESTED=true
REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true
```

They mean different things and must not be collapsed into one flag:

1. forwarded-host headers may be used only when the deployment edge is trusted to establish the external host;
2. the active Production ingress itself has been explicitly attested;
3. caller-supplied forwarded/original host headers are stripped before the application sees the trusted values.

When forwarded-host trust is disabled, caller-controlled `x-forwarded-host` and `x-original-host` values are ignored. When trust is enabled, malformed, multi-valued, credential-bearing, or path-bearing host input fails closed instead of falling back to a weaker authority.

The MCP protected-resource metadata and path-scoped authorization-server metadata are both subject to this authority under Production semantics.

## Production DNS authority

The architectural invariant is not a single DNS syntax. Production `auth`, `mcp`, and `activation` hostnames must be proxied by Cloudflare and terminate on the governed Hostinger Production origin. Repository policy therefore allows `A` or `CNAME` as an explicit set and treats the legacy `dns_record_type` value as preferred rather than exclusive.

This is a repository contract only. It does **not** change Cloudflare. Provider state still requires separate readback; a non-allowed type, an unproxied record, or an effective origin outside Hostinger Production is a mismatch and must remain blocked until separately authorized provider repair.

## R7 GET-only contract

`.github/workflows/hostinger-production-runtime-readback-r7.yml` remains a bounded GET-only authority. It must not contain a POST request or mutate any provider/runtime state.

For one exact Production SHA it verifies:

1. protected `Production` still equals the expected SHA;
2. `/health`, `/version`, `/deployment-info`, and `/connector-agent/version` are HTTP 200;
3. version/deployment identity reports the exact Production SHA;
4. deployment branch provenance is `Production`;
5. `https://mcp.mad4b.com/.well-known/oauth-protected-resource` is HTTP 200 and advertises the canonical MCP resource and authorization server with trusted ingress ready;
6. `https://auth.mad4b.com/.well-known/oauth-authorization-server/auth/mcp` is HTTP 200 and advertises the canonical issuer/authorization/token endpoints with trusted ingress ready;
7. no provider mutation, deployment, database mutation, SQL, migration, or secret payload access is performed.

The bounded classifications include:

- `production_current`
- `trusted_ingress_attestation_required`
- `runtime_sha_current_branch_provenance_mismatch`
- `runtime_activation_pending_or_sha_mismatch`
- `oauth_discovery_not_ready`
- `runtime_parity_incomplete`

A 503 or OAuth discovery mismatch is a closed negative result. R7 may be retried/read back within its governed lifecycle, but it may not repeat deployment/provider mutation merely because runtime activation is pending.

## MCP transport verification boundary

A real ChatGPT-compatible MCP transport handshake uses `POST /mcp`. The repository governance repair on this branch explicitly preserved R7 as GET-only and removed an attempted POST readback workflow. Therefore this PR **does not claim live MCP transport readiness**.

After the repository changes are merged, Production is activated, R7 is current, and provider configuration is separately verified, an operator may perform a separately authorized bounded MCP `initialize` verification against the exact still-current Production SHA. That verification is outside this PR's GET-only readback authority and must have its own explicit authorization/evidence. It must not be silently added to R7 or inferred from OAuth metadata success.

## Single-PR maintenance contract

The E2E governance layer supports maintenance on an already-integrated parallel feature only when one unique `.changes/e2e/*.json` contract satisfies all of the following:

- `delivery_mode == "single_pr"`;
- the current phase is `implemented`;
- `secrets_included == false` explicitly;
- its scope covers every changed runtime file in the PR;
- every affected parallel contract is already fully integrated.

The schema now permits the safety declaration only as `false`; it remains optional for unrelated historical contracts so the schema change does not retroactively invalidate them. A dedicated regression creates a temporary integrated parallel feature and proves that a safe complete maintenance contract is accepted while an otherwise identical contract without the explicit secret-safety declaration is rejected.

## Acceptance criteria

| Area | Required acceptance condition |
|---|---|
| Staging AutoPilot | Exact SHA, local Docker context, clean protected tree, manifest parity, redacted logs |
| Staging boundary | Production hostnames absent from local Tunnel; Activation uses its independent Worker boundary |
| Production candidate | Exact candidate/source pins and no provider mutation during validation |
| Production startup | Dedicated SSO signing secret present through authorized Production configuration |
| Trusted ingress | All three ingress controls satisfied before Production OAuth metadata is served |
| Host selection | One shared resolver governs MCP/root discovery and forwarded-host spoofing fails closed |
| Production DNS policy | Proxied Hostinger origin with only `A` or `CNAME` permitted by repository policy |
| OAuth discovery | Canonical protected-resource and authorization-server metadata succeed under GET-only R7 |
| E2E maintenance governance | One explicit `secrets_included=false` maintenance contract covers every changed runtime file |
| Production current | Exact SHA/branch + identity endpoints + trusted ingress + OAuth discovery all pass R7 |
| MCP transport | Not claimed by this PR; separately authorized live POST verification remains outstanding |

## Operational rule

The safe order is:

```text
validate repository
→ pin exact candidate
→ separately authorize promotion/deployment
→ run GET-only R7
→ classify runtime/OAuth state
→ separately verify provider configuration
→ separately authorize live MCP POST transport verification when required
```

No failure in a later step may be converted into an implicit provider retry or a relaxation of an earlier security contract.
