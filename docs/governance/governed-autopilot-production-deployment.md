# Governed AutoPilot for Staging and Production Deployment

## Purpose

This document defines the single governed automation path for the Windows External SSD Staging environment and the protected Hostinger Production promotion path. It consolidates the operational failures observed during the Activation Gateway rollout into deterministic controls rather than operator memory.

The design deliberately keeps **Staging execution**, **Production promotion**, **Production GET-only runtime readback**, and **manual MCP protocol readback** as separate authorities. Local AutoPilot may clone or update the repository, generate local-only secrets, start Docker services, and start the dedicated Staging Tunnel. It must never mutate Production DNS, Hostinger, Production databases, or Cloudflare provider state.

## Findings converted into controls

| Observed failure or race | Governed control |
|---|---|
| AutoPilot was started with only `-Ref main` | Require an exact 40-character `-ExpectedCommit`; reject ref-only execution |
| Local `Install-AutoDeployTask.ps1` used `InteractiveToken` | Contract-test the installer and require Windows PowerShell `Interactive` logon type |
| A manually created `.backup` file blocked integrity checks | Quarantine only known AutoPilot backup files outside the repository; fail closed on all other dirty files |
| Activation Gateway env keys were missing | Generate the local Activation OAuth secret and repair non-secret host defaults without printing secrets |
| `SecureString` conversion produced an empty value | Generate local-only secrets using the OS cryptographic RNG and validate non-empty length without echoing values |
| Tunnel scope could accidentally include Activation or Production | Require exactly `dev.mad4b.com,mcp_dev.mad4b.com`; route `activation-dev.mad4b.com` only through its independent Worker |
| Hostinger runtime started without SSO signing secret | Production startup contract requires a dedicated `TENANT_GPT_SSO_SIGNING_SECRET` of at least 32 characters; Production automation must never invent it |
| Hostinger deployment returned repeated 503/readback failure | Keep promotion non-current and classify the failing authority instead of treating Git promotion as runtime activation |
| MCP OAuth metadata can fail closed when ingress trust is incomplete | Require the three-part trusted-ingress contract and test it under Production semantics |
| Root discovery trusted forwarded host headers independently from MCP | Route all external-host selection through one shared trusted-host authority |
| Repository DNS policy assumed one record type while provider evidence used another | Treat proxied `A` and `CNAME` as an allowed set when both terminate on the governed Hostinger Production origin |
| General runtime health can be green while ChatGPT OAuth discovery is broken | R7 remains GET-only but now probes both protected-resource and authorization-server metadata |
| MCP transport itself still needs a real handshake | Provide a separate owner-authorized exact-SHA MCP `initialize` readback that performs no authentication, tool call, provider mutation, SQL, or migration |
| CI evidence could belong to another attempt or moving ref | Pin candidate, validation base, and `main` by exact SHA; verify source-pin freshness before and after CI |

## State machine

```text
candidate discovered
        |
        v
exact SHA + protected-ref checks
        |
        v
source-pinned CI and generated-artifact evidence
        |
        +--> fail: stop; no deployment
        |
        v
explicit authorized Production promotion
        |
        v
Hostinger build/deployment evidence
        |
        v
R7 bounded GET-only runtime/OAuth readback
        |
        +--> trusted ingress missing: trusted_ingress_attestation_required
        |
        +--> identity 503 / SHA mismatch: runtime_activation_pending_or_sha_mismatch
        |
        +--> OAuth metadata mismatch: oauth_discovery_not_ready
        |
        +--> exact SHA + Production branch + OAuth discovery
                                  |
                                  v
                         production_current
                                  |
                                  v
optional separately authorized exact-SHA MCP initialize readback
        |
        +--> failure: mcp_transport_not_ready
        |
        +--> success: mcp_initialize_ready
```

`production_current` and `mcp_initialize_ready` are intentionally separate pieces of evidence. Client-facing Remote MCP readiness requires both to refer to the same still-current Production SHA; the GET-only R7 authority is not widened into a POST authority.

## Production secret boundary

`TENANT_GPT_SSO_SIGNING_SECRET` is not a generated local-development value when the target is Production. It must be provisioned through the authorized Hostinger Production secret/configuration mechanism and must be at least 32 characters. The deployment controller may validate presence through a no-secret contract or startup evidence, but it must not print, copy, derive, or replace the Production value.

The repeated Hostinger error:

> A dedicated TENANT_GPT_SSO_SIGNING_SECRET with at least 32 characters is required.

is therefore a **preflight configuration failure**, not a reason to weaken the application guard or generate a substitute in CI. Queue-disabled notices remain a separate capability warning when `REDIS_URL` and `QUEUE_WORKER_ENABLED` are intentionally absent; they must not be confused with the fatal SSO startup failure.

## Trusted ingress boundary

Production OAuth metadata is intentionally fail-closed. The canonical deployment environment documents three independent controls:

- `REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true` only when the edge is trusted to set the canonical forwarded host.
- `REMOTE_MCP_TRUSTED_INGRESS_ATTESTED=true` only after the active Production ingress is explicitly verified.
- `REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true` only after caller-supplied `x-forwarded-host` and `x-original-host` values are proven to be removed before the application sees them.

All three are required in Production-like environments. Missing attestation is classified separately from deployment/SHA mismatch. The MCP authorization-server metadata route and the protected-resource metadata route are both covered by the same trusted-ingress authority.

All public host-sensitive routing uses the same resolver. When forwarded-host trust is disabled, caller-controlled `x-forwarded-host` and `x-original-host` values are ignored and the direct `Host`/`:authority` value is authoritative. When trust is enabled, malformed, multi-valued, credential-bearing, or path-bearing forwarded host values fail closed rather than falling back to a less-trusted value.

## Production DNS authority

The architectural invariant is not one DNS record syntax. Production `auth`, `mcp`, and `activation` hostnames must remain proxied through Cloudflare and terminate on the governed Hostinger Production origin. The repository therefore permits `A` or `CNAME` for those Production hostnames and marks the legacy `dns_record_type` value as preferred rather than exclusive.

This repository-only contract change does **not** mutate Cloudflare. Provider state must be read back separately. A provider record outside the allowed set, an unproxied record, or a record whose effective origin is not Hostinger Production is a mismatch and must fail closed until separately authorized provider repair is performed.

## R7 GET-only readback contract

R7 is a bounded **public GET-only** readback and remains `mad4b.hostinger-production-runtime-readback-r7.v1`. It is not a deployment, provider mutation, or MCP POST workflow. The Production runtime is considered current only when all of the following are true for the same authorized SHA:

1. The protected `Production` ref still equals the expected 40-character SHA.
2. `/health`, `/version`, `/deployment-info`, and `/connector-agent/version` return HTTP 200.
3. `/version` contains the expected SHA.
4. `/deployment-info` reports the expected commit SHA.
5. `/deployment-info` reports branch `Production`.
6. `https://mcp.mad4b.com/.well-known/oauth-protected-resource` returns the canonical MCP resource, the canonical authorization server, and `trusted_ingress.ready=true`.
7. `https://auth.mad4b.com/.well-known/oauth-authorization-server/auth/mcp` returns the canonical issuer and token/authorization endpoints with `trusted_ingress.ready=true`.
8. The readback report classifies the result as `production_current`.
9. The report proves public GET-only collection, no provider mutation, no deployment action, no SQL or migration execution, and no secrets included.

A 503, missing runtime identity, branch mismatch, SHA mismatch, trusted-ingress failure, or OAuth discovery mismatch is a closed negative result. The controller may poll GET readback within a bounded window, but it must not repeat provider mutation merely because the first readback is not yet current.

## Owner-authorized MCP initialize readback

The transport handshake is verified by `.github/workflows/hostinger-production-mcp-initialize-readback.yml`, not by R7. It can run only from an owner comment whose entire body pins the current Production SHA:

```text
RUN_HOSTINGER_PRODUCTION_MCP_INITIALIZE_READBACK expected_production_sha=<40-char-production-sha>
```

The workflow re-reads `Production` before and after the probe and stops if the SHA differs. Its only network operation is an unauthenticated JSON-RPC `initialize` request to `https://mcp.mad4b.com/mcp` with protocol `2025-06-18`. It does not request an OAuth token, call a tool, read provider credentials, deploy, restart, execute SQL, apply a migration, mutate a database, or send an external business action.

Successful evidence is classified `mcp_initialize_ready`; otherwise it is `mcp_transport_not_ready`. This evidence must be paired with a still-current R7 result for the same Production SHA before claiming end-to-end Remote MCP client readiness.

## Failure classifications

| Classification | Meaning |
|---|---|
| `production_current` | Exact Production SHA/branch, runtime identity, OAuth discovery, and trusted ingress are current under GET-only R7 |
| `trusted_ingress_attestation_required` | OAuth discovery reached the runtime but the Production ingress trust contract is incomplete |
| `runtime_sha_current_branch_provenance_mismatch` | Runtime SHA is current but branch provenance is not `Production` |
| `runtime_activation_pending_or_sha_mismatch` | Core runtime identity endpoints are unavailable or do not expose the exact Production SHA |
| `oauth_discovery_not_ready` | Runtime identity is current but MCP protected-resource or authorization-server metadata is not exact/ready |
| `mcp_initialize_ready` | Separately authorized exact-SHA MCP initialize handshake succeeded without authentication or tool execution |
| `mcp_transport_not_ready` | Separately authorized exact-SHA MCP initialize handshake did not meet the transport contract |
| `runtime_parity_incomplete` | Bounded fallback for an unclassified incomplete R7 parity state |

## Acceptance criteria

| Area | Required acceptance condition |
|---|---|
| Windows AutoPilot | Exact SHA, local Docker context, WSL2 readiness, clean protected tree, manifest parity, and redacted operation logs |
| Local environment | `.env.staging` is ignored, duplicate keys are rejected, mutation flags remain false, and local secrets are never echoed |
| Activation Gateway | Explicit opt-in, dedicated local OAuth secret, `activation-dev.mad4b.com` host defaults, independent Worker routing |
| Tunnel | Only `dev.mad4b.com` and `mcp_dev.mad4b.com`, with unmatched-host denial and no Production hostnames |
| Production candidate | Exact candidate/base/main pinning, successful exact-head CI, and no provider mutation during validation |
| Production startup | Dedicated SSO signing secret present and valid; no fallback or generated substitute |
| Production trusted ingress | All three ingress controls are explicitly satisfied before Production OAuth metadata is served |
| Host selection | One shared resolver governs MCP and root discovery; untrusted or malformed forwarded host values cannot select another surface |
| Production DNS | Proxied `A` or `CNAME` only, with effective origin constrained to Hostinger Production and provider parity separately verified |
| OAuth discovery | Canonical protected-resource and authorization-server metadata are public and exact under R7 GET-only readback |
| Production runtime current | R7 proves exact SHA, Production branch, runtime health, trusted ingress, OAuth discovery, and `production_current` |
| MCP transport | Separately authorized exact-SHA initialize readback returns `mcp_initialize_ready` without auth or tool execution |
| End-to-end Remote MCP client readiness | A still-current R7 `production_current` result and `mcp_initialize_ready` evidence refer to the same Production SHA |
| Recovery | Pending runtime activation produces evidence and a bounded retry/readback path, not an unbounded deployment loop |

## Operational rule

The safe order is **validate → pin → build/promote once → poll GET-only R7 → classify → optionally authorize exact-SHA MCP initialize readback → stop or report**. Any R7 failure keeps the release non-current. Any initialize failure keeps MCP transport unverified even when the core runtime is current. Local Staging may continue independently, but it must not be used as evidence that Hostinger Production has activated the same commit.

## Scope and non-goals

This contract does not rotate a Production secret, apply a database migration, change Cloudflare DNS, restart Hostinger, or perform a Production deployment by itself. The optional MCP initialize readback is a bounded non-mutating protocol handshake and requires its own exact-SHA owner trigger. Provider mutations remain explicit, separately authorized actions with their own evidence and readback requirements.
