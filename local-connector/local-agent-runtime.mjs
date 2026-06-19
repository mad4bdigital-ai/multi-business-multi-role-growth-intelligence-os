import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const jobs = new Map();
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const LOCAL_PROVIDER_REGISTRY = {
  ollama: {
    display_name: 'Ollama',
    protocol: 'ollama',
    default_endpoint_url: DEFAULT_OLLAMA_URL,
    install_mode: 'winget',
    winget_id: 'Ollama.Ollama',
    model_install_supported: true,
    website: 'https://ollama.com/',
  },
  lm_studio: {
    display_name: 'LM Studio',
    protocol: 'openai_compatible',
    default_endpoint_url: 'http://127.0.0.1:1234/v1',
    install_mode: 'manual',
    model_install_supported: false,
    website: 'https://lmstudio.ai/',
  },
  localai: {
    display_name: 'LocalAI',
    protocol: 'openai_compatible',
    default_endpoint_url: 'http://127.0.0.1:8080/v1',
    install_mode: 'manual',
    model_install_supported: false,
    website: 'https://localai.io/',
  },
  llama_cpp: {
    display_name: 'llama.cpp Server',
    protocol: 'openai_compatible',
    default_endpoint_url: 'http://127.0.0.1:8080/v1',
    install_mode: 'manual',
    model_install_supported: false,
    website: 'https://github.com/ggml-org/llama.cpp',
  },
  vllm: {
    display_name: 'vLLM',
    protocol: 'openai_compatible',
    default_endpoint_url: 'http://127.0.0.1:8000/v1',
    install_mode: 'manual',
    model_install_supported: false,
    website: 'https://docs.vllm.ai/',
  },
  jan: {
    display_name: 'Jan',
    protocol: 'openai_compatible',
    default_endpoint_url: 'http://127.0.0.1:1337/v1',
    install_mode: 'manual',
    model_install_supported: false,
    website: 'https://jan.ai/',
  },
  custom_openai_compatible: {
    display_name: 'Custom OpenAI-Compatible Local Server',
    protocol: 'openai_compatible',
    default_endpoint_url: 'http://127.0.0.1:8000/v1',
    install_mode: 'manual',
    model_install_supported: false,
    website: null,
  },
};
const API_MODEL_PROVIDER_REGISTRY = {
  openrouter: {
    display_name: 'OpenRouter',
    protocol: 'openai_compatible_platform_bridge',
    credential_boundary: 'platform_managed_secret_reference_only',
    default_model: 'openrouter/free',
    model_policy_key: 'openrouter_model_selection_policy_v1',
    provider_key: 'openrouter_openai_compatible',
    website: 'https://openrouter.ai/models',
    execution_surface: 'auth.mad4b.com provider bridge',
  },
};
const EXECUTION_TARGETS = ['local_device', 'api_model_provider', 'platform_managed', 'dedicated_managed'];
const SETTINGS_PATH = process.env.LOCAL_AGENT_SETTINGS_PATH
  || path.join(os.homedir(), '.mad4b', 'local-agent-runtime-settings.json');
const MODEL_GUIDES = [
  {
    key: 'openrouter_models',
    name: 'OpenRouter Model Directory',
    url: 'https://openrouter.ai/models',
    purpose: 'Compare hosted model choices before selecting the governed platform OpenRouter bridge.',
  },
  {
    key: 'ollama_library',
    name: 'Ollama Model Library',
    url: 'https://ollama.com/library',
    purpose: 'Review available local models, variants, and download sizes.',
  },
  {
    key: 'huggingface_model_memory',
    name: 'Hugging Face Model Memory Utility',
    url: 'https://huggingface.co/spaces/hf-accelerate/model-memory-usage',
    purpose: 'Estimate model memory requirements before downloading a model.',
  },
  {
    key: 'google_gemma',
    name: 'Google Gemma',
    url: 'https://ai.google.dev/gemma',
    purpose: 'Review Google Gemma open-model variants and deployment guidance.',
  },
];

const DEFAULT_SETTINGS = {
  execution_target: 'local_device',
  fallback_policy: 'none',
  local_runtime_enabled: process.env.CONNECTOR_LOCAL_AGENT_RUNTIME_ENABLED === 'true',
  install_enabled: process.env.CONNECTOR_LOCAL_AGENT_INSTALL_ENABLED === 'true',
  max_parallel_agents: clamp(process.env.LOCAL_AGENT_MAX_PARALLEL, 1, 6, 2),
  ollama_url: String(process.env.LOCAL_AGENT_OLLAMA_URL || DEFAULT_OLLAMA_URL),
  preferred_model: String(process.env.OLLAMA_MODEL || ''),
  provider_key: String(process.env.LOCAL_AGENT_PROVIDER_KEY || 'ollama'),
  api_model_provider_key: String(process.env.API_MODEL_PROVIDER_KEY || 'openrouter'),
  endpoint_url: String(process.env.LOCAL_AGENT_PROVIDER_URL || process.env.LOCAL_AGENT_OLLAMA_URL || DEFAULT_OLLAMA_URL),
  recommendation_site: 'ollama_library',
};

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let runtimeSettings = loadSettings();

function sanitizeSettings(input = {}) {
  const next = { ...runtimeSettings };
  if (EXECUTION_TARGETS.includes(input.execution_target)) next.execution_target = input.execution_target;
  if (['none', 'require_approval', 'managed_allowed'].includes(input.fallback_policy)) next.fallback_policy = input.fallback_policy;
  if (typeof input.local_runtime_enabled === 'boolean') next.local_runtime_enabled = input.local_runtime_enabled;
  if (typeof input.install_enabled === 'boolean') next.install_enabled = input.install_enabled;
  if (input.max_parallel_agents != null) next.max_parallel_agents = clamp(input.max_parallel_agents, 1, 6, 2);
  if (typeof input.preferred_model === 'string') next.preferred_model = input.preferred_model.trim().slice(0, 160);
  if (API_MODEL_PROVIDER_REGISTRY[input.provider_key]) {
    next.api_model_provider_key = input.provider_key;
    next.execution_target = input.execution_target && EXECUTION_TARGETS.includes(input.execution_target)
      ? input.execution_target
      : 'api_model_provider';
  }
  if (API_MODEL_PROVIDER_REGISTRY[input.api_model_provider_key]) {
    next.api_model_provider_key = input.api_model_provider_key;
  }
  if (LOCAL_PROVIDER_REGISTRY[input.provider_key]) {
    next.provider_key = input.provider_key;
    if (!input.endpoint_url) next.endpoint_url = LOCAL_PROVIDER_REGISTRY[input.provider_key].default_endpoint_url;
  }
  if (MODEL_GUIDES.some(site => site.key === input.recommendation_site)) next.recommendation_site = input.recommendation_site;
  if (typeof input.ollama_url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(input.ollama_url.trim())) {
    next.ollama_url = input.ollama_url.trim().replace(/\/$/, '');
    if (next.provider_key === 'ollama') next.endpoint_url = next.ollama_url;
  }
  if (typeof input.endpoint_url === 'string' && isLocalEndpoint(input.endpoint_url)) {
    next.endpoint_url = input.endpoint_url.trim().replace(/\/$/, '');
  }
  return next;
}

function persistSettings(next) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  runtimeSettings = next;
  return runtimeSettings;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function isLocalEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function selectedProvider() {
  const providerKey = LOCAL_PROVIDER_REGISTRY[runtimeSettings.provider_key] ? runtimeSettings.provider_key : 'ollama';
  const provider = LOCAL_PROVIDER_REGISTRY[providerKey];
  const endpointUrl = String(runtimeSettings.endpoint_url || provider.default_endpoint_url).replace(/\/$/, '');
  if (!isLocalEndpoint(endpointUrl)) throw Object.assign(new Error('Local provider endpoint must use localhost HTTP.'), { code: 'non_local_provider_endpoint' });
  return { provider_key: providerKey, endpoint_url: endpointUrl, ...provider };
}

function selectedApiModelProvider() {
  const providerKey = API_MODEL_PROVIDER_REGISTRY[runtimeSettings.api_model_provider_key]
    ? runtimeSettings.api_model_provider_key
    : 'openrouter';
  return { api_model_provider_key: providerKey, ...API_MODEL_PROVIDER_REGISTRY[providerKey] };
}

function runCommand(command, args = [], timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ exit_code: code, stdout: stdout.slice(0, 12000), stderr: stderr.slice(0, 4000) });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${code}`));
    });
  });
}

async function discoverGpu() {
  try {
    const result = await runCommand(
      process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      8000,
    );
    const first = result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (!first) return null;
    const [name, memoryMb] = first.split(',').map(value => value.trim());
    return { vendor: 'nvidia', name, memory_gb: Math.round((Number(memoryMb) / 1024) * 10) / 10 };
  } catch {
    return null;
  }
}

async function ollamaRequest(path, options = {}) {
  const baseUrl = selectedProvider().endpoint_url;
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function openAiCompatibleRequest(path, options = {}) {
  const provider = selectedProvider();
  const response = await fetch(`${provider.endpoint_url}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${provider.display_name} ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function providerModels(provider) {
  if (provider.protocol === 'ollama') {
    const tags = await ollamaRequest('/api/tags', { method: 'GET', signal: AbortSignal.timeout(5000) });
    return (tags.models || []).map(model => ({
      name: model.name,
      size_gb: Math.round((Number(model.size || 0) / (1024 ** 3)) * 10) / 10,
    }));
  }
  const response = await openAiCompatibleRequest('/models', { method: 'GET', signal: AbortSignal.timeout(5000) });
  return (response.data || []).map(model => ({ name: model.id, owned_by: model.owned_by || null }));
}

async function capabilities() {
  const gpu = await discoverGpu();
  const usesLocalProvider = runtimeSettings.execution_target === 'local_device';
  const provider = usesLocalProvider ? selectedProvider() : null;
  const apiModelProvider = selectedApiModelProvider();
  let models = [];
  let providerReady = null;
  if (provider) {
    try {
      models = await providerModels(provider);
      providerReady = true;
    } catch {
      providerReady = false;
    }
  }
  return {
    execution_targets: EXECUTION_TARGETS,
    execution_target: runtimeSettings.execution_target,
    runtime_enabled: runtimeSettings.local_runtime_enabled === true,
    install_enabled: runtimeSettings.install_enabled === true,
    provider_key: provider?.provider_key || runtimeSettings.provider_key,
    provider_protocol: provider?.protocol || null,
    provider_display_name: provider?.display_name || null,
    provider_endpoint_url: provider?.endpoint_url || null,
    provider_ready: providerReady,
    api_model_provider_key: apiModelProvider.api_model_provider_key,
    api_model_provider: apiModelProvider,
    api_model_provider_ready: runtimeSettings.execution_target === 'api_model_provider'
      ? 'platform_bridge_required'
      : null,
    api_model_provider_dispatch: {
      provider_key: apiModelProvider.provider_key,
      model_policy_key: apiModelProvider.model_policy_key,
      credential_boundary: apiModelProvider.credential_boundary,
      local_provider_call_allowed: false,
      secrets_included: false,
    },
    cpu: { logical_cores: os.cpus().length, model: os.cpus()[0]?.model || null },
    memory_gb: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    gpu,
    models,
    max_parallel_agents: runtimeSettings.max_parallel_agents,
    recommendation_sites: MODEL_GUIDES,
    provider_candidates: Object.entries(LOCAL_PROVIDER_REGISTRY).map(([provider_key, value]) => ({
      provider_key,
      display_name: value.display_name,
      protocol: value.protocol,
      default_endpoint_url: value.default_endpoint_url,
      install_mode: value.install_mode,
      model_install_supported: value.model_install_supported,
      website: value.website,
    })),
    api_model_provider_candidates: Object.entries(API_MODEL_PROVIDER_REGISTRY).map(([provider_key, value]) => ({
      provider_key,
      display_name: value.display_name,
      protocol: value.protocol,
      credential_boundary: value.credential_boundary,
      default_model: value.default_model,
      model_policy_key: value.model_policy_key,
      website: value.website,
      execution_surface: value.execution_surface,
    })),
    secrets_included: false,
  };
}

function recommendModels(device) {
  const availableGb = device.gpu?.memory_gb || device.memory_gb * 0.55;
  const candidates = availableGb >= 40
    ? ['qwen3-coder:30b', 'deepseek-r1:32b', 'gemma3:27b', 'llama3.3:70b-q4_K_M']
    : availableGb >= 20
      ? ['qwen3-coder:14b', 'deepseek-r1:14b', 'gemma3:27b']
      : availableGb >= 10
        ? ['qwen3:8b', 'qwen2.5-coder:7b', 'llama3.1:8b']
        : ['qwen3:4b', 'gemma3:4b', 'phi4-mini'];
  return {
    sizing_basis: device.gpu ? 'gpu_vram' : 'system_memory_conservative_share',
    available_memory_estimate_gb: Math.round(availableGb * 10) / 10,
    recommended_models: candidates,
    supported_model_families: ['Gemma', 'Qwen', 'Llama', 'DeepSeek', 'Phi', 'Mistral', 'other provider-compatible models'],
    recommendation_sites: MODEL_GUIDES,
    selected_recommendation_site: MODEL_GUIDES.find(site => site.key === runtimeSettings.recommendation_site) || MODEL_GUIDES[0],
    api_model_provider_recommendation: {
      provider_key: 'openrouter',
      execution_target: 'api_model_provider',
      credential_boundary: 'platform_managed_secret_reference_only',
      model_directory: 'https://openrouter.ai/models',
      dispatch_note: 'Use the governed platform OpenRouter bridge; do not copy provider keys to the local device.',
    },
    warning: 'Validate exact quantization and context-window memory before installation.',
  };
}

function validateRunRequest(body) {
  if (body.delegation_approved !== true || String(body.delegation_mode || '') !== 'manual_api') {
    const error = new Error('Local multi-agent execution requires explicit manual API delegation approval.');
    error.code = 'agent_delegation_opt_in_required';
    throw error;
  }
  if (String(body.delegation_reason || '').trim().length < 10) {
    const error = new Error('delegation_reason must contain at least 10 characters.');
    error.code = 'delegation_reason_required';
    throw error;
  }
  const agents = Array.isArray(body.agents) ? body.agents.slice(0, 6) : [];
  if (!agents.length) {
    const error = new Error('At least one agent is required.');
    error.code = 'agents_required';
    throw error;
  }
  return agents;
}

async function runOneAgent(agent, model, signal) {
  const name = String(agent.name || agent.agent_key || 'agent').slice(0, 100);
  const prompt = String(agent.prompt || '').trim();
  if (!prompt) throw new Error(`Agent ${name} requires a prompt.`);
  const messages = [
    { role: 'system', content: `You are the ${name} sub-agent. Return a concise, evidence-based result.` },
    { role: 'user', content: prompt },
  ];
  const provider = selectedProvider();
  if (provider.protocol === 'ollama') {
    const response = await ollamaRequest('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model, stream: false, messages }),
      signal,
    });
    return { agent_key: name, content: response.message?.content || '', done: response.done === true };
  }
  const response = await openAiCompatibleRequest('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model, stream: false, messages }),
    signal,
  });
  return { agent_key: name, content: response.choices?.[0]?.message?.content || '', done: true };
}

async function runJob(job, agents, model, maxParallel) {
  job.status = 'running';
  job.started_at = new Date().toISOString();
  const queue = [...agents];
  const workers = Array.from({ length: Math.min(maxParallel, agents.length) }, async () => {
    while (queue.length && !job.controller.signal.aborted) {
      const agent = queue.shift();
      try {
        job.results.push(await runOneAgent(agent, model, job.controller.signal));
      } catch (error) {
        job.errors.push({ agent_key: agent?.name || agent?.agent_key || 'agent', message: error.message });
      }
    }
  });
  await Promise.all(workers);
  job.completed_at = new Date().toISOString();
  job.status = job.controller.signal.aborted ? 'cancelled' : (job.errors.length ? 'completed_with_errors' : 'completed');
}

function publicJob(job) {
  return {
    job_id: job.job_id,
    status: job.status,
    model: job.model,
    provider_key: job.provider_key,
    agent_count: job.agent_count,
    results: job.results,
    errors: job.errors,
    created_at: job.created_at,
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    execution_target: 'local_device',
    secrets_included: false,
  };
}

async function installProvider(providerKey) {
  if (API_MODEL_PROVIDER_REGISTRY[providerKey]) {
    const provider = API_MODEL_PROVIDER_REGISTRY[providerKey];
    return {
      provider_key: providerKey,
      install_mode: 'platform_bridge',
      automatic_install_supported: false,
      website: provider.website,
      credential_boundary: provider.credential_boundary,
      dispatch_surface: provider.execution_surface,
      local_install_required: false,
      secrets_included: false,
    };
  }
  const provider = LOCAL_PROVIDER_REGISTRY[providerKey];
  if (!provider) throw Object.assign(new Error('Unknown local provider.'), { code: 'unknown_local_provider' });
  if (provider.install_mode !== 'winget' || !provider.winget_id) {
    return { provider_key: providerKey, install_mode: provider.install_mode, automatic_install_supported: false, website: provider.website };
  }
  if (process.platform !== 'win32') {
    const error = new Error('Automatic provider installation is currently supported on Windows devices only.');
    error.code = 'automatic_install_platform_not_supported';
    throw error;
  }
  return runCommand('winget.exe', ['install', '--id', provider.winget_id, '--exact', '--accept-source-agreements', '--accept-package-agreements'], 600000);
}

async function installModel(model) {
  const provider = selectedProvider();
  if (!provider.model_install_supported || provider.protocol !== 'ollama') {
    return { installed: false, provider_key: provider.provider_key, model_install_supported: false, website: provider.website };
  }
  const normalized = String(model || '').trim();
  if (!/^[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?$/.test(normalized)) {
    const error = new Error('model must be a valid Ollama model name.');
    error.code = 'invalid_model_name';
    throw error;
  }
  const result = await ollamaRequest('/api/pull', {
    method: 'POST',
    body: JSON.stringify({ model: normalized, stream: false }),
    signal: AbortSignal.timeout(600000),
  });
  return { model: normalized, status: result.status || 'success' };
}

export function createLocalAgentRuntimeHandler({ requireAuth, readBody, ok, err, audit }) {
  return async function handleLocalAgentRuntime(req, res) {
    if (!requireAuth(req, res)) return;
    let body;
    try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }
    const action = String(body.action || 'capabilities');
    audit(req, { action: `agent-runtime:${action}` });

    try {
      if (action === 'capabilities') return ok(res, await capabilities());
      if (action === 'recommend_models') {
        const device = await capabilities();
        return ok(res, { device, recommendation: recommendModels(device) });
      }
      if (action === 'settings') {
        return ok(res, {
          execution_targets: EXECUTION_TARGETS,
          fallback_policies: ['none', 'require_approval', 'managed_allowed'],
          ...runtimeSettings,
          settings_path: SETTINGS_PATH,
          recommendation_sites: MODEL_GUIDES,
          provider_candidates: Object.entries(LOCAL_PROVIDER_REGISTRY).map(([provider_key, provider]) => ({ provider_key, ...provider })),
          api_model_provider_candidates: Object.entries(API_MODEL_PROVIDER_REGISTRY).map(([provider_key, provider]) => ({ provider_key, ...provider })),
          api_model_provider_dispatch: {
            local_provider_call_allowed: false,
            credential_boundary: 'platform_managed_secret_reference_only',
            dispatch_surface: 'auth.mad4b.com',
          },
          automatic_delegation_allowed: false,
        });
      }
      if (action === 'settings_update') {
        if (body.settings_update_approved !== true) return err(res, 403, 'SETTINGS_APPROVAL_REQUIRED', 'settings_update_approved=true is required.');
        const settings = persistSettings(sanitizeSettings(body.settings || {}));
        return ok(res, { settings, automatic_delegation_allowed: false, secrets_included: false });
      }
      if (action === 'install_provider' || action === 'install_ollama') {
        if (runtimeSettings.install_enabled !== true) return err(res, 403, 'INSTALL_DISABLED', 'Local agent installation is disabled in device settings.');
        if (body.installation_approved !== true) return err(res, 403, 'INSTALL_APPROVAL_REQUIRED', 'installation_approved=true is required.');
        const providerKey = action === 'install_ollama' ? 'ollama' : String(body.provider_key || runtimeSettings.provider_key || 'ollama');
        return ok(res, { provider_key: providerKey, result: await installProvider(providerKey), next_action: 'recommend_models' });
      }
      if (action === 'install_model') {
        if (runtimeSettings.install_enabled !== true) return err(res, 403, 'INSTALL_DISABLED', 'Local agent installation is disabled in device settings.');
        if (body.model_installation_approved !== true) return err(res, 403, 'MODEL_INSTALL_APPROVAL_REQUIRED', 'model_installation_approved=true is required.');
        return ok(res, { installed: true, result: await installModel(body.model), next_action: 'capabilities' });
      }
      if (action === 'run') {
        const requestedTarget = String(body.execution_target || runtimeSettings.execution_target || 'local_device');
        if (requestedTarget === 'api_model_provider') {
          return err(res, 409, 'API_MODEL_PROVIDER_BRIDGE_REQUIRED', 'Use the governed platform model-provider bridge for execution_target=api_model_provider; provider credentials are never copied to the local device.');
        }
        if (requestedTarget === 'platform_managed' || requestedTarget === 'dedicated_managed') {
          return err(res, 409, 'MANAGED_RUNTIME_REQUIRED', `Use the platform managed-agent API for execution_target=${requestedTarget}.`);
        }
        if (requestedTarget !== 'local_device') return err(res, 400, 'UNKNOWN_EXECUTION_TARGET', 'execution_target must be local_device, api_model_provider, platform_managed, or dedicated_managed.');
        if (runtimeSettings.local_runtime_enabled !== true) return err(res, 403, 'RUNTIME_DISABLED', 'Local agent runtime is disabled in device settings.');
        const agents = validateRunRequest(body);
        const model = String(body.model || runtimeSettings.preferred_model || '').trim();
        if (!model) return err(res, 400, 'MODEL_REQUIRED', 'model is required for local execution.');
        const job = {
          job_id: `local_agent_${crypto.randomUUID()}`,
          status: 'queued',
          model,
          provider_key: selectedProvider().provider_key,
          agent_count: agents.length,
          results: [],
          errors: [],
          created_at: new Date().toISOString(),
          controller: new AbortController(),
        };
        jobs.set(job.job_id, job);
        runJob(job, agents, model, clamp(body.max_parallel_agents, 1, 6, runtimeSettings.max_parallel_agents)).catch(error => {
          job.status = 'failed';
          job.errors.push({ agent_key: 'runtime', message: error.message });
          job.completed_at = new Date().toISOString();
        });
        return ok(res, publicJob(job));
      }
      if (action === 'job_status') {
        const job = jobs.get(String(body.job_id || ''));
        return job ? ok(res, publicJob(job)) : err(res, 404, 'JOB_NOT_FOUND', 'Local agent job was not found.');
      }
      if (action === 'cancel') {
        const job = jobs.get(String(body.job_id || ''));
        if (!job) return err(res, 404, 'JOB_NOT_FOUND', 'Local agent job was not found.');
        job.controller.abort();
        job.status = 'cancelled';
        return ok(res, publicJob(job));
      }
      return err(res, 400, 'UNKNOWN_ACTION', 'Unsupported local agent runtime action.');
    } catch (error) {
      const status = [
        'agent_delegation_opt_in_required',
        'delegation_reason_required',
        'agents_required',
        'invalid_model_name',
        'unknown_local_provider',
        'non_local_provider_endpoint',
      ].includes(error.code) ? 400 : 500;
      return err(res, status, error.code || 'LOCAL_AGENT_RUNTIME_ERROR', error.message);
    }
  };
}
