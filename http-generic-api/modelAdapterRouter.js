// Model-agnostic adapter router.
// Normalises request/response between Anthropic, OpenAI, and Google formats so
// skills run identically regardless of which AI frontend triggered the call.

function normalizeAnthropicResponse(raw = {}) {
  const textBlock = (raw.content || []).find(b => b.type === "text");
  const toolBlocks = (raw.content || []).filter(b => b.type === "tool_use");
  return {
    content: textBlock?.text || "",
    tool_calls: toolBlocks.map(b => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
    })),
    tokens_used: (raw.usage?.input_tokens || 0) + (raw.usage?.output_tokens || 0),
  };
}

function normalizeOpenAIResponse(raw = {}) {
  const msg = raw.choices?.[0]?.message || {};
  return {
    content: msg.content || "",
    tool_calls: (msg.tool_calls || []).map(tc => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
    tokens_used: raw.usage?.total_tokens || 0,
  };
}

function normalizeGeminiResponse(raw = {}) {
  const part = raw.candidates?.[0]?.content?.parts?.[0] || {};
  const fnCall = part.functionCall;
  return {
    content: part.text || "",
    tool_calls: fnCall
      ? [{ id: `gc_${Date.now()}`, type: "function",
           function: { name: fnCall.name, arguments: JSON.stringify(fnCall.args || {}) } }]
      : [],
    tokens_used: raw.usageMetadata?.totalTokenCount || 0,
  };
}

function toolsToGemini(tools = []) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

function toolsToAnthropic(tools = []) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: "object", properties: {} },
  }));
}

function sanitizeUpstreamErrorBody(text = "") {
  return String(text || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s\"'`]+/gi, "$1[REDACTED]")
    .replace(/(x-api-key\s*:\s*)[^\s\"'`]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|private[_-]?key)\s*[=:]\s*)[^\s,;\"'`]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|private[_-]?key)\"\s*:\s*\")[^\"]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers, attempt, config = {}) {
  const retryAfter = headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 30_000));
    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return Math.max(0, Math.min(retryAt - Date.now(), 30_000));
  }
  const base = Math.max(250, Math.min(Number(config.retry_base_ms || process.env.MODEL_PROVIDER_RETRY_BASE_MS || 1000), 10_000));
  return Math.min(base * (2 ** attempt), 30_000);
}

function shouldRetryModelStatus(status) {
  return [429, 500, 502, 503, 504].includes(Number(status));
}

async function fetchModelJsonWithRetry({ provider, fetchFn, url, request, normalize, config = {} }) {
  const maxRetries = Math.max(0, Math.min(Number(config.max_retries ?? process.env.MODEL_PROVIDER_MAX_RETRIES ?? 1), 5));
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetchFn(url, request);
    if (res.ok) return normalize(await res.json());

    const body = sanitizeUpstreamErrorBody(await res.text().catch(() => ""));
    lastError = new Error(`${provider} API ${res.status}: ${body}`);
    lastError.status = res.status;

    if (attempt < maxRetries && shouldRetryModelStatus(res.status)) {
      const delayMs = parseRetryAfterMs(res.headers, attempt, config);
      console.warn("[modelAdapter] retrying model provider request", {
        provider: String(provider || "").toLowerCase(),
        status: res.status,
        attempt: attempt + 1,
        max_retries: maxRetries,
        delay_ms: delayMs,
      });
      await sleep(delayMs);
      continue;
    }

    throw lastError;
  }

  throw lastError || new Error(`${provider} API request failed`);
}

async function callAnthropic(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const apiKey = config.api_key || process.env.ANTHROPIC_API_KEY;
  const model  = config.model  || "claude-sonnet-4-6";
  const system = messages.find(m => m.role === "system")?.content || "";
  const msgs   = messages.filter(m => m.role !== "system");

  const body = { model, max_tokens: config.max_tokens || 4096, messages: msgs };
  if (system) body.system = system;
  if (tools.length) body.tools = toolsToAnthropic(tools);

  const res = await _fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  return normalizeAnthropicResponse(await res.json());
}

async function callOpenAI(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const apiKey = config.api_key || process.env.OPENAI_API_KEY;
  const model  = config.model  || "gpt-4o";

  const body = { model, messages };
  if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }

  const res = await _fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  return normalizeOpenAIResponse(await res.json());
}

async function callOpenRouter(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const apiKey = config.api_key || process.env.OPENROUTER_API_KEY;
  const model = config.model || "openrouter/free";

  const body = { model, messages };
  if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  if (config.max_tokens) body.max_tokens = config.max_tokens;

  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const siteUrl = config.site_url || process.env.OPENROUTER_SITE_URL;
  const appName = config.app_name || process.env.OPENROUTER_APP_NAME;
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (appName) headers["X-Title"] = appName;

  const res = await _fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);
  return normalizeOpenAIResponse(await res.json());
}

async function callOllama(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const model = config.model || process.env.OLLAMA_MODEL || "qwen3:8b";
  const baseUrl = String(config.base_url || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const body = { model, messages, stream: false };
  if (tools.length) body.tools = tools;
  const res = await _fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama API ${res.status}: ${sanitizeUpstreamErrorBody(await res.text())}`);
  const raw = await res.json();
  return {
    content: raw.message?.content || "",
    tool_calls: raw.message?.tool_calls || [],
    tokens_used: Number(raw.prompt_eval_count || 0) + Number(raw.eval_count || 0),
  };
}

async function callOpenAICompatible(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const model = config.model || process.env.LOCAL_OPENAI_COMPATIBLE_MODEL || "local-model";
  const baseUrl = String(config.base_url || process.env.LOCAL_OPENAI_COMPATIBLE_BASE_URL || "http://127.0.0.1:8000/v1").replace(/\/$/, "");
  const body = { model, messages };
  if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  const headers = { "content-type": "application/json" };
  const apiKey = config.api_key || process.env.LOCAL_OPENAI_COMPATIBLE_API_KEY;
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await _fetch(`${baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${sanitizeUpstreamErrorBody(await res.text())}`);
  return normalizeOpenAIResponse(await res.json());
}

async function callGemini(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const apiKey = config.api_key || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const model  = config.model  || "gemini-3.5-flash";
  const system = messages.find(m => m.role === "system")?.content;
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content || "" }] }));

  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools.length) body.tools = [{ functionDeclarations: toolsToGemini(tools) }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return fetchModelJsonWithRetry({
    provider: "Gemini",
    fetchFn: _fetch,
    url,
    request: {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    normalize: normalizeGeminiResponse,
    config,
  });
}

const PROVIDERS = { anthropic: callAnthropic, openai: callOpenAI, openrouter: callOpenRouter, gemini: callGemini, ollama: callOllama, openai_compatible: callOpenAICompatible };

// Returns a callModel(messages, tools) function bound to the chosen provider.
// provider: "anthropic" | "openai" | "openrouter" | "gemini"  (default: anthropic)
export function buildCallModel(config = {}) {
  const provider = String(config.provider || process.env.AGENT_MODEL_PROVIDER || "anthropic").toLowerCase();
  const caller = PROVIDERS[provider];
  if (!caller) throw new Error(`Unknown model provider: ${provider}. Use anthropic | openai | openrouter | gemini | ollama | openai_compatible`);
  const modelKey = config.model || process.env.AGENT_MODEL || process.env.OPENROUTER_MODEL || process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || "unknown";
  const callModel = async (messages, tools = []) => {
    const response = await caller(messages, tools, config);
    return { ...response, provider_key: provider, model_key: modelKey };
  };
  callModel.provider_key = provider;
  callModel.providerKey = provider;
  callModel.model_key = modelKey;
  callModel.modelKey = modelKey;
  return callModel;
}
