#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { decryptToken } from "../tokenEncryption.js";
import { buildCallModel } from "../modelAdapterRouter.js";

const CONFIRM_PROMOTE = "PROMOTE_OPENROUTER_PROVIDER_ACTIVE_AFTER_LIVE_SMOKE";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    model: "",
    promoteActive: false,
    confirm: "",
    maxTokens: 8,
    timeoutMs: 15000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--model") args.model = argv[++i] || args.model;
    else if (item.startsWith("--model=")) args.model = item.slice("--model=".length);
    else if (item === "--promote-active") args.promoteActive = true;
    else if (item === "--confirm") args.confirm = argv[++i] || "";
    else if (item.startsWith("--confirm=")) args.confirm = item.slice("--confirm=".length);
    else if (item === "--max-tokens") args.maxTokens = Number(argv[++i] || args.maxTokens);
    else if (item.startsWith("--max-tokens=")) args.maxTokens = Number(item.slice("--max-tokens=".length));
    else if (item === "--timeout-ms") args.timeoutMs = Number(argv[++i] || args.timeoutMs);
    else if (item.startsWith("--timeout-ms=")) args.timeoutMs = Number(item.slice("--timeout-ms=".length));
  }
  args.maxTokens = Math.min(Math.max(Number(args.maxTokens) || 8, 1), 32);
  args.timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 15000, 1000), 30000);
  return args;
}

function fail(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  throw err;
}

async function loadOpenRouterApiKey(pool) {
  const [rows] = await pool.query(
    `SELECT secret_key, status, value_ciphertext, value_sha256 IS NOT NULL AS has_hash
       FROM platform_secrets
      WHERE secret_key = 'openrouter_api_key'
      LIMIT 1`
  );
  const row = rows[0];
  if (!row) fail("openrouter_platform_secret_missing", "platform secret openrouter_api_key was not found");
  if (row.status !== "active") fail("openrouter_platform_secret_inactive", "platform secret openrouter_api_key is not active", { status: row.status });
  if (!row.value_ciphertext) fail("openrouter_platform_secret_ciphertext_missing", "platform secret openrouter_api_key has no ciphertext");
  return { apiKey: decryptToken(row.value_ciphertext), hasHash: Boolean(row.has_hash) };
}

function safeParseJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function readRuntimeContract(pool) {
  const [rows] = await pool.query(
    `SELECT config_json
       FROM platform_runtime_config
      WHERE config_key = 'docs_agent_openrouter_instruction_contract_v1'
      LIMIT 1`
  );
  return safeParseJson(rows[0]?.config_json) || {};
}

async function readModelPolicy(pool) {
  const [rows] = await pool.query(
    `SELECT config_json
       FROM platform_runtime_config
      WHERE config_key = 'openrouter_model_selection_policy_v1'
      LIMIT 1`
  );
  const policy = safeParseJson(rows[0]?.config_json) || {};
  const allowed = Array.isArray(policy.allowed_model_slugs) ? policy.allowed_model_slugs.map((item) => String(item || "").trim()).filter(Boolean) : [];
  return {
    default_model_slug: String(policy.default_model_slug || "openai/gpt-4o-mini"),
    task_overrides: policy.task_overrides && typeof policy.task_overrides === "object" ? policy.task_overrides : {},
    allowed_model_slugs: allowed.length ? allowed : ["openai/gpt-4o-mini"],
    require_allowlist: policy.require_allowlist !== false,
    allow_unlisted_runtime_override: policy.allow_unlisted_runtime_override === true,
    secrets_included: false,
  };
}

function resolveSmokeModel({ explicitModel = "", policy = {} } = {}) {
  const selected = String(explicitModel || policy.task_overrides?.provider_smoke || policy.default_model_slug || "openai/gpt-4o-mini").trim();
  if (!/^[A-Za-z0-9._~/:+\-]{2,160}$/.test(selected)) fail("invalid_openrouter_model_slug", `Invalid OpenRouter model slug: ${selected}`);
  const allowed = Array.isArray(policy.allowed_model_slugs) ? policy.allowed_model_slugs : [];
  if (policy.require_allowlist !== false && !policy.allow_unlisted_runtime_override && !allowed.includes(selected)) {
    fail("openrouter_model_not_allowlisted", `Model ${selected} is not in openrouter_model_selection_policy_v1.allowed_model_slugs`, { selected_model: selected, allowed_model_slugs: allowed });
  }
  return selected;
}

async function updateSmokeStatus(pool, { ok, model, tokensUsed, promoted, errorCode = null }) {
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE platform_runtime_config
        SET config_json = JSON_SET(
              config_json,
              '$.activation_status', ?,
              '$.last_live_smoke_at', ?,
              '$.last_live_smoke_model', ?,
              '$.last_live_smoke_ok', ?,
              '$.last_live_smoke_tokens_used', ?,
              '$.last_live_smoke_error_code', ?,
              '$.provider_active_promoted', ?,
              '$.secrets_included', false
            ),
            updated_at = NOW()
      WHERE config_key = 'docs_agent_openrouter_instruction_contract_v1'`,
    [
      ok ? (promoted ? "active_live_provider_dispatch_smoke_passed" : "live_provider_dispatch_smoke_passed_pending_active_promotion") : "live_provider_dispatch_smoke_failed",
      now,
      model,
      ok ? true : false,
      Number(tokensUsed || 0),
      errorCode,
      promoted ? true : false,
    ]
  );
}

async function promoteActive(pool) {
  await pool.query(
    `UPDATE ai_model_providers
        SET status = 'active',
            notes = CONCAT(COALESCE(NULLIF(notes,''),''), ' Live OpenRouter provider smoke passed and provider was promoted active.'),
            updated_at = CURRENT_TIMESTAMP
      WHERE provider_key = 'openrouter_openai_compatible'
        AND secrets_returned_to_agent = 0`
  );
  await pool.query(
    `UPDATE ai_model_registry
        SET status = 'active',
            notes = CONCAT(COALESCE(NULLIF(notes,''),''), ' Live OpenRouter provider smoke passed and model profile was promoted active.'),
            updated_at = CURRENT_TIMESTAMP
      WHERE provider_key = 'openrouter_openai_compatible'`
  );
}

export async function runOpenRouterProviderSmoke(options = {}) {
  const pool = getPool();
  const contract = await readRuntimeContract(pool);
  const modelPolicy = await readModelPolicy(pool);
  const selectedModel = resolveSmokeModel({ explicitModel: options.model, policy: modelPolicy });
  const { apiKey, hasHash } = await loadOpenRouterApiKey(pool);
  if (!apiKey || apiKey.length < 16) fail("openrouter_api_key_invalid_shape", "OpenRouter API key failed local shape validation");

  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 15000, 1000), 30000);
  const timeoutFetch = (url, request = {}) => fetch(url, {
    ...request,
    signal: request.signal || AbortSignal.timeout(timeoutMs),
  });
  const callModel = buildCallModel({
    provider: "openrouter",
    api_key: apiKey,
    model: selectedModel,
    max_tokens: options.maxTokens || 8,
    site_url: "https://auth.mad4b.com",
    app_name: "Mad4B Growth Intelligence Platform",
    max_retries: 0,
    fetch: timeoutFetch,
  });

  let response;
  try {
    response = await callModel([
      { role: "system", content: "You are a provider smoke test. Reply with exactly OK." },
      { role: "user", content: "Return exactly OK." },
    ], []);
  } catch (err) {
    const errorCode = err?.name === "TimeoutError" ? "openrouter_live_smoke_timeout" : "openrouter_live_smoke_failed";
    await updateSmokeStatus(pool, { ok: false, model: selectedModel, tokensUsed: 0, promoted: false, errorCode }).catch(() => {});
    fail(errorCode, err.message || "OpenRouter live smoke failed", { status: err.status || null, timeout_ms: timeoutMs });
  }

  const content = String(response?.content || "").trim();
  const ok = /^OK\.?$/i.test(content) || content.length > 0;
  if (!ok) fail("openrouter_live_smoke_empty_response", "OpenRouter returned an empty response");

  const shouldPromote = options.promoteActive === true;
  if (shouldPromote && options.confirm !== CONFIRM_PROMOTE) {
    fail("openrouter_active_promotion_confirmation_required", `Use --confirm ${CONFIRM_PROMOTE} with --promote-active to update provider/model statuses`, { expected_confirm: CONFIRM_PROMOTE });
  }
  if (shouldPromote) await promoteActive(pool);
  await updateSmokeStatus(pool, { ok: true, model: selectedModel, tokensUsed: response?.tokens_used || 0, promoted: shouldPromote });

  return {
    ok: true,
    provider_key: "openrouter_openai_compatible",
    model: selectedModel,
    model_source: options.model ? "runtime_override" : "openrouter_model_selection_policy_v1",
    timeout_ms: timeoutMs,
    response_nonempty: content.length > 0,
    response_preview: content.slice(0, 12),
    tokens_used: response?.tokens_used || 0,
    credential_hash_present: hasHash,
    instruction_contract_activation_status: contract.activation_status || null,
    promoted_active: shouldPromote,
    secrets_included: false,
  };
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const args = parseArgs();
  runOpenRouterProviderSmoke(args)
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: { code: err.code || "openrouter_provider_smoke_failed", message: err.message, details: err.details || undefined },
        secrets_included: false,
      }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
