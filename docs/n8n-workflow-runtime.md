# Governed n8n Workflow Runtime

## Purpose

This layer lets the platform run visual n8n workflows without turning n8n into an uncontrolled execution surface.

The platform remains the control plane:

- auth and authorization,
- tenant/user scope,
- registry lookup,
- input/output schema validation,
- secret resolution by env-var reference only,
- workflow run logging,
- structured error envelopes,
- model routing through task profiles.

n8n becomes the orchestration layer for visual branching, integrations, retries, and multi-step flows.

## Runtime contract

A platform workflow can bind to n8n through `workflow_runtime_bindings`.

Core fields:

| Field | Purpose |
|---|---|
| `binding_key` | Stable runtime binding identifier. |
| `workflow_key` | Platform workflow key. |
| `runtime_type` | Currently `n8n` for this adapter. |
| `task_class` | Optional model/task class such as `classification`, `summary`, or `image_edit`. |
| `tenant_id` | Optional tenant-specific override. `NULL` means platform/global. |
| `n8n_workflow_id` | Optional n8n workflow ID for operator visibility. |
| `n8n_webhook_path` | Webhook path appended to `N8N_WEBHOOK_BASE_URL`. |
| `n8n_webhook_url` | Explicit webhook URL when needed. Avoid embedding secrets. |
| `execution_mode` | `sync` or `async`. |
| `auth_mode` | `none`, `bearer_env`, or `header_env`. |
| `credential_env_var` | Env-var name only. Secret value is never stored in DB. |
| `input_schema_json` | Minimal JSON schema for request validation. |
| `output_schema_json` | Minimal JSON schema for n8n response validation. |
| `status` | `active`, `disabled`, or `archived`. |

## Governed routes/tools

Routes are admin/backend-gated:

| Route | Method | Purpose |
|---|---:|---|
| `/workflow-runtime/bindings` | GET | List sanitized bindings. |
| `/workflow-runtime/bindings` | POST | Upsert a binding. Secret-like values are not needed; use env-var names. |
| `/workflow-runtime/run` | POST | Run a binding through the platform runtime. |

Admin tool registry keys:

| Tool key | Purpose |
|---|---|
| `workflow_runtime_bindings_list` | List bindings. |
| `workflow_runtime_binding_upsert` | Create/update n8n binding metadata. |
| `workflow_runtime_run` | Execute a bound n8n workflow. |

## Payload sent to n8n

The executor sends a governed payload:

```json
{
  "run_id": "uuid",
  "binding_key": "classification_v1",
  "workflow_key": "classification",
  "n8n_workflow_id": "optional",
  "task_class": "classification",
  "tenant_id": "tenant-id",
  "user_id": "user-id",
  "input": {},
  "governance": {
    "runtime_type": "n8n",
    "secrets_included": false,
    "callback_required": false
  }
}
```

The n8n workflow should return JSON matching `output_schema_json`.

## Security rules

n8n workflows must not:

- store API keys in workflow nodes,
- call model providers directly when a platform model endpoint exists,
- write to platform DB directly,
- bypass tenant/user scope,
- return raw secret material.

n8n workflows should:

- call platform APIs for model execution and DB writes,
- use environment-backed credentials only,
- return structured JSON,
- include enough evidence to trace the run.

## First recommended flows

Start with low-risk visual flows:

1. `classification` — route future requests to task classes such as `summary`, `image_edit`, or `content_workflow`.
2. `session_summary_autosweep` — visualize batch selection/branching while keeping summary writes in the platform.
3. `image_edit` — accept platform-stored asset references, call platform model/image endpoint for Nano Banana, then store output assets through the platform.

## Example binding

```json
{
  "binding_key": "classification_v1",
  "workflow_key": "classification",
  "runtime_type": "n8n",
  "task_class": "classification",
  "n8n_webhook_path": "/webhook/platform-classification",
  "execution_mode": "sync",
  "auth_mode": "bearer_env",
  "credential_env_var": "N8N_WEBHOOK_TOKEN",
  "input_schema_json": {
    "type": "object",
    "required": ["text"],
    "properties": {
      "text": { "type": "string" },
      "tenant_id": { "type": "string" }
    }
  },
  "output_schema_json": {
    "type": "object",
    "required": ["label"],
    "properties": {
      "label": { "type": "string" },
      "confidence": { "type": "number" }
    }
  },
  "timeout_ms": 30000,
  "status": "active"
}
```

Run it through:

```json
{
  "binding_key": "classification_v1",
  "tenant_id": "platform",
  "input": {
    "text": "Please edit this product image and remove the background"
  }
}
```

The platform creates/updates `workflow_runs`, calls the n8n webhook, validates output, and returns a structured response.
