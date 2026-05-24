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
  source.indexOf("env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY") < source.indexOf("env.OPENROUTER_API_KEY"),
  "provider auto-selection should prefer Gemini first when a Gemini key exists"
);

assert(
  source.indexOf("env.OPENROUTER_API_KEY") < source.indexOf("env.OPENAI_API_KEY"),
  "provider auto-selection should fall back from Gemini to OpenRouter and then OpenAI when configured"
);

assert(
  source.includes("getCallModelForClassAsync"),
  "async model class selection must remain available for DB-governed provider routing"
);

assert(
  source.includes("getCallModelForTaskAsync"),
  "task-specific async model selection must remain available for summary/classification/image_edit routing"
);

assert(
  source.includes("buildFallbackCallModel"),
  "async model class selection must support provider fallback chains"
);

console.log("agent runtime provider selection tests passed");
