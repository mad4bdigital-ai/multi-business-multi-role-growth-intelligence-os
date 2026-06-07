#!/usr/bin/env node
import { getPool } from "../db.js";
import { decryptToken } from "../tokenEncryption.js";
import { buildCallModel } from "../modelAdapterRouter.js";

const CONFIRM_PROMOTE = "PROMOTE_OPENROUTER_PROVIDER_ACTIVE_AFTER_LIVE_SMOKE";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    model: "openai/gpt-4o-mini",
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

async function readRuntimeContract(pool) {
  const [rows] = await pool.query(
    `SELECT config_json
       FROM platform_runtime_config
      WHERE config_key = 'docs_agent_openrouter_instruction_contract_v1'
      LIMIT 1`
  );
  const raw = rows[0]?.config_json;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function updateSmokeStatus(pool, { ok, model, tokensUsed, promoted }) {
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
  const { apiKey, hasHash } = await loadOpenRouterApiKey(pool);
  if (!apiKey || apiKey.length < 16) fail("openrouter_api_key_invalid_shape", "OpenRouter API key failed local shape validation");

  const callModel = buildCallModel({
    provider: "openrouter",
    api_key: apiKey,
    model: options.model || "openai/gpt-4o-mini",
    max_tokens: options.maxTokens || 8,
    site_url: "https://auth.mad4b.com",
    app_name: "Mad4B Growth Intelligence Platform",
    max_retries: 0,
  });

  let response;
  try {
    response = await callModel([
      { role: "system", content: "You are a provider smoke test. Reply with exactly OK." },
      { role: "user", content: "Return exactly OK." },
    ], []);
  } catch (err) {
    await updateSmokeStatus(pool, { ok: false, model: options.model, tokensUsed: 0, promoted: false }).catch(() => {});
    fail("openrouter_live_smoke_failed", err.message || "OpenRouter live smoke failed", { status: err.status || null });
  }

  const content = String(response?.content || "").trim();
  const ok = /^OK\.?$/i.test(content) || content.length > 0;
  if (!ok) fail("openrouter_live_smoke_empty_response", "OpenRouter returned an empty response");

  const shouldPromote = options.promoteActive === true;
  if (shouldPromote && options.confirm !== CONFIRM_PROMOTE) {
    fail("openrouter_active_promotion_confirmation_required", `Use --confirm ${CONFIRM_PROMOTE} with --promote-active to update provider/model statuses`, { expected_confirm: CONFIRM_PROMOTE });
  }
  if (shouldPromote) await promoteActive(pool);
  await updateSmokeStatus(pool, { ok: true, model: options.model, tokensUsed: response?.tokens_used || 0, promoted: shouldPromote });

  return {
    ok: true,
    provider_key: "openrouter_openai_compatible",
    model: options.model,
    response_nonempty: content.length > 0,
    response_preview: content.slice(0, 12),
    tokens_used: response?.tokens_used || 0,
    credential_hash_present: hasHash,
    instruction_contract_activation_status: contract.activation_status || null,
    promoted_active: shouldPromote,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  runOpenRouterProviderSmoke(args)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((err) => {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: { code: err.code || "openrouter_provider_smoke_failed", message: err.message, details: err.details || undefined },
        secrets_included: false,
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}
