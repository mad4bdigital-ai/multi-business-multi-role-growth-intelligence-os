# Spec 017 — Remote MCP Host Isolation and OAuth Live Readiness

This Spec Kit defines the bounded corrections required to make the existing Remote MCP/OAuth 2.1 implementation safe to expose through the canonical public resource `https://mcp.mad4b.com` and issuer `https://auth.mad4b.com/auth/mcp`.

## Why this spec exists

Repository analysis on the pinned baseline `main@a722609b45ab3ac4617096963380ab4e1434f17d` found a routing asymmetry:

- the Remote MCP `/mcp` route is path-based and does not prove that the incoming request is on the configured canonical MCP resource host;
- protected-resource discovery is host-aware and can fall through to the existing Tenant GPT/Activation OAuth contract for a non-MCP host;
- as a result, a wrong-host URL such as `https://auth.mad4b.com/mcp` can appear to be an MCP endpoint while OAuth discovery resolves to a different resource contract;
- Dynamic Client Registration is implemented but is intentionally not advertised until its feature flag and exact redirect-origin policy are both ready;
- the OAuth persistence migration, signing-secret provisioning, public DNS/TLS/routing, and live client acceptance remain operational gates rather than source-code facts.

## Objective

Create one fail-closed resource boundary where:

1. only the canonical MCP resource host can serve `/mcp`;
2. OAuth protected-resource discovery never silently falls across resource families;
3. trusted proxy host resolution is centralized and testable;
4. operators can read Remote MCP readiness without secrets;
5. deployment configuration documents every required `REMOTE_MCP_*` setting;
6. DCR, migration, secret, DNS/TLS, and live client acceptance remain separately governed rollout steps;
7. no source-only change is treated as proof of production readiness.

## Canonical topology

```text
MCP resource:       https://mcp.mad4b.com
MCP endpoint:       https://mcp.mad4b.com/mcp
OAuth issuer:       https://auth.mad4b.com/auth/mcp
Authorization:      https://auth.mad4b.com/auth/mcp/oauth/authorize
Token:              https://auth.mad4b.com/auth/mcp/oauth/token
Registration:       https://auth.mad4b.com/auth/mcp/oauth/register
Revocation:         https://auth.mad4b.com/auth/mcp/oauth/revoke
AS metadata:        https://auth.mad4b.com/.well-known/oauth-authorization-server/auth/mcp
Resource metadata:  https://mcp.mad4b.com/.well-known/oauth-protected-resource
```

## Delivery boundary

This branch is specification-only. It must not:

- deploy any runtime;
- apply any migration;
- provision or read any secret;
- mutate DNS, TLS, Hostinger, reverse proxy, or another provider;
- enable Remote MCP, OAuth, or DCR feature flags;
- register a live OAuth client;
- create a ChatGPT, Claude, Inspector, or generic-client connection;
- merge to `Production`;
- force-push any branch.

Implementation is expected in a separate implementation branch/PR after this specification is reviewed.

## Files

- `spec.md` — problem statement, requirements, success criteria, and boundaries.
- `plan.md` — implementation and governed rollout plan.
- `tasks.md` — ordered implementation tasks.
- `operation-paths.md` — normative request and rollout paths.
- `concerns.md` — security, routing, proxy, OAuth, and operational risks.
- `testing-strategy.md` — unit, integration, synthetic, and live acceptance requirements.
- `e2e-phases.json` — machine-readable E2E phases.
- `manifest.json` — Spec Kit inventory and boundaries.
- `completion.json` — current delivery state and closeout evidence.
- `checklists/requirements.md` — review checklist.
- `implementation-handoff.md` — exact handoff for the implementation PR.
