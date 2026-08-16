# Governed AutoPilot for Staging and Production Deployment

## Purpose

This document defines the single governed automation path for the Windows External SSD Staging environment and the protected Hostinger Production promotion path. It consolidates the operational failures observed during the Activation Gateway rollout into deterministic controls rather than operator memory.

The design deliberately keeps **Staging execution**, **Production promotion**, and **Production runtime readback** as separate authorities. Local AutoPilot may clone or update the repository, generate local-only secrets, start Docker services, and start the dedicated Staging Tunnel. It must never mutate Production DNS, Hostinger, Production databases, or Cloudflare provider state.

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
| Hostinger deployment returned repeated 503/readback failure | Classify as `runtime_activation_pending_or_sha_mismatch` and keep promotion non-current until bounded public readback proves exact SHA, branch, and HTTP success |
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
bounded R7 public GET readback
        |
        +--> 503 / SHA mismatch: runtime_activation_pending_or_sha_mismatch
        |                         no retry of mutation
        |
        +--> exact SHA + Production branch + all HTTP 200
                                  |
                                  v
                         production_current
```

## Production secret boundary

`TENANT_GPT_SSO_SIGNING_SECRET` is not a generated local-development value when the target is Production. It must be provisioned through the authorized Hostinger Production secret/configuration mechanism and must be at least 32 characters. The deployment controller may validate presence through a no-secret contract or startup evidence, but it must not print, copy, derive, or replace the Production value.

The repeated Hostinger error:

> A dedicated TENANT_GPT_SSO_SIGNING_SECRET with at least 32 characters is required.

is therefore a **preflight configuration failure**, not a reason to weaken the application guard or generate a substitute in CI. Queue-disabled notices remain a separate capability warning when `REDIS_URL` and `QUEUE_WORKER_ENABLED` are intentionally absent; they must not be confused with the fatal SSO startup failure.

## R7 readback contract

The Production runtime is considered current only when all of the following are true for the same authorized SHA:

1. The protected `Production` ref still equals the expected 40-character SHA.
2. `/health`, `/version`, `/deployment-info`, and `/connector-agent/version` return HTTP 200.
3. `/version` contains the expected SHA.
4. `/deployment-info` reports the expected commit SHA.
5. `/deployment-info` reports branch `Production`.
6. The readback report classifies the result as `production_current`.
7. The report proves public GET-only collection, no provider mutation, no deployment action, no SQL or migration execution, and no secrets included.

A 503, missing runtime identity, branch mismatch, or SHA mismatch is a closed negative result. The controller may poll readback within a bounded window, but it must not repeat the provider mutation merely because the first readback is not yet current.

## Acceptance criteria

| Area | Required acceptance condition |
|---|---|
| Windows AutoPilot | Exact SHA, local Docker context, WSL2 readiness, clean protected tree, manifest parity, and redacted operation logs |
| Local environment | `.env.staging` is ignored, duplicate keys are rejected, mutation flags remain false, and local secrets are never echoed |
| Activation Gateway | Explicit opt-in, dedicated local OAuth secret, `activation-dev.mad4b.com` host defaults, independent Worker routing |
| Tunnel | Only `dev.mad4b.com` and `mcp_dev.mad4b.com`, with unmatched-host denial and no Production hostnames |
| Production candidate | Exact candidate/base/main pinning, successful exact-head CI, and no provider mutation during validation |
| Production startup | Dedicated SSO signing secret present and valid; no fallback or generated substitute |
| Production readback | R7 proves exact SHA, Production branch, all required HTTP responses, and `production_current` |
| Recovery | Pending runtime activation produces evidence and a bounded retry/readback path, not an unbounded deployment loop |

## Operational rule

The safe order is **validate → pin → build/promote once → poll readback → classify → stop or report**. Any failure before `production_current` keeps the release non-current. Local Staging may continue independently, but it must not be used as evidence that Hostinger Production has activated the same commit.

## Scope and non-goals

This contract does not rotate a Production secret, apply a database migration, change Cloudflare DNS, restart Hostinger, or perform a Production deployment by itself. Those operations remain explicit, separately authorized actions with their own evidence and readback requirements.
