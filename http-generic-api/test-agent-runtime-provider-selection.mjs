import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const source = readFileSync(join(__dirname, "agentRuntime.js"), "utf8");

assert(
  source.includes("function resolveAgentModelProvider"),
  "agentRuntime must centralize model provider selection"
);

assert(
  source.includes("if (explicit) return explicit"),
  "explicit AGENT_MODEL_PROVIDER must remain the first priority"
);

assert(
  source.includes("env.OPENROUTER_API_KEY") && source.includes('return "openrouter"'),
  "provider auto-selection should support OpenRouter when its key exists"
);
assert(
  source.includes("env.OPENAI_API_KEY") && source.includes('return "openai"'),
  "provider auto-selection should support OpenAI fallback when configured"
);

assert(
  source.includes("const provider = resolveAgentModelProvider(process.env);"),
  "class and singleton model deps must use auto-selected provider"
);

console.log("agent runtime provider selection tests passed");
