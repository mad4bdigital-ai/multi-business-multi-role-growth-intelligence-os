# Hybrid Local and Managed Agent Runtime

The platform supports two explicit multi-agent execution targets:

- `local_device`: a tenant-owned Local Manager device runs a selected local model provider.
- `platform_managed`: the governed platform agent runtime runs the work.

The platform remains the orchestration and governance authority. A local device is an optional execution worker.

## Controls

- Multi-agent execution requires `delegation_approved=true`, `delegation_mode=manual_api`, and `delegation_reason`.
- Settings changes require `settings_update_approved=true`.
- Provider installation requires device setting `install_enabled=true` and `installation_approved=true`.
- Managed fallback is never inferred from local failure.
- Tenant GPT can target only a device owned by the authenticated tenant/user.
- No model-provider secrets are returned or copied to the local device.

## Settings

Safe device settings persist at `~/.mad4b/local-agent-runtime-settings.json`.

| Setting | Values |
| --- | --- |
| `execution_target` | `local_device`, `platform_managed` |
| `fallback_policy` | `none`, `require_approval`, `managed_allowed` |
| `local_runtime_enabled` | boolean |
| `install_enabled` | boolean |
| `max_parallel_agents` | 1-6 |
| `provider_key` | `ollama`, `lm_studio`, `localai`, `llama_cpp`, `vllm`, `jan`, `custom_openai_compatible` |
| `endpoint_url` | localhost HTTP URL only |
| `preferred_model` | selected provider model name |
| `recommendation_site` | `ollama_library`, `huggingface_model_memory`, `google_gemma` |

`managed_allowed` records preference only. It does not dispatch managed agents.

## API

The authenticated device action endpoint is `POST /agent-runtime`.
The governed platform proxy is `POST /connector/{device_id}/agent-runtime`.

Actions:

- `capabilities`: CPU, RAM, NVIDIA GPU memory, provider candidates, installed provider models, and concurrency.
- `recommend_models`: conservative model suggestions and specialized sizing links.
- `settings` and `settings_update`: inspect or explicitly update local/managed preferences.
- `install_provider`: explicitly install a provider when its registry profile supports automatic installation. Other providers return their official setup URL.
- `install_ollama`: compatibility alias for `install_provider` with `provider_key=ollama`.
- `install_model`: explicitly download a selected model when the provider supports API-based model installation.
- `run`, `job_status`, and `cancel`: operate an explicitly approved local multi-agent job.

The recommendation response links to:

- `https://ollama.com/library`
- `https://huggingface.co/spaces/hf-accelerate/model-memory-usage`
- `https://ai.google.dev/gemma`

Provider support:

| Provider | Protocol | Automatic install | Model install API |
| --- | --- | --- | --- |
| Ollama | Native Ollama API | Windows `winget` | Yes |
| LM Studio | OpenAI-compatible | Manual | No |
| LocalAI | OpenAI-compatible | Manual | No |
| llama.cpp server | OpenAI-compatible | Manual | No |
| vLLM | OpenAI-compatible | Manual | No |
| Jan | OpenAI-compatible | Manual | No |
| Custom local server | OpenAI-compatible | Manual | Provider-dependent |

Google Gemma is supported as a model family through compatible providers such as Ollama, LM Studio, LocalAI, llama.cpp, and vLLM.

## Tenant/Admin GPT Flow

Tenant GPT and Admin GPT discover `connector_agent_runtime` through list-before-call.

Read model recommendation:

```json
{
  "device_id": "customer-device",
  "action": "recommend_models"
}
```

Enable local execution:

```json
{
  "device_id": "customer-device",
  "action": "settings_update",
  "settings_update_approved": true,
  "settings": {
    "execution_target": "local_device",
    "provider_key": "lm_studio",
    "endpoint_url": "http://127.0.0.1:1234/v1",
    "fallback_policy": "require_approval",
    "local_runtime_enabled": true,
    "install_enabled": true,
    "max_parallel_agents": 3,
    "preferred_model": "qwen3:8b"
  }
}
```

Run local agents:

```json
{
  "device_id": "customer-device",
  "action": "run",
  "execution_target": "local_device",
  "delegation_approved": true,
  "delegation_mode": "manual_api",
  "delegation_reason": "Run specialist reviews on the tenant-owned device.",
  "model": "qwen3:8b",
  "agents": [
    { "name": "architect", "prompt": "Review the architecture." },
    { "name": "security-reviewer", "prompt": "Identify security risks." },
    { "name": "test-engineer", "prompt": "Propose a verification plan." }
  ]
}
```

GPT installation sequence:

1. Call `capabilities`.
2. Call `recommend_models`.
3. Explicitly enable installation using `settings_update`.
4. Call `install_provider` with the selected `provider_key` and `installation_approved=true`.
5. Call `install_model` with `model_installation_approved=true`.
6. Call `capabilities` again.

Model installation remains a separate explicit action to avoid unexpected bandwidth and storage use.
