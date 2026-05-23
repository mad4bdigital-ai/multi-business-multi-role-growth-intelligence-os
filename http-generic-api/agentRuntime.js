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
import {
  DEFAULT_AGENT_MODEL_RUNTIME_CONFIG,
  loadAgentModelRuntimeSettings,
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
    openrouter: env.OPENROUTER_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai:    env.OPENAI_API_KEY,
    gemini:    env.GOOGLE_AI_API_KEY,
  };
}

function openRouterOptionalConfig(env = process.env) {
  return {
    site_url: env.OPENROUTER_SITE_URL,
    app_name: env.OPENROUTER_APP_NAME,
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

export async function resolveAgentModelProviderAsync(execution_class = "standard", env = process.env) {
  const settings = await loadAgentModelRuntimeSettings();
  return resolveAgentModelSelection({ execution_class, env, config: settings.config });
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
  const settings = await loadAgentModelRuntimeSettings();
  const selection = resolveAgentModelSelection({
    execution_class,
    env: process.env,
    config: settings.config || DEFAULT_AGENT_MODEL_RUNTIME_CONFIG,
  });
  const cacheKey = `${selection.execution_class}:${selection.provider}:${selection.model}:async`;
  if (_classCache[cacheKey]) return _classCache[cacheKey];

  const keys = apiKeyByProvider(process.env);
  _classCache[cacheKey] = buildCallModel({
    provider: selection.provider,
    model: selection.model,
    api_key: keys[selection.provider],
    ...openRouterOptionalConfig(process.env),
  });
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
    resolveAgentModelProvider,
    resolveAgentModelProviderAsync,
  };

  return _singleton;
}

// Allow tests / app bootstrap to override the singleton before first use.
export function setAgentDeps(deps) {
  _singleton = deps;
}
