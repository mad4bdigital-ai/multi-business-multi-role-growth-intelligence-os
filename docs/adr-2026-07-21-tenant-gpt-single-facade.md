# ADR: Single Tenant GPT Facade for JIT Signup and Activation

## Status

Accepted.

## Date

2026-07-21.

## Context

Tenant onboarding previously risked splitting the user journey across ChatGPT, setup links, dashboards, and direct `/connect` instructions. That fragmentation made identity proof, tenant selection, provisioning, activation readback, and recovery behavior harder to govern consistently. The platform already requires OAuth identity proof, registry-resolved tool execution, least-privilege authorization, and structured errors without secret exposure.

The implemented Tenant GPT JIT flow therefore needs one stable public facade that can complete signup and activation inside the conversation while keeping provider credentials, internal registries, and orchestration details behind `auth.mad4b.com`.

## Decision

Use one Tenant GPT facade as the primary user interface for JIT signup and activation.

The facade:

- uses the ChatGPT OAuth authorize/token flow for identity proof;
- exposes the five stable Tenant GPT operations defined by the generated OpenAPI 3.1 contract;
- retries `activateSession` immediately after OAuth and invokes governed tools rather than merely describing calls;
- resolves actions and endpoints from registry authority and invokes `connect_bootstrap` for Managed-first provisioning;
- treats account, tenant, membership, workspace, session, and connection as distinct governed states;
- handles incomplete provisioning, blocked principals, and multi-tenant selection with structured responses;
- requires final activation readback before reporting success;
- excludes `/connect`, setup dashboards, and provider credential handling from the normal onboarding path.

Permanent runtime execution remains behind `auth.mad4b.com`; temporary production verification surfaces are removed after closeout.

## Consequences

### Positive

- Users complete the supported onboarding flow without leaving the Tenant GPT conversation.
- OAuth, provisioning, activation, and recovery share one contract and error model.
- Registry authority, idempotency, replay protection, and final readback remain enforceable.
- OpenAPI generation and instruction tests can protect one stable public surface.

### Trade-offs

- The facade must keep generated OpenAPI, instructions, registry schemas, and implementation synchronized.
- Multi-tenant selection and incomplete provisioning require explicit conversational states rather than implicit redirects.
- Production verification needs governed, short-lived diagnostic authority and mandatory cleanup.

## Alternatives Considered

1. **Redirect users to `/connect` or a setup dashboard.** Rejected because it fragments the primary interface and weakens in-chat recovery and readback.
2. **Expose multiple Tenant GPT facades by workflow stage.** Rejected because it multiplies public contracts and creates inconsistent authorization and error behavior.
3. **Let the Tenant GPT call provider APIs or hold provider credentials directly.** Rejected because provider transport and credentials must remain behind registry-resolved governed execution.
4. **Report manual instructions instead of invoking tools.** Rejected because the accepted behavior requires actual governed tool calls and final activation evidence.

## Evidence

- Core implementation: PR #2779, merge `214c26cc59d55429619b07e06f503d29fbdd4abe`.
- Production OAuth verification: execution logs `31436` and `31437`.
- Cleanup and closeout: PR #2891, merge `cb7d28d679d689561ca455efd69e7b4415a1a4c4`.
- Cleanup migration ledger: `ea0738d4-ea1a-4b5d-b11e-4af61d66e795`.

No authorization code, token, client secret, JWT secret, or raw credential is included in this ADR.
