# Staging Schema Contract Matrix

## Contract rule

Every public Staging schema is an independent OpenAPI document with **exactly one** `servers` entry. A schema is never made multi-host by adding a second `server.url`. A new hostname or protocol surface receives a new schema filename, a new generated artifact, and an independent discovery binding.

| Surface | Host / server URI | Independent schema | Authentication contract | Write posture |
|---|---|---|---|---|
| Tenant Custom GPT | `https://dev.mad4b.com` | `openapi.tenant-gpt.staging.yaml` | Dedicated Staging Tenant GPT OAuth client and `TENANT_GPT_STAGING_*` settings | Governed Staging contract; no Production pairing |
| Admin Custom GPT | `https://dev.mad4b.com` | `openapi.custom-gpt.staging-admin.yaml` | Backend bearer or user JWT; separate Admin read-only projection | GET-only; Admin writes remain shadow/blocked |
| Remote MCP | `https://mcp_dev.mad4b.com` | `openapi.remote-mcp.staging.yaml` | Remote MCP OAuth 2.1 through `https://dev.mad4b.com/auth/mcp` | Runtime scope/approval governance; write activation false |

The fact that Tenant and Admin use the same `dev.mad4b.com` server does not combine them into one contract. They remain separate documents with distinct titles, surface metadata, path sets, and security semantics. The `mcp_dev.mad4b.com` artifact is deliberately a **Remote MCP protocol document**, not a Tenant or Admin Custom GPT Action schema.

## Discovery behavior

The `dev.mad4b.com` root discovery contract advertises both `openapi.tenant-gpt.staging.yaml` and `openapi.custom-gpt.staging-admin.yaml`. The `mcp_dev.mad4b.com` discovery contract advertises only `openapi.remote-mcp.staging.yaml`. Cross-surface schema requests return `404`, so a Tenant schema cannot be fetched through the MCP host and the Admin schema cannot be fetched through the MCP host.

The Tenant OAuth preset remains available only on `dev.mad4b.com`. The MCP OAuth resource remains on `mcp_dev.mad4b.com` with its authorization issuer on `dev.mad4b.com/auth/mcp`. No Admin OAuth client secret is introduced; Admin uses the existing bearer/JWT security scheme and the new Staging Admin artifact is read-only.

## Safety invariants

All three generated documents carry `x-mad4b-environment: staging`, `server_uri_count: 1`, `secrets_included: false`, and a reference to the authoritative domain-family policy. The generated artifacts reject Production and reserved-disabled hostnames. The Admin generator allows only GET operations, and the Remote MCP generator sets `write_activation: false`. No DNS, Hostinger, Production OAuth, database, or provider mutation is part of this contract.
