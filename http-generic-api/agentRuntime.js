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

function buildAgentDeps(config = {}) {
  const callModel = buildCallModel({
    provider: config.provider,
    model:    config.model,
    api_key:  config.api_key,
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

// Models per execution_class per provider.
const CLASS_MODELS = {
  standard:  { anthropic: "claude-haiku-4-5-20251001", openai: "gpt-4o-mini",  gemini: "gemini-1.5-flash" },
  complex:   { anthropic: "claude-sonnet-4-6",          openai: "gpt-4o",       gemini: "gemini-1.5-pro"  },
  authority: { anthropic: "claude-opus-4-7",            openai: "gpt-4o",       gemini: "gemini-1.5-pro"  },
};

function resolveAgentModelProvider(env = process.env) {
  const explicit = String(env.AGENT_MODEL_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.GOOGLE_AI_API_KEY) return "gemini";
  return "anthropic";
}

let _classCache = {};

export function getCallModelForClass(execution_class) {
  const cls = execution_class || "standard";
  if (_classCache[cls]) return _classCache[cls];

  // AGENT_MODEL env var opts out of class routing for all classes.
  if (process.env.AGENT_MODEL) {
    _classCache[cls] = getAgentDeps().callModel;
    return _classCache[cls];
  }

  const provider = resolveAgentModelProvider(process.env);
  const apiKeyByProvider = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    gemini:    process.env.GOOGLE_AI_API_KEY,
  };
  const table = CLASS_MODELS[cls] || CLASS_MODELS.standard;
  const model = table[provider] || table.anthropic;

  _classCache[cls] = buildCallModel({ provider, model, api_key: apiKeyByProvider[provider] });
  return _classCache[cls];
}

let _singleton = null;

export function getAgentDeps() {
  if (_singleton) return _singleton;

  // Provider resolution order: explicit AGENT_MODEL_PROVIDER, then first provider
  // with a configured key. This keeps Hostinger stable when only one model
  // provider secret is present.
  const provider = resolveAgentModelProvider(process.env);
  const apiKeyByProvider = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    gemini:    process.env.GOOGLE_AI_API_KEY,
  };

  _singleton = {
    ...buildAgentDeps({
      provider,
      model:   process.env.AGENT_MODEL,
      api_key: apiKeyByProvider[provider],
    }),
    getCallModelForClass,
  };

  return _singleton;
}

// Allow tests / app bootstrap to override the singleton before first use.
export function setAgentDeps(deps) {
  _singleton = deps;
}
