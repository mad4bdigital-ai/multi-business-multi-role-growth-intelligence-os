import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const jobs = new Map();
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const SETTINGS_PATH = process.env.LOCAL_AGENT_SETTINGS_PATH
  || path.join(os.homedir(), '.mad4b', 'local-agent-runtime-settings.json');
const MODEL_GUIDES = [
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
];

const DEFAULT_SETTINGS = {
  execution_target: 'local_device',
  fallback_policy: 'none',
  local_runtime_enabled: process.env.CONNECTOR_LOCAL_AGENT_RUNTIME_ENABLED === 'true',
  install_enabled: process.env.CONNECTOR_LOCAL_AGENT_INSTALL_ENABLED === 'true',
  max_parallel_agents: clamp(process.env.LOCAL_AGENT_MAX_PARALLEL, 1, 6, 2),
  ollama_url: String(process.env.LOCAL_AGENT_OLLAMA_URL || DEFAULT_OLLAMA_URL),
  preferred_model: String(process.env.OLLAMA_MODEL || ''),
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
  if (['local_device', 'platform_managed'].includes(input.execution_target)) next.execution_target = input.execution_target;
  if (['none', 'require_approval', 'managed_allowed'].includes(input.fallback_policy)) next.fallback_policy = input.fallback_policy;
  if (typeof input.local_runtime_enabled === 'boolean') next.local_runtime_enabled = input.local_runtime_enabled;
  if (typeof input.install_enabled === 'boolean') next.install_enabled = input.install_enabled;
  if (input.max_parallel_agents != null) next.max_parallel_agents = clamp(input.max_parallel_agents, 1, 6, 2);
  if (typeof input.preferred_model === 'string') next.preferred_model = input.preferred_model.trim().slice(0, 160);
  if (MODEL_GUIDES.some(site => site.key === input.recommendation_site)) next.recommendation_site = input.recommendation_site;
  if (typeof input.ollama_url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(input.ollama_url.trim())) {
    next.ollama_url = input.ollama_url.trim().replace(/\/$/, '');
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
  const baseUrl = String(runtimeSettings.ollama_url || DEFAULT_OLLAMA_URL).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function capabilities() {
  const gpu = await discoverGpu();
  let models = [];
  let ollamaReady = false;
  try {
    const tags = await ollamaRequest('/api/tags', { method: 'GET', signal: AbortSignal.timeout(5000) });
    models = (tags.models || []).map(model => ({
      name: model.name,
      size_gb: Math.round((Number(model.size || 0) / (1024 ** 3)) * 10) / 10,
    }));
    ollamaReady = true;
  } catch {
    ollamaReady = false;
  }
  return {
    runtime_enabled: runtimeSettings.local_runtime_enabled === true,
    install_enabled: runtimeSettings.install_enabled === true,
    provider: 'ollama',
    ollama_ready: ollamaReady,
    cpu: { logical_cores: os.cpus().length, model: os.cpus()[0]?.model || null },
    memory_gb: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    gpu,
    models,
    max_parallel_agents: runtimeSettings.max_parallel_agents,
    recommendation_sites: MODEL_GUIDES,
    secrets_included: false,
  };
}

function recommendModels(device) {
  const availableGb = device.gpu?.memory_gb || device.memory_gb * 0.55;
  const candidates = availableGb >= 40
    ? ['qwen3-coder:30b', 'deepseek-r1:32b', 'llama3.3:70b-q4_K_M']
    : availableGb >= 20
      ? ['qwen3-coder:14b', 'deepseek-r1:14b', 'gemma3:27b']
      : availableGb >= 10
        ? ['qwen3:8b', 'qwen2.5-coder:7b', 'llama3.1:8b']
        : ['qwen3:4b', 'gemma3:4b', 'phi4-mini'];
  return {
    sizing_basis: device.gpu ? 'gpu_vram' : 'system_memory_conservative_share',
    available_memory_estimate_gb: Math.round(availableGb * 10) / 10,
    recommended_models: candidates,
    recommendation_sites: MODEL_GUIDES,
    selected_recommendation_site: MODEL_GUIDES.find(site => site.key === runtimeSettings.recommendation_site) || MODEL_GUIDES[0],
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
  const response = await ollamaRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: `You are the ${name} sub-agent. Return a concise, evidence-based result.` },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });
  return { agent_key: name, content: response.message?.content || '', done: response.done === true };
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

async function installOllama() {
  if (process.platform !== 'win32') {
    const error = new Error('Automatic Ollama installation is currently supported on Windows devices only.');
    error.code = 'automatic_install_platform_not_supported';
    throw error;
  }
  return runCommand('winget.exe', ['install', '--id', 'Ollama.Ollama', '--exact', '--accept-source-agreements', '--accept-package-agreements'], 600000);
}

async function installModel(model) {
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
          execution_targets: ['local_device', 'platform_managed'],
          fallback_policies: ['none', 'require_approval', 'managed_allowed'],
          ...runtimeSettings,
          settings_path: SETTINGS_PATH,
          recommendation_sites: MODEL_GUIDES,
          automatic_delegation_allowed: false,
        });
      }
      if (action === 'settings_update') {
        if (body.settings_update_approved !== true) return err(res, 403, 'SETTINGS_APPROVAL_REQUIRED', 'settings_update_approved=true is required.');
        const settings = persistSettings(sanitizeSettings(body.settings || {}));
        return ok(res, { settings, automatic_delegation_allowed: false, secrets_included: false });
      }
      if (action === 'install_ollama') {
        if (runtimeSettings.install_enabled !== true) return err(res, 403, 'INSTALL_DISABLED', 'Local agent installation is disabled in device settings.');
        if (body.installation_approved !== true) return err(res, 403, 'INSTALL_APPROVAL_REQUIRED', 'installation_approved=true is required.');
        return ok(res, { installed: true, result: await installOllama(), next_action: 'recommend_models' });
      }
      if (action === 'install_model') {
        if (runtimeSettings.install_enabled !== true) return err(res, 403, 'INSTALL_DISABLED', 'Local agent installation is disabled in device settings.');
        if (body.model_installation_approved !== true) return err(res, 403, 'MODEL_INSTALL_APPROVAL_REQUIRED', 'model_installation_approved=true is required.');
        return ok(res, { installed: true, result: await installModel(body.model), next_action: 'capabilities' });
      }
      if (action === 'run') {
        if (runtimeSettings.local_runtime_enabled !== true) return err(res, 403, 'RUNTIME_DISABLED', 'Local agent runtime is disabled in device settings.');
        if (String(body.execution_target || 'local_device') !== 'local_device') return err(res, 409, 'MANAGED_RUNTIME_REQUIRED', 'Use the platform managed-agent API for execution_target=platform_managed.');
        const agents = validateRunRequest(body);
        const model = String(body.model || runtimeSettings.preferred_model || '').trim();
        if (!model) return err(res, 400, 'MODEL_REQUIRED', 'model is required for local execution.');
        const job = {
          job_id: `local_agent_${crypto.randomUUID()}`,
          status: 'queued',
          model,
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
      ].includes(error.code) ? 400 : 500;
      return err(res, status, error.code || 'LOCAL_AGENT_RUNTIME_ERROR', error.message);
    }
  };
}
