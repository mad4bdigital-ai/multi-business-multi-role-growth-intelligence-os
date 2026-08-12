# Dev Orchestrator Multi-Surface Agent Binding Contract

**Status:** design-only. No surface registration or runtime activation is performed by PR #1898.

## 1. Purpose

A logical agent is a stable business capability. A surface binding describes one way to run that agent. Workflows reference the logical agent or required capability, not a URL, browser selector, provider key, or local framework.

```text
logical agent
  ├─ ChatGPT Custom GPT binding
  ├─ Gemini Custom Gem binding
  ├─ ChatGPT Workspace Agent binding
  ├─ Hermes binding
  ├─ OpenClaw binding
  ├─ platform-native binding
  └─ model-API binding
```

## 2. Binding envelope

```json
{
  "binding_key": "tenant_growth_assistant.chatgpt_custom_gpt",
  "agent_key": "tenant_growth_assistant",
  "surface_family": "interactive_agent",
  "surface_key": "chatgpt_custom_gpt",
  "target_ref": "g-69b6e4de8fd88191ac132362e1ee300e",
  "execution_adapter_key": "browser_bridge.chatgpt_custom_gpt",
  "runtime_key": "chatgpt_consumer_surface",
  "identity_connection_policy": "user_owned_session",
  "supported_trigger_types": ["tenant_gpt_prompt", "manual_ui_start", "n8n_trigger", "scheduled_trigger"],
  "supported_modes": ["observe", "propose", "delegate"],
  "structured_output_level": "prompt_enforced",
  "session_policy_key": "isolated_user_profile",
  "tool_profile_key": "tenant_read_only",
  "data_policy_key": "redacted_tenant_context",
  "status": "planned"
}
```

`target_ref` is a non-secret pointer. Browser cookies, access tokens and provider credentials are never stored in the binding.

## 3. Binding families

### ChatGPT Custom GPT

- exact published Custom GPT behavior;
- user-owned ChatGPT session;
- browser adapter required for backend or scheduled execution;
- interactive use may originate in the Tenant GPT itself;
- no assumption of an official Custom GPT invocation API.

### Gemini Custom Gem

- exact published Gem behavior;
- user-owned Google session and Gem access required;
- browser adapter unless a future official Gem invocation contract exists;
- Drive-backed Gem knowledge remains governed by Google permissions and platform redaction policy.

### ChatGPT Workspace Agent

- official agent API surface when enabled by the user workspace;
- workspace access token is transport authority only;
- platform authorization is resolved separately through the connected app and platform OAuth identity;
- supports backend, n8n and scheduled triggers subject to official API capabilities.

### Mad4B connected app

- represented as a connected MCP/app binding, not a model provider;
- exposes only allowlisted platform resources and operations;
- read, propose and act tool groups remain separately governed;
- each workspace user authenticates to Mad4B and retains tenant-scoped authorization.

### Hermes and OpenClaw

- represented as runtime bindings;
- may execute locally, on a dedicated managed runtime, or through an approved remote target;
- model provider is resolved separately;
- terminal, file, browser and messaging skills require explicit tool profiles and sandbox policy.

## 4. Compatibility predicates

A binding is eligible only when all required predicates pass:

- logical agent supports the resolved business activity;
- trigger type is supported;
- requested mode is supported;
- tool and output profiles are compatible;
- identity connection exists and is healthy;
- runtime, adapter and provider are active or pilot-enabled;
- tenant and user policy allow the surface;
- privacy and data-residency requirements pass;
- concurrency, quota and budget can be reserved;
- required readback contract exists.

## 5. Identity connections

Connection classes include:

- `chatgpt_consumer_session`
- `google_gemini_session`
- `chatgpt_workspace_connection`
- `mad4b_platform_oauth`
- `local_runtime_connection`
- `model_provider_credential`

The resolver stores connection references only. Secrets remain in governed credential stores. User-owned sessions are never shared across users or tenants.

## 6. Session isolation

Default browser topology:

```text
one browser profile per user identity
one browser context per orchestration run
one tab per agent step
one conversation reference per task unless reuse is explicitly approved
one queue or bounded lease per account
```

Workspace API and local runtimes use equivalent logical isolation through conversation keys, run IDs, worker leases and scoped memory namespaces.

## 7. Binding lifecycle

```text
planned → validating → pilot → active → degraded → disabled → archived
```

`active` requires same-cycle transport, identity, output-validation and readback evidence. A narrative claim or stored URL is insufficient.

## 8. Selection evidence

Every selected binding records:

- candidates considered and exclusions;
- policy and preference revisions;
- health and capacity snapshot;
- estimated and actual cost class;
- identity and session class without secrets;
- fallback order;
- readback contract;
- reason code for final selection.

## 9. Non-goals

This design does not copy Custom GPT or Gem instructions, bypass provider controls, share user credentials, install Hermes/OpenClaw, or activate browser automation. Those actions require separate governed implementation and acceptance work.