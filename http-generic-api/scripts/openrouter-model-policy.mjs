#!/usr/bin/env node
import { getPool } from "../db.js";

const CONFIG_KEY = "openrouter_model_selection_policy_v1";
const PROVIDER_KEY = "openrouter_openai_compatible";
const CONFIRM = "SET_OPENROUTER_MODEL_POLICY";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    action: "get",
    confirm: "",
    defaultModel: "",
    fallbackModel: "",
    writerModel: "",
    reviewerModel: "",
    smokeModel: "",
    addAllowed: [],
    removeAllowed: [],
    updatedBy: "openrouter_model_policy_tool",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--get") args.action = "get";
    else if (item === "--set") args.action = "set";
    else if (item === "--confirm") args.confirm = argv[++i] || "";
    else if (item.startsWith("--confirm=")) args.confirm = item.slice("--confirm=".length);
    else if (item === "--default-model") { args.defaultModel = argv[++i] || ""; args.action = "set"; }
    else if (item.startsWith("--default-model=")) { args.defaultModel = item.slice("--default-model=".length); args.action = "set"; }
    else if (item === "--fallback-model") { args.fallbackModel = argv[++i] || ""; args.action = "set"; }
    else if (item.startsWith("--fallback-model=")) { args.fallbackModel = item.slice("--fallback-model=".length); args.action = "set"; }
    else if (item === "--writer-model") { args.writerModel = argv[++i] || ""; args.action = "set"; }
    else if (item.startsWith("--writer-model=")) { args.writerModel = item.slice("--writer-model=".length); args.action = "set"; }
    else if (item === "--reviewer-model") { args.reviewerModel = argv[++i] || ""; args.action = "set"; }
    else if (item.startsWith("--reviewer-model=")) { args.reviewerModel = item.slice("--reviewer-model=".length); args.action = "set"; }
    else if (item === "--smoke-model") { args.smokeModel = argv[++i] || ""; args.action = "set"; }
    else if (item.startsWith("--smoke-model=")) { args.smokeModel = item.slice("--smoke-model=".length); args.action = "set"; }
    else if (item === "--add-allowed") { args.addAllowed.push(argv[++i] || ""); args.action = "set"; }
    else if (item.startsWith("--add-allowed=")) { args.addAllowed.push(item.slice("--add-allowed=".length)); args.action = "set"; }
    else if (item === "--remove-allowed") { args.removeAllowed.push(argv[++i] || ""); args.action = "set"; }
    else if (item.startsWith("--remove-allowed=")) { args.removeAllowed.push(item.slice("--remove-allowed=".length)); args.action = "set"; }
    else if (item === "--updated-by") args.updatedBy = argv[++i] || args.updatedBy;
    else if (item.startsWith("--updated-by=")) args.updatedBy = item.slice("--updated-by=".length);
  }
  return args;
}

function normalizeSlug(value = "") {
  return String(value || "").trim();
}

function assertModelSlug(value = "") {
  const slug = normalizeSlug(value);
  if (!slug) return "";
  if (!/^[A-Za-z0-9._~/:+\-]{2,160}$/.test(slug) || slug.includes("..") || slug.startsWith("/") || slug.endsWith("/")) {
    const err = new Error(`Invalid OpenRouter model slug: ${slug}`);
    err.code = "invalid_openrouter_model_slug";
    throw err;
  }
  return slug;
}

function uniqueSorted(values = []) {
  return [...new Set(values.map(assertModelSlug).filter(Boolean))].sort();
}

function safeParseJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function defaultPolicy() {
  return {
    policy_key: CONFIG_KEY,
    provider_key: PROVIDER_KEY,
    default_model_slug: DEFAULT_MODEL,
    fallback_model_slug: DEFAULT_MODEL,
    allowed_model_slugs: [DEFAULT_MODEL],
    task_overrides: {
      docs_agent_writer: DEFAULT_MODEL,
      docs_agent_reviewer: DEFAULT_MODEL,
      provider_smoke: DEFAULT_MODEL,
    },
    require_allowlist: true,
    allow_runtime_override: true,
    allow_unlisted_runtime_override: false,
    status: "active",
    updated_by: "migration_seed",
    secrets_included: false,
  };
}

async function readPolicy(pool) {
  const [rows] = await pool.query(
    `SELECT config_json, status
       FROM platform_runtime_config
      WHERE config_key = ?
      LIMIT 1`,
    [CONFIG_KEY]
  );
  const policy = { ...defaultPolicy(), ...(safeParseJson(rows[0]?.config_json) || {}) };
  policy.status = rows[0]?.status || policy.status || "active";
  policy.allowed_model_slugs = uniqueSorted(policy.allowed_model_slugs || [DEFAULT_MODEL]);
  policy.task_overrides = policy.task_overrides && typeof policy.task_overrides === "object" ? policy.task_overrides : {};
  policy.secrets_included = false;
  return policy;
}

function resolveUpdatedPolicy(policy, args) {
  const next = JSON.parse(JSON.stringify(policy || defaultPolicy()));
  const additions = uniqueSorted(args.addAllowed || []);
  const removals = new Set(uniqueSorted(args.removeAllowed || []));
  const explicitModels = uniqueSorted([args.defaultModel, args.fallbackModel, args.writerModel, args.reviewerModel, args.smokeModel]);

  next.allowed_model_slugs = uniqueSorted([...(next.allowed_model_slugs || []), ...additions, ...explicitModels]).filter((slug) => !removals.has(slug));
  if (args.defaultModel) next.default_model_slug = assertModelSlug(args.defaultModel);
  if (args.fallbackModel) next.fallback_model_slug = assertModelSlug(args.fallbackModel);
  next.task_overrides = next.task_overrides || {};
  if (args.writerModel) next.task_overrides.docs_agent_writer = assertModelSlug(args.writerModel);
  if (args.reviewerModel) next.task_overrides.docs_agent_reviewer = assertModelSlug(args.reviewerModel);
  if (args.smokeModel) next.task_overrides.provider_smoke = assertModelSlug(args.smokeModel);

  const required = uniqueSorted([
    next.default_model_slug,
    next.fallback_model_slug,
    next.task_overrides.docs_agent_writer,
    next.task_overrides.docs_agent_reviewer,
    next.task_overrides.provider_smoke,
  ]);
  const missing = required.filter((slug) => !next.allowed_model_slugs.includes(slug));
  if (missing.length) {
    const err = new Error(`Model slug(s) not in allowlist: ${missing.join(", ")}`);
    err.code = "openrouter_model_not_allowlisted";
    err.details = { missing };
    throw err;
  }

  next.policy_key = CONFIG_KEY;
  next.provider_key = PROVIDER_KEY;
  next.require_allowlist = true;
  next.allow_runtime_override = true;
  next.allow_unlisted_runtime_override = false;
  next.status = "active";
  next.updated_by = args.updatedBy || "openrouter_model_policy_tool";
  next.updated_at = new Date().toISOString();
  next.secrets_included = false;
  return next;
}

async function writePolicy(pool, policy) {
  await pool.query(
    `INSERT INTO platform_runtime_config (config_key, config_json, status, note)
     VALUES (?, CAST(? AS JSON), 'active', 'OpenRouter model selection policy for platform-controlled model routing. No secrets.')
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = 'active',
       note = VALUES(note),
       updated_at = NOW()`,
    [CONFIG_KEY, JSON.stringify(policy)]
  );

  const writerModel = policy.task_overrides?.docs_agent_writer || policy.default_model_slug || DEFAULT_MODEL;
  const reviewerModel = policy.task_overrides?.docs_agent_reviewer || policy.default_model_slug || DEFAULT_MODEL;
  const fallbackModel = policy.fallback_model_slug || policy.default_model_slug || DEFAULT_MODEL;

  await pool.query(
    `UPDATE ai_model_registry
        SET cost_policy_json = JSON_SET(COALESCE(cost_policy_json, JSON_OBJECT()), '$.default_model_slug', ?, '$.fallback_model_slug', ?),
            notes = CONCAT(COALESCE(NULLIF(notes,''),''), ' Model selection policy updated from ', ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE model_key = 'openrouter_docs_agent_writer_v1'`,
    [writerModel, fallbackModel, CONFIG_KEY]
  );
  await pool.query(
    `UPDATE ai_model_registry
        SET cost_policy_json = JSON_SET(COALESCE(cost_policy_json, JSON_OBJECT()), '$.default_model_slug', ?, '$.fallback_model_slug', ?),
            notes = CONCAT(COALESCE(NULLIF(notes,''),''), ' Model selection policy updated from ', ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE model_key = 'openrouter_docs_agent_reviewer_v1'`,
    [reviewerModel, fallbackModel, CONFIG_KEY]
  );
}

export async function runOpenRouterModelPolicy(args = parseArgs()) {
  const pool = getPool();
  const current = await readPolicy(pool);
  if (args.action === "get") {
    return { ok: true, action: "get", policy: current, secrets_included: false };
  }
  if (args.confirm !== CONFIRM) {
    const err = new Error(`Use --confirm=${CONFIRM} to update OpenRouter model policy.`);
    err.code = "openrouter_model_policy_confirmation_required";
    err.details = { expected_confirm: CONFIRM };
    throw err;
  }
  const next = resolveUpdatedPolicy(current, args);
  await writePolicy(pool, next);
  return { ok: true, action: "set", policy: next, secrets_included: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  runOpenRouterModelPolicy(args)
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "openrouter_model_policy_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
