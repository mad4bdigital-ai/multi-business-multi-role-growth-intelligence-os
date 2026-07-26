import { getPool } from "./db.js";
import { decryptToken } from "./tokenEncryption.js";
import { buildCallModel } from "./modelAdapterRouter.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const CERTIFICATION_KEY = "openclaude_platform_provider_bridge_v1";
const MODEL_POLICY_KEY = "openrouter_model_selection_policy_v1";
const INSTRUCTION_CONTRACT_KEY = "docs_agent_openrouter_instruction_contract_v1";

function safeParseJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

function fail(code, message, details = {}, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.status = status;
  throw err;
}

function clampText(value = "", limit = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function normalizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .slice(0, 20)
    .map((message = {}) => ({
      role: ["system", "user", "assistant"].includes(String(message.role || "")) ? String(message.role) : "user",
      content: clampText(message.content || message.text || "", 8000),
    }))
    .filter((message) => message.content);
}

function normalizeTools() {
  return [];
}

async function loadOpenRouterApiKey(pool = getPool()) {
  const [rows] = await pool.query(
    `SELECT secret_key, status, value_ciphertext, value_sha256 IS NOT NULL AS has_hash
       FROM platform_secrets
      WHERE secret_key = 'openrouter_api_key'
      LIMIT 1`
  );
  const row = rows[0];
  if (!row) fail("openrouter_platform_secret_missing", "platform secret openrouter_api_key was not found", {}, 503);
  if (row.status !== "active") fail("openrouter_platform_secret_inactive", "platform secret openrouter_api_key is not active", { status: row.status }, 503);
  if (!row.value_ciphertext) fail("openrouter_platform_secret_ciphertext_missing", "platform secret openrouter_api_key has no ciphertext", {}, 503);
  return { apiKey: decryptToken(row.value_ciphertext), hasHash: Boolean(row.has_hash) };
}

async function loadModelPolicy(pool = getPool()) {
  const [[row]] = await pool.query(
    `SELECT config_json, status
       FROM platform_runtime_config
      WHERE config_key = ?
      LIMIT 1`,
    [MODEL_POLICY_KEY]
  );
  const policy = safeParseJson(row?.config_json) || {};
  const allowed = Array.isArray(policy.allowed_model_slugs) ? policy.allowed_model_slugs.map((item) => String(item || "").trim()).filter(Boolean) : [];
  return {
    status: row?.status || "missing",
    default_model_slug: String(policy.default_model_slug || DEFAULT_MODEL),
    task_overrides: policy.task_overrides && typeof policy.task_overrides === "object" ? policy.task_overrides : {},
    allowed_model_slugs: allowed.length ? allowed : [DEFAULT_MODEL],
    require_allowlist: policy.require_allowlist !== false,
    allow_unlisted_runtime_override: policy.allow_unlisted_runtime_override === true,
    secrets_included: false,
  };
}

function resolveBridgeModel({ requestedModel = "", policy = {} } = {}) {
  const selected = String(requestedModel || policy.task_overrides?.openclaude_bridge || policy.task_overrides?.provider_smoke || policy.default_model_slug || DEFAULT_MODEL).trim();
  if (!/^[A-Za-z0-9._~/:+\-]{2,160}$/.test(selected)) fail("invalid_openrouter_model_slug", `Invalid OpenRouter model slug: ${selected}`, { selected_model: selected }, 400);
  const allowed = Array.isArray(policy.allowed_model_slugs) ? policy.allowed_model_slugs : [];
  if (policy.require_allowlist !== false && !policy.allow_unlisted_runtime_override && !allowed.includes(selected)) {
    fail("openrouter_model_not_allowlisted", `Model ${selected} is not in ${MODEL_POLICY_KEY}.allowed_model_slugs`, { selected_model: selected, allowed_model_slugs: allowed }, 403);
  }
  return selected;
}

async function assertBridgeDispatchAllowed(pool = getPool(), { profileKey = "openclaude_essam_openrouter_bridge_v1", providerKey = "openclaude_openrouter_openai_compatible" } = {}) {
  const [[certification]] = await pool.query(
    `SELECT certification_key, certification_status, dispatch_allowed, apply_allowed, requires_readback, last_evidence_ref, updated_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key = ?
      LIMIT 1`,
    [CERTIFICATION_KEY]
  );
  if (!certification || Number(certification.dispatch_allowed || 0) !== 1) {
    fail("openclaude_bridge_dispatch_not_certified", "OpenClaude bridge provider dispatch is not certified/enabled.", { certification_key: CERTIFICATION_KEY, dispatch_allowed: Number(certification?.dispatch_allowed || 0) }, 403);
  }

  const [[provider]] = await pool.query(
    `SELECT provider_key, status, policy_json
       FROM dev_agent_provider_registry
      WHERE provider_key = ?
      LIMIT 1`,
    [providerKey]
  );
  if (!provider || provider.status !== "active") fail("openclaude_openrouter_provider_inactive", "OpenClaude OpenRouter provider profile is not active.", { provider_key: providerKey, status: provider?.status || null }, 403);

  const [[profile]] = await pool.query(
    `SELECT profile_key, provider_key, status, policy_json, metadata_json, model_hint, endpoint_url
       FROM dev_agent_runtime_provider_profiles
      WHERE profile_key = ?
      LIMIT 1`,
    [profileKey]
  );
  if (!profile || profile.status !== "active" || profile.provider_key !== providerKey) {
    fail("openclaude_openrouter_profile_inactive", "OpenClaude OpenRouter runtime profile is not active or provider-bound.", { profile_key: profileKey, provider_key: profile?.provider_key || null, status: profile?.status || null }, 403);
  }

  const [[openrouter]] = await pool.query(
    `SELECT provider_key, status, secrets_returned_to_agent
       FROM ai_model_providers
      WHERE provider_key = 'openrouter_openai_compatible'
      LIMIT 1`
  );
  if (!openrouter || openrouter.status !== "active" || Number(openrouter.secrets_returned_to_agent || 0) !== 0) {
    fail("openrouter_platform_provider_not_active", "Underlying OpenRouter platform provider is not active with no-secret boundary.", { status: openrouter?.status || null }, 503);
  }

  const [[contract]] = await pool.query(
    `SELECT config_json, status
       FROM platform_runtime_config
      WHERE config_key = ?
      LIMIT 1`,
    [INSTRUCTION_CONTRACT_KEY]
  );
  const contractJson = safeParseJson(contract?.config_json) || {};
  if (contract?.status !== "active" || contractJson.activation_status !== "active_live_provider_dispatch_smoke_passed") {
    fail("openrouter_instruction_contract_not_active", "OpenRouter instruction contract has not passed active live provider smoke.", { activation_status: contractJson.activation_status || null }, 503);
  }

  return { certification, provider, profile, contract: contractJson, secrets_included: false };
}

async function recordBridgeLiveSmoke(pool, payload = {}) {
  await pool.query(
    `UPDATE platform_runtime_config
        SET config_json = JSON_SET(
              config_json,
              '$.openclaude_bridge_last_live_dispatch_at', ?,
              '$.openclaude_bridge_last_live_dispatch_ok', ?,
              '$.openclaude_bridge_last_live_dispatch_model', ?,
              '$.openclaude_bridge_last_live_dispatch_tokens_used', ?,
              '$.openclaude_bridge_last_live_dispatch_profile_key', ?,
              '$.openclaude_bridge_last_live_dispatch_provider_key', ?,
              '$.openclaude_bridge_last_live_dispatch_secrets_included', false
            ),
            updated_at = NOW()
      WHERE config_key = 'openclaude_openrouter_openai_compatible_activation_v1'`,
    [
      new Date().toISOString(),
      payload.ok === true,
      payload.model || null,
      Number(payload.tokens_used || 0),
      payload.profile_key || null,
      payload.provider_key || null,
    ]
  ).catch(() => {});
}

export async function runOpenClaudeOpenRouterLiveDispatch({ messages = [], model = "", maxTokens = 256, timeoutMs = 15000, profileKey = "openclaude_essam_openrouter_bridge_v1", providerKey = "openclaude_openrouter_openai_compatible" } = {}) {
  const pool = getPool();
  const normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length) fail("openclaude_bridge_messages_required", "At least one bounded message is required for live dispatch.", {}, 400);
  const metadata = await assertBridgeDispatchAllowed(pool, { profileKey, providerKey });
  const policy = await loadModelPolicy(pool);
  const selectedModel = resolveBridgeModel({ requestedModel: model, policy });
  const { apiKey, hasHash } = await loadOpenRouterApiKey(pool);
  if (!apiKey || apiKey.length < 16) fail("openrouter_api_key_invalid_shape", "OpenRouter API key failed local shape validation.", {}, 503);

  const boundedMaxTokens = Math.min(Math.max(Number(maxTokens) || 256, 1), 2048);
  const boundedTimeoutMs = Math.min(Math.max(Number(timeoutMs) || 15000, 1000), 30000);
  const timeoutFetch = (url, request = {}) => fetch(url, { ...request, signal: request.signal || AbortSignal.timeout(boundedTimeoutMs) });
  const callModel = buildCallModel({
    provider: "openrouter",
    api_key: apiKey,
    model: selectedModel,
    max_tokens: boundedMaxTokens,
    site_url: "https://auth.mad4b.com",
    app_name: "Mad4B Growth Intelligence Platform OpenClaude Bridge",
    max_retries: 0,
    fetch: timeoutFetch,
  });

  try {
    const response = await callModel(normalizedMessages, normalizeTools());
    const result = {
      ok: true,
      content: String(response?.content || ""),
      tool_calls: [],
      tokens_used: Number(response?.tokens_used || 0),
      model: selectedModel,
      model_source: model ? "runtime_override" : MODEL_POLICY_KEY,
      profile_key: profileKey,
      provider_key: providerKey,
      credential_hash_present: hasHash,
      allowed_tools: ["Read", "Grep", "Glob", "LS"],
      denied_tools: ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "git push", "git commit", "apply_patch"],
      provider_dispatch_attempted: true,
      local_execution_attempted: false,
      repo_mutation_allowed: false,
      secrets_included: false,
      certification_status: metadata.certification?.certification_status || null,
    };
    await recordBridgeLiveSmoke(pool, result);
    return result;
  } catch (err) {
    await recordBridgeLiveSmoke(pool, { ok: false, model: selectedModel, tokens_used: 0, profile_key: profileKey, provider_key: providerKey }).catch(() => {});
    const code = err?.name === "TimeoutError" ? "openclaude_bridge_live_dispatch_timeout" : "openclaude_bridge_live_dispatch_failed";
    fail(code, String(err.message || err).replace(/\{[\s\S]*\}/g, "[upstream_error_body_redacted]").slice(0, 240), { model: selectedModel, timeout_ms: boundedTimeoutMs }, err.status || 502);
  }
}
