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

async function callGemini(messages, tools, config = {}) {
  const { fetch: _fetch = fetch } = config;
  const apiKey = config.api_key || process.env.GOOGLE_AI_API_KEY;
  const model  = config.model  || "gemini-1.5-pro";
  const system = messages.find(m => m.role === "system")?.content;
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content || "" }] }));

  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools.length) body.tools = [{ functionDeclarations: toolsToGemini(tools) }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await _fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  return normalizeGeminiResponse(await res.json());
}

const PROVIDERS = { anthropic: callAnthropic, openai: callOpenAI, openrouter: callOpenRouter, gemini: callGemini };

// Returns a callModel(messages, tools) function bound to the chosen provider.
// provider: "anthropic" | "openai" | "openrouter" | "gemini"  (default: anthropic)
export function buildCallModel(config = {}) {
  const provider = String(config.provider || process.env.AGENT_MODEL_PROVIDER || "anthropic").toLowerCase();
  const caller = PROVIDERS[provider];
  if (!caller) throw new Error(`Unknown model provider: ${provider}. Use anthropic | openai | openrouter | gemini`);
  return (messages, tools = []) => caller(messages, tools, config);
}
