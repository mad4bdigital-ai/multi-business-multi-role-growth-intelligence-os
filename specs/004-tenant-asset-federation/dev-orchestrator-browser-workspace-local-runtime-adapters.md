# Dev Orchestrator Browser, Workspace and Local Runtime Adapters

**Status:** design-only adapter specification. No browser automation, Workspace API call, runtime installation, or provider execution is authorized here.

## 1. Adapter classes

| Adapter class | Examples | Transport class |
|---|---|---|
| Browser agent bridge | ChatGPT Custom GPT, Gemini Gem | `browser_automation` |
| Official agent API | ChatGPT Workspace Agents API | `official_agent_api` |
| Connected platform app | Mad4B MCP app in ChatGPT Workspace | `official_connected_app` |
| Local/managed agent runtime | Hermes, OpenClaw | `managed_local_runtime` |
| Model API | OpenRouter, direct model APIs | `official_model_api` |
| Local model endpoint | Ollama or OpenAI-compatible local endpoint | `local_model_api` |

Adapter selection is separate from logical-agent and model-provider selection.

## 2. ChatGPT Custom GPT Browser Bridge

The binding targets the existing Tenant Assistant Custom GPT by stable GPT reference. The bridge may support user-initiated interactive orchestration and, after separate acceptance, n8n or scheduled execution.

Required controls:

- user-owned login and explicit connection consent;
- one profile per user identity;
- no shared cookies or credentials;
- exact target-GPT verification after navigation;
- bounded queue and lease per account;
- explicit conversation reuse policy;
- DOM state machine for login, generating, tool activity, confirmation, completion, rate limit and error;
- output stabilization and platform validation before completion;
- no direct external effects from browser text.

Selectors are adapter implementation details and cannot enter workflow definitions or registry authority.

## 3. Gemini Custom Gem Browser Bridge

The Gem bridge uses equivalent isolation and state controls, plus:

- verification that the authenticated Google identity has access to the target Gem;
- separation of Gem references from Drive knowledge permissions;
- detection of access revocation and account switching;
- no assumption that Gem instructions are retrievable or portable;
- platform redaction before sending tenant context;
- exact-surface fallback behavior when the Gem is unavailable.

A future official Gem invocation API may replace the browser transport without changing the logical agent or workflow.

## 4. ChatGPT Workspace Agent

When the user's Business or Enterprise workspace supports Workspace Agents API, the platform may select an official API binding.

The Workspace Agent access token authorizes the API transport only. Tenant data and platform actions remain authorized through the Mad4B connected app identity and platform policies.

Design sequence:

```text
n8n / scheduler / platform
→ Workspace Agents API trigger
→ published Workspace Agent
→ Mad4B connected app / MCP tools
→ platform context, sub-agents and approvals
→ callback/readback
```

API limitations must be represented as capabilities rather than assumed. If direct result retrieval is unavailable, the agent uses a registered platform callback or MCP write tool that stores a validated result envelope.

## 5. Mad4B connected app

The connected app exposes bounded tool groups:

### Read

- resolve tenant/session context;
- read Brand Core and allowed assets;
- list eligible agents and workflows;
- read orchestration status and results;
- read pending insights and approvals.

### Propose

- create an orchestration proposal;
- store a recommendation;
- request an approval;
- create a workflow proposal.

### Act

- start or resume only a platform-approved workflow;
- execute only through capability envelope, approval, idempotency and readback gates.

The app never exposes arbitrary SQL, arbitrary HTTP, unrestricted n8n webhooks, shell, credential reads, repository writes or provider keys.

## 6. Hermes runtime

Hermes is modeled as an agent runtime with skills, sessions, memory, gateways, cron and selectable model endpoints. It may run locally or in an approved dedicated managed environment.

Terminal, file, browser, messaging and skill-install capabilities are disabled unless separately allowlisted. Model selection is resolved through the platform provider catalog and runtime profile, not hard-coded in the Hermes agent.

## 7. OpenClaw runtime

OpenClaw is modeled as an agent/channel gateway with session and multi-agent routing. It may serve messaging or personal-agent entrypoints while the platform remains the authority for tenant context, sub-agent eligibility, tools and effects.

Channel identity must map to a platform principal before any tenant resource is exposed.

## 8. Health and readiness

Common health evidence:

- adapter version and certification;
- runtime reachability;
- identity/connection status;
- supported trigger and mode set;
- tool-profile compatibility;
- queue and capacity;
- readback readiness;
- recent success/failure rates;
- privacy and retention profile.

Browser-specific evidence adds login, challenge, UI compatibility and target-surface verification. Local runtimes add device health, sandbox, installed runtime and model capacity. Official APIs add scope, quota and endpoint capability.

## 9. Failure classes

```text
connection_missing
session_expired
access_revoked
challenge_required
surface_changed
runtime_unreachable
provider_unavailable
quota_exhausted
output_validation_failed
callback_failed
readback_failed
unknown_or_partial_effect
```

Each failure maps to retry, fallback, approval, recovery or terminal block. Unknown or partial effects never receive automatic cross-adapter fallback.

## 10. Security boundary

The platform sends only purpose-bound, minimized context. Credentials remain behind references. Raw page content is untrusted input. Browser and local outputs are validated, redacted and provenance-tagged before they become platform artifacts.

## 11. Rollout posture

1. read-only adapter registration and health preview;
2. user-connected interactive observe pilot;
3. proposal-only Browser Bridge and local runtime pilot;
4. scheduled runs with bounded queues and callbacks;
5. official Workspace Agent connected-app pilot;
6. broader delegation after negative tests;
7. act/authority only through separate durable-effect implementation and approval.

PR #1898 performs none of these activations.
