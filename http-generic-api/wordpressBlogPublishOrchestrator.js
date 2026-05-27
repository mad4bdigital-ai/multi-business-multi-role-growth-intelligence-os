import { randomUUID, randomBytes, createHash } from "node:crypto";
import { getPool } from "./db.js";
import { resolveEffectiveCredential } from "./credentialResolver.js";

const WORKFLOW_KEY = "wordpress_blog_publish_or_recover_credentials_workflow";

function str(value) {
  return String(value ?? "").trim();
}

function json(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function boolish(value) {
  return value === true || value === 1 || value === "1" || String(value).toUpperCase() === "TRUE";
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function normalizeWpJsonBase(raw = "") {
  const value = str(raw).replace(/\/$/, "");
  if (!value) return "";
  if (value.endsWith("/wp-json/wp/v2")) return value;
  if (value.endsWith("/wp-json")) return `${value}/wp/v2`;
  return `${value}/wp-json/wp/v2`;
}

function intakePublicBaseUrl() {
  return str(process.env.AUTH_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://auth.mad4b.com").replace(/\/$/, "");
}

async function loadBrandByPlan(plan = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const key = str(plan.target_key || plan.brand_key);
  if (!key) return null;
  const [rows] = await pool.query(
    `SELECT brand_name, normalized_brand_name, brand_domain, target_key, base_url, default_wp_api_base,
            default_post_type_slug, default_language, write_allowed, destructive_allowed, status
       FROM \`brands\`
      WHERE target_key = ? OR normalized_brand_name = ? OR brand_name = ? OR brand_domain = ?
      LIMIT 1`,
    [key, key, key, key]
  );
  return rows[0] || null;
}

function extractPublishInput(plan = {}) {
  const steps = json(plan.steps_json, []);
  const firstStep = Array.isArray(steps) ? (steps[0] || {}) : {};
  const payload = json(plan.input_json || plan.payload_json || plan.request_json, {});
  const body = json(firstStep.body || firstStep.arguments || firstStep.params, {});
  return { ...payload, ...body, ...plan };
}

function buildPostPayload(plan = {}, brand = {}) {
  const input = extractPublishInput(plan);
  const title = str(input.title || input.post_title || input.blog_title || input.subject);
  const content = str(input.content || input.post_content || input.html || input.body);
  if (!title) {
    const err = new Error("Blog publish requires title/post_title.");
    err.code = "missing_post_title";
    throw err;
  }
  if (!content) {
    const err = new Error("Blog publish requires content/post_content.");
    err.code = "missing_post_content";
    throw err;
  }

  const requestedStatus = str(input.status || input.publish_status || "draft").toLowerCase();
  const status = requestedStatus === "publish" ? "publish" : "draft";
  const slug = str(input.slug || input.post_slug);
  const excerpt = str(input.excerpt || input.meta_description);
  const postType = str(input.post_type || brand.default_post_type_slug || "posts").replace(/^\/+|\/+$/g, "") || "posts";

  const payload = { title, content, status };
  if (slug) payload.slug = slug;
  if (excerpt) payload.excerpt = excerpt;
  if (Array.isArray(input.categories)) payload.categories = input.categories;
  if (Array.isArray(input.tags)) payload.tags = input.tags;
  if (input.featured_media) payload.featured_media = Number(input.featured_media);
  if (input.meta && typeof input.meta === "object") payload.meta = input.meta;

  return { postType, payload, requestedStatus: status };
}

async function createCredentialIntakeSession({ plan, brand, reason = "credential_missing" }, deps = {}) {
  const pool = deps.pool || getPool();
  const sessionId = randomUUID();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const wpJsonBase = normalizeWpJsonBase(brand.base_url || brand.default_wp_api_base || (brand.brand_domain ? `https://${brand.brand_domain}/wp-json` : ""));
  const apiBaseUrl = wpJsonBase.replace(/\/wp\/v2$/, "");
  const schema = {
    fields: [
      { name: "username", label: "WordPress Username", type: "text", target: "credentials", required: true, secret: false, autocomplete: "username" },
      { name: "application_password", label: "WordPress Application Password", type: "password", target: "credentials", required: true, secret: true, autocomplete: "new-password" },
      { name: "api_base_url", label: "WordPress REST API Base URL", type: "url", target: "connection", required: true, secret: false }
    ],
  };
  const metadata = {
    target_key: brand.target_key || plan.target_key || "",
    brand_name: brand.brand_name || plan.brand_key || "",
    provider_family: "wordpress",
    purpose: "resume governed blog publishing",
    original_plan_id: plan.plan_id || "",
    original_workflow_key: plan.workflow_key || WORKFLOW_KEY,
    resume_intent_key: plan.intent_key || "wordpress_blog_publish_or_recover_credentials",
    reason,
  };

  await pool.query(
    `INSERT INTO credential_intake_sessions
       (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
        api_base_url, credential_schema_json, metadata_json, status, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
    [
      sessionId,
      sha256(token),
      str(plan.user_id || plan.actor_user_id || "system"),
      str(plan.tenant_id || ""),
      "wordpress_rest",
      "basic_auth",
      `${brand.brand_name || brand.target_key || "WordPress"} - WordPress Application Password`,
      apiBaseUrl,
      JSON.stringify(schema),
      JSON.stringify(metadata),
      expiresAt,
      str(plan.user_id || "gpt-admin"),
    ]
  );

  return {
    session_id: sessionId,
    intake_url: `${intakePublicBaseUrl()}/credential-intake/${token}`,
    expires_at: expiresAt,
    app_key: "wordpress_rest",
    auth_type: "basic_auth",
    field_count: schema.fields.length,
  };
}

async function resolveWordpressCredential({ plan, brand }, deps = {}) {
  return resolveEffectiveCredential({
    tenantId: plan.tenant_id,
    userId: plan.user_id,
    connectionId: plan.connection_id,
    actionKey: "wordpress_create_post",
    targetKey: brand.target_key || plan.target_key,
    credentialRole: "wordpress_rest",
    includeSecret: true,
    allowPlatformFallback: true,
  }, { pool: deps.pool, decryptCredentials: deps.decryptCredentials, decryptToken: deps.decryptToken, env: deps.env });
}

function buildAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function createWordpressPost({ brand, credential, postType, payload }, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    const err = new Error("fetch is not available for WordPress publishing.");
    err.code = "fetch_not_available";
    throw err;
  }
  const wpV2Base = normalizeWpJsonBase(brand.base_url || brand.default_wp_api_base || (brand.brand_domain ? `https://${brand.brand_domain}/wp-json` : ""));
  if (!wpV2Base) {
    const err = new Error("WordPress API base URL is unresolved for target.");
    err.code = "wordpress_base_url_unresolved";
    throw err;
  }

  const username = str(payload.username || credential.username || credential.account_label || "gpt");
  const password = str(credential.secret);
  if (!password) {
    const err = new Error("WordPress credential secret is missing after resolution.");
    err.code = "wordpress_secret_missing";
    throw err;
  }

  const response = await fetchImpl(`${wpV2Base}/${postType}`, {
    method: "POST",
    headers: {
      "Authorization": buildAuthHeader(username, password),
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!response.ok) {
    const err = new Error(`WordPress create post failed with HTTP ${response.status}.`);
    err.code = "wordpress_create_post_failed";
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return {
    ok: true,
    upstream_status: response.status,
    post_id: data?.id || null,
    link: data?.link || data?.guid?.rendered || null,
    status: data?.status || payload.status,
    type: data?.type || postType,
    readback_status: data?.id ? "created_response_contains_id" : "created_response_missing_id",
    wordpress_response: data,
  };
}

export function isWordpressBlogPublishWorkflow(workflowKey = "") {
  return str(workflowKey) === WORKFLOW_KEY;
}

export async function dispatchWordpressBlogPublish(plan = {}, deps = {}) {
  const brand = deps.brand || await loadBrandByPlan(plan, deps);
  if (!brand) {
    return { ok: false, status: "blocked", error: { code: "brand_target_not_resolved", message: "Could not resolve brand/target for WordPress blog publishing." } };
  }
  if (!boolish(brand.write_allowed)) {
    return { ok: false, status: "blocked", error: { code: "wordpress_write_not_allowed", message: `Target ${brand.target_key || brand.brand_name} is not write-enabled.` } };
  }

  const credential = await resolveWordpressCredential({ plan, brand }, deps);
  if (credential.status !== "resolved" || !credential.secret_present || !credential.secret) {
    const intake = await createCredentialIntakeSession({ plan, brand, reason: credential.status || "credential_missing" }, deps);
    return {
      ok: true,
      status: "credential_intake_required",
      credential_status: credential.status || "missing",
      credential_ref: credential.credential_ref || "",
      target_key: brand.target_key || plan.target_key || "",
      intake,
      resume: {
        workflow_key: WORKFLOW_KEY,
        plan_id: plan.plan_id || "",
        original_request_preserved: true,
      },
      output: {
        message: "Credential intake required before WordPress blog publishing can continue.",
        intake_url: intake.intake_url,
      },
    };
  }

  const { postType, payload, requestedStatus } = buildPostPayload(plan, brand);
  const created = await createWordpressPost({ brand, credential, postType, payload }, deps);
  return {
    ok: true,
    status: created.ok ? "completed" : "failed",
    credential_status: "resolved",
    target_key: brand.target_key || plan.target_key || "",
    post_status: requestedStatus,
    post_id: created.post_id,
    link: created.link,
    readback_status: created.readback_status,
    result: created,
    output: {
      post_id: created.post_id,
      link: created.link,
      status: created.status,
      readback_status: created.readback_status,
    },
  };
}

export const __test__ = {
  buildPostPayload,
  normalizeWpJsonBase,
  createCredentialIntakeSession,
};
