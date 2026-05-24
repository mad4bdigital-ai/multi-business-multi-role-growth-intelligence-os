import assert from "node:assert/strict";
import {
  normalizeAgentModelRuntimeConfig,
  resolveAgentModelCandidateChain,
  resolveAgentModelSelection,
  summarizeModelRuntimeSettings,
} from "./agentModelRuntimeSettings.js";
import { buildCallModel } from "./modelAdapterRouter.js";

{
  const config = normalizeAgentModelRuntimeConfig({
    provider_order: ["gemini", "openrouter", "unknown"],
    providers: {
      openrouter: {
        enabled: true,
        credential_env_var: "OPENROUTER_API_KEY",
        default_model: "openrouter/free",
        models: { standard: "openrouter/free" },
      },
    },
  });
  assert.deepEqual(config.provider_order, ["gemini", "openrouter"]);
  assert.equal(config.providers.openrouter.models.standard, "openrouter/free");
  assert.equal(config.providers.openrouter.models.complex, "openrouter/free");
}

{
  assert.throws(
    () => normalizeAgentModelRuntimeConfig({ providers: { openrouter: { api_key: "secret" } } }),
    /must not contain secret field/
  );
}

{
  const config = normalizeAgentModelRuntimeConfig({
    provider_order: ["gemini", "openrouter", "openai", "anthropic"],
  });
  const selection = resolveAgentModelSelection({
    execution_class: "standard",
    env: { GEMINI_API_KEY: "present", OPENROUTER_API_KEY: "present", OPENAI_API_KEY: "present" },
    config,
  });
  assert.equal(selection.provider, "gemini");
  assert.equal(selection.model, "gemini-3.5-flash");
  assert.equal(selection.source, "platform_runtime_config");
}

{
  const config = normalizeAgentModelRuntimeConfig({ provider_order: ["gemini", "openrouter", "openai"] });
  const selection = resolveAgentModelSelection({
    execution_class: "standard",
    env: { OPENAI_API_KEY: "present" },
    config,
  });
  assert.equal(selection.provider, "openai");
  assert.equal(selection.credential_env_var, "OPENAI_API_KEY");
}

{
  const config = normalizeAgentModelRuntimeConfig({ provider_order: ["gemini", "openrouter", "openai"] });
  const candidates = resolveAgentModelCandidateChain({
    execution_class: "standard",
    env: { GEMINI_API_KEY: "present", OPENROUTER_API_KEY: "present", OPENAI_API_KEY: "present" },
    config,
  });
  assert.deepEqual(candidates.map(c => c.provider), ["gemini", "openrouter", "openai"]);
  assert.deepEqual(candidates.map(c => c.model), ["gemini-3.5-flash", "openrouter/free", "gpt-4o-mini"]);
}

{
  const config = normalizeAgentModelRuntimeConfig({
    provider_order: ["openrouter", "openai"],
    providers: {
      gemini: {
        enabled: true,
        credential_env_var: "GOOGLE_AI_API_KEY",
        default_model: "gemini-1.5-flash",
        models: { standard: "gemini-1.5-flash" },
      },
    },
  });
  const selection = resolveAgentModelSelection({
    execution_class: "standard",
    env: { AGENT_MODEL_PROVIDER: "gemini", GOOGLE_AI_API_KEY: "present" },
    config,
  });
  assert.equal(selection.provider, "gemini");
  assert.equal(selection.source, "env_provider");
}

{
  const summary = summarizeModelRuntimeSettings(
    normalizeAgentModelRuntimeConfig({ provider_order: ["openrouter"] }),
    { OPENROUTER_API_KEY: "present" }
  );
  assert.equal(summary.providers.openrouter.credential_configured, true);
  assert(!JSON.stringify(summary).includes("present"), "settings summary must not expose secret values");
}

{
  const calls = [];
  const callModel = buildCallModel({
    provider: "gemini",
    model: "gemini-3.5-flash",
    api_key: "gemini-key",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: "gemini-ok" }] } }], usageMetadata: { totalTokenCount: 2 } };
        },
      };
    },
  });
  const response = await callModel([{ role: "user", content: "ping" }], []);
  assert.equal(response.content, "gemini-ok");
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  assert.equal(calls[0].options.headers["x-goog-api-key"], "gemini-key");
}

{
  const calls = [];
  const callModel = buildCallModel({
    provider: "openrouter",
    model: "openrouter/free",
    api_key: "test-key",
    site_url: "https://auth.mad4b.com",
    app_name: "Mad4B Platform",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "ok" } }], usage: { total_tokens: 3 } };
        },
      };
    },
  });
  const response = await callModel([{ role: "user", content: "ping" }], []);
  assert.equal(response.content, "ok");
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-key");
  assert.equal(calls[0].options.headers["HTTP-Referer"], "https://auth.mad4b.com");
  assert.equal(calls[0].options.headers["X-Title"], "Mad4B Platform");
}

console.log("agent model runtime settings tests passed");
