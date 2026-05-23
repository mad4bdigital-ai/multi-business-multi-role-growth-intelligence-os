# Governed Model Runtime Routing

## Purpose

This document defines how the platform chooses model providers for agent execution, dev-agent summaries, and other runtime model calls.

The goal is to keep model routing cheap, configurable, and stable without hardcoding a single paid provider in route code.

## Current production lesson

The previous session-summary pipeline failure had two phases:

1. `callModel` was not wired into the dev-agent/session-summary routes, so summaries degraded to deterministic fallback text.
2. After wiring was fixed, the runtime defaulted to Anthropic even though `ANTHROPIC_API_KEY` was absent. OpenAI was present but returned quota/rate errors.

The fix is to separate three concerns:

- model dependency wiring,
- model credential/readiness diagnostics,
- governed model provider settings.

## Provider contract

Supported provider keys:

| Provider | Transport | Primary use |
|---|---|---|
| `gemini` | Google AI Studio Gemini `generateContent` API | Primary provider for session summaries and standard background reasoning |
| `openrouter` | OpenAI-compatible Chat Completions at `https://openrouter.ai/api/v1/chat/completions` | First fallback and free/low-cost routing, including `openrouter/free` |
| `openai` | OpenAI Chat Completions | Paid direct fallback when configured |
| `anthropic` | Anthropic Messages API | Claude direct path when configured |

OpenRouter is treated as an OpenAI-compatible provider in `modelAdapterRouter.js`. The default free-first model is `openrouter/free`, which delegates to currently available free OpenRouter models. Do not assume the exact free model list is stable.

## Platform setting

Runtime model routing is governed by this DB config row:

```text
platform_runtime_config.config_key = agent_model_runtime
```

The row stores only non-secret metadata:

- `provider_order`
- `free_first`
- provider `enabled` flags
- provider `credential_env_var` names
- class-to-model mappings
- optional OpenRouter app metadata env-var names

It must never store raw API keys, bearer tokens, provider account secrets, private keys, or refresh tokens.

Default config:

```json
{
  "version": 1,
  "free_first": true,
  "provider_order": ["openrouter", "openai", "anthropic", "gemini"],
  "providers": {
    "openrouter": {
      "enabled": true,
      "credential_env_var": "OPENROUTER_API_KEY",
      "default_model": "openrouter/free",
      "models": {
        "standard": "openrouter/free",
        "complex": "openrouter/free",
        "authority": "openrouter/free"
      },
      "optional_headers": {
        "site_url_env_var": "OPENROUTER_SITE_URL",
        "app_name_env_var": "OPENROUTER_APP_NAME"
      }
    },
    "openai": {
      "enabled": true,
      "credential_env_var": "OPENAI_API_KEY",
      "default_model": "gpt-4o-mini",
      "models": {
        "standard": "gpt-4o-mini",
        "complex": "gpt-4o",
        "authority": "gpt-4o"
      }
    },
    "anthropic": {
      "enabled": true,
      "credential_env_var": "ANTHROPIC_API_KEY",
      "default_model": "claude-haiku-4-5-20251001",
      "models": {
        "standard": "claude-haiku-4-5-20251001",
        "complex": "claude-sonnet-4-6",
        "authority": "claude-opus-4-7"
      }
    },
    "gemini": {
      "enabled": true,
      "credential_env_var": "GOOGLE_AI_API_KEY",
      "default_model": "gemini-1.5-flash",
      "models": {
        "standard": "gemini-1.5-flash",
        "complex": "gemini-1.5-pro",
        "authority": "gemini-1.5-pro"
      }
    }
  }
}
```

## Selection order

Runtime selection uses this order:

1. If `AGENT_MODEL_PROVIDER` is set, it hard-selects that provider.
2. Otherwise, load `platform_runtime_config.agent_model_runtime`.
3. Iterate `provider_order` and choose the first enabled provider whose credential env var is present.
4. Select model by `execution_class`: `standard`, `complex`, or `authority`.
5. If `AGENT_MODEL` is set, it overrides the class model ID for the selected provider.
6. If no provider has credentials, return a blocked readiness result rather than pretending model execution is active.

## Governed routes and tools

Routes under backend/admin auth:

| Route | Method | Purpose |
|---|---:|---|
| `/dev-agent/model-readiness` | GET | Runs a small model readiness probe and returns sanitized provider/config evidence. |
| `/dev-agent/model-settings` | GET | Reads sanitized model runtime settings and credential presence flags. |
| `/dev-agent/model-settings` | PATCH | Updates non-secret provider order/model settings. Secret-like fields are rejected. |

Admin tool registry keys:

| Tool key | Purpose |
|---|---|
| `dev_agent_model_readiness` | Read-only model readiness diagnostic. |
| `dev_agent_model_settings_get` | Read sanitized model runtime settings. |
| `dev_agent_model_settings_update` | Update non-secret model runtime settings. |

## Secrets policy

Provider keys remain environment/vault secrets:

| Env var | Provider |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_AI_API_KEY` | Gemini |

Optional OpenRouter metadata:

| Env var | Purpose |
|---|---|
| `OPENROUTER_SITE_URL` | Sent as `HTTP-Referer` when configured. |
| `OPENROUTER_APP_NAME` | Sent as `X-Title` when configured. |

Do not log or persist provider keys. Model readiness responses may expose only boolean credential presence and sanitized provider status.

## Free-first guidance

`openrouter/free` is useful for development, summaries, and low-stakes background jobs. It should not be assumed to provide a stable exact model or capacity guarantee. Production-critical or authority-class workflows may still pin paid models through `agent_model_runtime.providers.<provider>.models.authority`.

If free routes hit rate limits or quality limits, change provider order or class mappings through `/dev-agent/model-settings` instead of editing route code.
