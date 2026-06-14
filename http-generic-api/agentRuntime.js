// agentRuntime.js — composed agent execution dependencies (singleton)
//
// Wires together buildCallModel → runLogicWithModel → buildEngineExecutorRegistry
// into a single deps object that agentLoopRunner.runAgentLoop() accepts.
//
// Usage:
//   import { getAgentDeps } from "./agentRuntime.js";
//   const result = await runAgentLoop(plan, { ...getAgentDeps(), workflowDef });

import { buildCallModel } from "./modelAdapterRouter.js";
import { runLogicWithModel } from "./modelAdapter.js";
import { buildEngineExecutorRegistry } from "./engineExecutorRegistry.js";
import { buildGovernedAgentExecutionContext } from "./governedAgentExecutionContext.js";
import { authorizeAgentToolCall, filterAuthorizedAgentTools } from "./agentToolAuthorizationGate.js";
import {
  DEFAULT_AGENT_MODEL_RUNTIME_CONFIG,
  loadAgentModelRuntimeSettings,
  resolveAgentModelCandidateChain,
  resolveAgentModelSelection,
} from "./agentModelRuntimeSettings.js";

function buildAgentDeps(config = {}) {
  const callModel = buildCallModel({
    provider: config.provider,
    model:    config.model,
    api_key:  config.api_key,
    site_url: config.site_url,
    app_name: config.app_name,
  });

  function boundRunLogic(input, extraDeps = {}) {
    return runLogicWithModel(input, { callModel, ...extraDeps });
  }

  const engineExecutorRegistry = buildEngineExecutorRegistry({
    callModel,
    runLogicWithModel: boundRunLogic,
    // MCP and HTTP action dispatchers are optional; when absent, registry returns
    // a graceful error rather than throwing. Callers can extend via registry.register().
    dispatchMcpTool: config.dispatchMcpTool || null,
    callHttpAction:  config.callHttpAction  || null,
  });

  return {
    callModel,
    runLogicWithModel: boundRunLogic,
    engineExecutorRegistry,
    buildGovernedContext: config.buildGovernedContext || buildGovernedAgentExecutionContext,
  };
}

// Legacy env-only fallback models. Governed runtime selection should use
// platform_runtime_config.agent_model_runtime through getCallModelForClassAsync.
const CLASS_MODELS = {
  standard:  { gemini: "gemini-3.5-flash", openrouter: "openrouter/free", openai: "gpt-4o-mini", anthropic: "claude-haiku-4-5-20251001" },
  complex:   { gemini: "gemini-3.5-flash", openrouter: "openrouter/free", openai: "gpt-4o",      anthropic: "claude-sonnet-4-6" },
  authority: { gemini: "gemini-3.5-flash", openrouter: "openrouter/free", openai: "gpt-4o",      anthropic: "claude-opus-4-7" },
};

function apiKeyByProvider(env = process.env) {
  return {
    gemini:    env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    openai:    env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
  };
}

function openRouterOptionalConfig(env = process.env) {
  return {
    site_url: env.OPENROUTER_SITE_URL,
    app_name: env.OPENROUTER_APP_NAME,
  };
}

function isRetryableModelProviderError(error) {
  const message = String(error?.message || error || "");
  return /\b(401|403|408|409|425|429|500|502|503|504)\b/.test(message) ||
    /rate|quota|timeout|temporar|unavailable|invalid\s+(api key|x-api-key|credential)/i.test(message);
}

function buildProviderCallModel(candidate, env = process.env) {
  const keys = apiKeyByProvider(env);
  return buildCallModel({
    provider: candidate.provider,
    model: candidate.model,
    api_key: keys[candidate.provider],
    ...openRouterOptionalConfig(env),
  });
}

function buildFallbackCallModel(candidates = [], env = process.env) {
  const usable = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!usable.length) return null;
  return async function callModelWithProviderFallback(messages, tools = []) {
    const failures = [];
    for (const candidate of usable) {
      try {
        const callModel = buildProviderCallModel(candidate, env);
        const response = await callModel(messages, tools);
        return {
          ...response,
          model_provider: candidate.provider,
          model_used: candidate.model,
          fallback_attempts: failures,
        };
      } catch (err) {
        failures.push({
          provider: candidate.provider,
          model: candidate.model,
          message: String(err?.message || err || "model_call_failed").replace(/\{[\s\S]*\}/g, "[upstream_error_body_redacted]").slice(0, 240),
        });
        if (!isRetryableModelProviderError(err)) throw err;
      }
    }
    const finalError = new Error(`all_model_providers_failed: ${failures.map(f => `${f.provider}:${f.message}`).join(" | ")}`);
    finalError.code = "all_model_providers_failed";
    finalError.failures = failures;
    throw finalError;
  };
}

export function resolveAgentModelProvider(env = process.env) {
  const explicit = String(env.AGENT_MODEL_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY) return "gemini";
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "anthropic";
}

export async function resolveAgentModelProviderAsync(execution_class = "standard", env = process.env, task_class = null) {
  const settings = await loadAgentModelRuntimeSettings();
  return resolveAgentModelSelection({ execution_class, task_class, env, config: settings.config });
}

let _classCache = {};

export function getCallModelForClass(execution_class) {
  const cls = execution_class || "standard";
  const provider = resolveAgentModelProvider(process.env);
  const table = CLASS_MODELS[cls] || CLASS_MODELS.standard;
  const model = process.env.AGENT_MODEL || table[provider] || table.anthropic;
  const cacheKey = `${cls}:${provider}:${model}:sync`;
  if (_classCache[cacheKey]) return _classCache[cacheKey];

  const keys = apiKeyByProvider(process.env);
  _classCache[cacheKey] = buildCallModel({
    provider,
    model,
    api_key: keys[provider],
    ...openRouterOptionalConfig(process.env),
  });
  return _classCache[cacheKey];
}

export async function getCallModelForClassAsync(execution_class = "standard") {
  return getCallModelForTaskAsync(null, execution_class);
}

export async function getCallModelForTaskAsync(task_class = null, execution_class = "standard") {
  const settings = await loadAgentModelRuntimeSettings();
  const config = settings.config || DEFAULT_AGENT_MODEL_RUNTIME_CONFIG;
  const candidates = resolveAgentModelCandidateChain({ execution_class, task_class, env: process.env, config });
  const selection = candidates[0] || resolveAgentModelSelection({ execution_class, task_class, env: process.env, config });
  const taskKey = selection.task_class || task_class || "class";
  const cacheKey = `${taskKey}:${selection.execution_class}:${candidates.map(c => `${c.provider}:${c.model}`).join(">") || `${selection.provider}:${selection.model}`}:async`;
  if (_classCache[cacheKey]) return _classCache[cacheKey];

  _classCache[cacheKey] = buildFallbackCallModel(candidates.length ? candidates : [selection], process.env);
  return _classCache[cacheKey];
}

let _singleton = null;

export function getAgentDeps() {
  if (_singleton) return _singleton;

  const provider = resolveAgentModelProvider(process.env);
  const table = CLASS_MODELS.standard;
  const model = process.env.AGENT_MODEL || table[provider] || table.anthropic;
  const keys = apiKeyByProvider(process.env);

  _singleton = {
    ...buildAgentDeps({
      provider,
      model,
      api_key: keys[provider],
      ...openRouterOptionalConfig(process.env),
    }),
    getCallModelForClass,
    getCallModelForClassAsync,
    getCallModelForTaskAsync,
    resolveAgentModelProvider,
    resolveAgentModelProviderAsync,
  };

  return _singleton;
}

// Allow tests / app bootstrap to override the singleton before first use.
export function setAgentDeps(deps) {
  _singleton = deps;
}
