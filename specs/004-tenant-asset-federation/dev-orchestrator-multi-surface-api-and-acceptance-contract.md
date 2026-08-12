# Dev Orchestrator Multi-Surface API and Acceptance Contract

**Status:** design-only OpenAPI and acceptance preview. No routes or generated schemas are changed by PR #1898.

## 1. Future resource model

Preferred resource-oriented endpoints:

```text
POST /orchestration-runs
GET  /orchestration-runs/{runId}
GET  /orchestration-runs/{runId}/plan
GET  /orchestration-runs/{runId}/results
POST /orchestration-runs/{runId}/approvals
POST /orchestration-runs/{runId}/cancellations
POST /orchestration-runs/{runId}/callbacks
GET  /agent-surfaces
GET  /agent-surfaces/{surfaceKey}
GET  /agent-surface-bindings
GET  /execution-candidates/preview
GET  /starter-templates
POST /starter-templates/{starterKey}/runs
GET  /execution-preferences/effective
```

Actual route names must be reconciled with existing APIs and generated OpenAPI authority before implementation.

## 2. Create-run contract

`POST /orchestration-runs` returns `202 Accepted` for asynchronous Browser Bridge, Workspace Agent, n8n, scheduled or local-agent work.

Required behaviors:

- authenticated principal and object-level authorization;
- server-side tenant/workspace resolution;
- strict request validation and unknown-field handling;
- idempotency key for retryable creation;
- business-activity resolution before agent/runtime compatibility;
- immutable plan and preference snapshots;
- no raw credential, cookie or arbitrary callback URL fields.

Example response:

```json
{
  "run": {
    "runId": "orch_run_123",
    "status": "planning",
    "entrypoint": "n8n",
    "createdAt": "2026-07-11T12:00:00Z"
  },
  "links": {
    "status": "/orchestration-runs/orch_run_123",
    "plan": "/orchestration-runs/orch_run_123/plan"
  }
}
```

## 3. Error envelope

```json
{
  "error": {
    "code": "AGENT_SURFACE_UNAVAILABLE",
    "message": "No eligible execution surface is currently available.",
    "details": [
      {"reasonCode": "SESSION_EXPIRED", "surfaceKey": "chatgpt_custom_gpt"}
    ],
    "requestId": "req_123"
  }
}
```

Stable design error codes include:

- `BUSINESS_ACTIVITY_UNRESOLVED`
- `NO_ELIGIBLE_AGENT`
- `NO_ELIGIBLE_EXECUTION_SURFACE`
- `CONNECTION_REQUIRED`
- `SESSION_EXPIRED`
- `WORKSPACE_APP_NOT_CONNECTED`
- `BUDGET_RESERVATION_FAILED`
- `APPROVAL_REQUIRED`
- `CONCURRENCY_LIMIT_REACHED`
- `OUTPUT_VALIDATION_FAILED`
- `CALLBACK_VERIFICATION_FAILED`
- `READBACK_FAILED`
- `UNKNOWN_OR_PARTIAL_EFFECT`

## 4. Status and retry semantics

- `200`: successful read or synchronous preview;
- `201`: created configuration resource where appropriate;
- `202`: asynchronous run accepted;
- `400`: invalid shape;
- `401`: authentication failure;
- `403`: permission or policy denial;
- `404`: resource unavailable in authorized scope;
- `409`: idempotency, state, version, lease or session conflict;
- `422`: semantically invalid plan or incompatible surface;
- `429`: quota, rate or concurrency limit with retry guidance;
- `503`: temporary adapter, runtime or provider outage.

Unsafe retries require idempotency. Callback retries require event keys and signature verification.

## 5. Acceptance dimensions

Every implementation candidate is tested across:

- tenant and user identity;
- business-activity compatibility;
- trigger type;
- mode and effect authority;
- surface binding and adapter;
- session isolation;
- tools and connected-app permissions;
- privacy and data minimization;
- output validation;
- budget and quota;
- fallback and recovery;
- observability and readback.

## 6. Surface acceptance matrix

| Surface | Interactive | n8n/scheduled | Required acceptance evidence |
|---|---:|---:|---|
| ChatGPT Custom GPT | yes | pilot-only | user session, exact GPT verification, queue, output stabilization, readback. |
| Gemini Gem | yes | pilot-only | Google identity, Gem access, exact target, output validation, readback. |
| Workspace Agent API | yes | yes | official scope, published agent, API health, callback/result contract. |
| Mad4B connected app | yes | via agent | OAuth identity, workspace permission, tool allowlist, approval behavior. |
| Hermes | yes | yes | runtime health, sandbox, skills, model/provider and readback. |
| OpenClaw | yes | yes | channel identity mapping, session routing, tools and readback. |
| OpenRouter/direct API | yes | yes | provider/model eligibility, quota, structured output and cost evidence. |
| Local model | yes | yes | device/runtime health, capacity, privacy and fallback evidence. |

## 7. Required positive tests

- Tenant GPT starts a proposal run and receives synthesized multi-agent results.
- Manual starter resolves the same logical agent across different eligible surfaces.
- n8n creates a run, receives a signed callback and continues exactly once.
- Scheduled run defers when approval is required and resumes the same plan after approval.
- Workspace Agent uses Mad4B connected app with tenant-scoped read tools.
- Browser Bridge and local runtime outputs become validated result envelopes.
- Preference changes reorder eligible candidates without bypassing hard constraints.
- Provider/session failure selects an approved fallback before any effect.
- Budget and concurrency reservations are released after terminal completion.

## 8. Required negative tests

- user preference attempts to override tenant or platform denial;
- browser profile or conversation crosses user/tenant boundaries;
- scheduled run attempts to reuse an active interactive tab;
- prompt requests unregistered runtime, tool or callback URL;
- Browser Bridge output contains prompt-injected action JSON;
- Gem or Custom GPT target identity cannot be verified;
- Workspace Agent is triggered without connected-app authorization;
- Hermes/OpenClaw requests terminal or file capability outside the tool profile;
- silent paid fallback after free/subscription lane failure;
- duplicate n8n event or callback;
- fallback after a committed or unknown external effect;
- missing readback is reported as success;
- expired session, revoked access, challenge or UI drift is misclassified as model failure.

## 9. Rollout gates

1. design and registry reuse review;
2. read-only candidate and health previews;
3. isolated interactive observe pilot;
4. proposal-only multi-agent pilot;
5. n8n/scheduled callback pilot;
6. Workspace connected-app pilot;
7. local runtime pilot;
8. broader delegate rollout;
9. separate act/authority implementation only after durable-effect acceptance.

Stop conditions include tenant leakage, credential exposure, uncontrolled concurrency, callback replay, unaccounted spend, target-surface mismatch, unexplained fallback, or readback failure above the approved threshold.

## 10. Definition of implementation readiness

Implementation is not ready until API ownership, registry mappings, additive persistence gaps, auth scopes, callback signing, browser/local adapter certification, negative tests, observability, kill switches, rollback and release split are approved.

This document neither declares current runtime readiness nor authorizes deployment.
