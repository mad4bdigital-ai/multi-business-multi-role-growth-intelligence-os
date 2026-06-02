import { randomUUID, randomBytes, createHash } from "node:crypto";
import { getPool } from "./db.js";
import { resolveEffectiveCredential } from "./credentialResolver.js";

const WORKFLOW_KEY = "wordpress_blog_publish_or_recover_credentials_workflow";

function str(value) { return String(value ?? "").trim(); }
function boolish(value) { return value === true || value === 1 || value === "1" || String(value).toUpperCase() === "TRUE"; }
function sha256(value) { return createHash("sha256").update(String(value || "")).digest("hex"); }
function token() { return randomBytes(32).toString("base64url"); }
function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeDomainFromUrl(raw = "") {
  const value = str(raw);
  if (!value) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

export function isWordpressBlogPublishWorkflow(workflowKey = "") {
  return str(workflowKey) === WORKFLOW_KEY;
}

export function normalizeWpJsonBase(raw = "") {
  const value = str(raw).replace(/\/$/, "");
  if (!value) return "";
  if (value.endsWith("/wp-json/wp/v2")) return value;
  if (value.endsWith("/wp-json")) return `${value}/wp/v2`;
  return `${value}/wp-json/wp/v2`;
}

function intakePublicBaseUrl() {
  return str(process.env.AUTH_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://auth.mad4b.com").replace(/\/$/, "");
}

async function loadBrand(plan = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const key = str(plan.target_key || plan.brand_key);
  if (!key) return null;
  const [rows] = await pool.query(
    `SELECT brand_name, normalized_brand_name, brand_domain, target_key, auth_type, username,
            base_url, default_wp_api_base, default_post_type_slug, write_allowed, destructive_allowed, status
       FROM \`brands\`
      WHERE target_key = ? OR normalized_brand_name = ? OR brand_name = ? OR brand_domain = ?
      LIMIT 1`,
    [key, key, key, key]
  );
  return rows[0] || null;
}

function extractInput(plan = {}) {
  const steps = safeJson(plan.steps_json, []);
  const first = Array.isArray(steps) ? (steps[0] || {}) : {};
  return {
    ...safeJson(plan.input_json, {}),
    ...safeJson(plan.payload_json, {}),
    ...safeJson(first.body || first.arguments || first.params, {}),
    ...plan,
  };
}

export function buildPostPayload(plan = {}, brand = {}) {
  const input = extractInput(plan);
  const title = str(input.title || input.post_title || input.blog_title || input.subject);
  const content = str(input.content || input.post_content || input.html || input.body);
  if (!title) throw Object.assign(new Error("Blog publish requires title/post_title."), { code: "missing_post_title" });
  if (!content) throw Object.assign(new Error("Blog publish requires content/post_content."), { code: "missing_post_content" });

  const requested = str(input.status || input.publish_status || "draft").toLowerCase();
  const status = requested === "publish" ? "publish" : "draft";
  const postType = str(input.post_type || brand.default_post_type_slug || "posts").replace(/^\/+|\/+$/g, "") || "posts";
  const payload = { title, content, status };
  if (input.slug) payload.slug = str(input.slug);
  if (input.excerpt || input.meta_description) payload.excerpt = str(input.excerpt || input.meta_description);
  if (Array.isArray(input.categories)) payload.categories = input.categories;
  if (Array.isArray(input.tags)) payload.tags = input.tags;
  if (input.featured_media) payload.featured_media = Number(input.featured_media);
  if (input.meta && typeof input.meta === "object") payload.meta = input.meta;
  return { postType, payload, requestedStatus: status };
}

async function createCredentialIntakeSession({ plan, brand, reason }, deps = {}) {
  const pool = deps.pool || getPool();
  const sessionId = randomUUID();
  const publicToken = token();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const wpJsonBase = normalizeWpJsonBase(brand.base_url || brand.default_wp_api_base || (brand.brand_domain ? `https://${brand.brand_domain}/wp-json` : ""));
  const apiBaseUrl = wpJsonBase.replace(/\/wp\/v2$/, "");
  const schema = { fields: [
    { name: "username", label: "WordPress Username", type: "text", target: "credentials", required: true, secret: false, autocomplete: "username" },
    { name: "application_password", label: "WordPress Application Password", type: "password", target: "credentials", required: true, secret: true, autocomplete: "new-password" },
    { name: "api_base_url", label: "WordPress REST API Base URL", type: "url", target: "connection", required: true, secret: false }
  ] };
  const metadata = {
    target_key: brand.target_key || plan.target_key || "",
    brand_name: brand.brand_name || plan.brand_key || "",
    provider_family: "wordpress",
    purpose: "resume governed blog publishing",
    original_plan_id: plan.plan_id || "",
    original_workflow_key: plan.workflow_key || WORKFLOW_KEY,
    reason: reason || "credential_missing",
  };
  await pool.query(
    `INSERT INTO credential_intake_sessions
       (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
        api_base_url, credential_schema_json, metadata_json, status, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
    [sessionId, sha256(publicToken), str(plan.user_id || plan.actor_user_id || "system"), str(plan.tenant_id || ""),
     "wordpress_rest", "basic_auth", `${brand.brand_name || brand.target_key || "WordPress"} - WordPress Application Password`,
     apiBaseUrl, JSON.stringify(schema), JSON.stringify(metadata), expiresAt, str(plan.user_id || "gpt-admin")]
  );
  return { session_id: sessionId, intake_url: `${intakePublicBaseUrl()}/credential-intake/${publicToken}`, expires_at: expiresAt, app_key: "wordpress_rest", auth_type: "basic_auth" };
}

async function resolveCmsSiteGrant({ plan, brand, requestedStatus }, deps = {}) {
  const pool = deps.pool || getPool();
  const input = extractInput(plan);
  const targetKey = str(brand.target_key || input.target_key || input.targetKey || plan.target_key);
  const domain = normalizeDomainFromUrl(brand.brand_domain || brand.base_url || brand.default_wp_api_base || targetKey);
  try {
    const [siteRows] = await pool.query(
      `SELECT site_id, normalized_domain, canonical_target_key
         FROM \`cms_sites\`
        WHERE app_key = 'wordpress_rest'
          AND (canonical_target_key = ? OR normalized_domain = ?)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [targetKey, domain]
    );
    const site = siteRows?.[0] || null;
    if (!site) return { ok: true, status: "legacy_site_not_registered", grant_required: false };

    const [grantRows] = await pool.query(
      `SELECT grant_id, site_id, scope, draft_allowed, publish_allowed, destructive_allowed, status
         FROM \`cms_site_access_grants\`
        WHERE site_id = ?
          AND tenant_id = ?
          AND status = 'active'
          AND (user_id IS NULL OR user_id = ?)
        ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, updated_at DESC
        LIMIT 1`,
      [site.site_id, plan.tenant_id, plan.user_id || "", plan.user_id || ""]
    );
    const grant = grantRows?.[0] || null;
    if (!grant) return { ok: false, status: "cms_site_access_grant_required", site_id: site.site_id, grant_required: true };
    const wantsPublish = str(requestedStatus).toLowerCase() === "publish";
    if (wantsPublish && !boolish(grant.publish_allowed)) return { ok: false, status: "cms_site_publish_not_allowed", site_id: site.site_id, grant_id: grant.grant_id, grant_required: true };
    if (!wantsPublish && !boolish(grant.draft_allowed)) return { ok: false, status: "cms_site_draft_not_allowed", site_id: site.site_id, grant_id: grant.grant_id, grant_required: true };
    return { ok: true, status: "cms_site_access_grant_resolved", site_id: site.site_id, grant_id: grant.grant_id, scope: grant.scope, grant_required: true };
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(err?.code)) return { ok: true, status: "cms_site_grants_unavailable_legacy_allowed", grant_required: false };
    throw err;
  }
}

async function resolveWpCredential({ plan, brand }, deps = {}) {
  const input = extractInput(plan);
  return resolveEffectiveCredential({
    tenantId: plan.tenant_id,
    userId: plan.user_id,
    connectionId: input.connection_id || input.connectionId || plan.connection_id,
    actionKey: "wordpress_create_post",
    targetKey: brand.target_key || input.target_key || input.targetKey || plan.target_key,
    credentialRole: input.credential_role || input.credentialRole || "wordpress_rest",
    includeSecret: true,
    allowPlatformFallback: true,
  }, { pool: deps.pool, decryptCredentials: deps.decryptCredentials, decryptToken: deps.decryptToken, env: deps.env });
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function createPost({ brand, credential, postType, payload }, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw Object.assign(new Error("fetch is not available for WordPress publishing."), { code: "fetch_not_available" });
  const wpBase = normalizeWpJsonBase(brand.base_url || brand.default_wp_api_base || (brand.brand_domain ? `https://${brand.brand_domain}/wp-json` : ""));
  if (!wpBase) throw Object.assign(new Error("WordPress API base URL is unresolved for target."), { code: "wordpress_base_url_unresolved" });
  const username = str(credential.username || brand.username || "gpt");
  const password = str(credential.secret);
  if (!password) throw Object.assign(new Error("WordPress credential secret is missing after resolution."), { code: "wordpress_secret_missing" });
  const response = await fetchImpl(`${wpBase}/${postType}`, {
    method: "POST",
    headers: { Authorization: basicAuth(username, password), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const upstreamCode = data?.code ? ` code=${String(data.code).slice(0, 120)}` : "";
    const upstreamMessage = data?.message ? ` message=${String(data.message).replace(/\s+/g, " ").slice(0, 240)}` : "";
    const err = new Error(`WordPress create post failed with HTTP ${response.status}.${upstreamCode}${upstreamMessage}`);
    err.code = "wordpress_create_post_failed";
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return { ok: true, upstream_status: response.status, post_id: data?.id || null, link: data?.link || data?.guid?.rendered || null, status: data?.status || payload.status, type: data?.type || postType, readback_status: data?.id ? "created_response_contains_id" : "created_response_missing_id" };
}

export async function dispatchWordpressBlogPublish(plan = {}, deps = {}) {
  const brand = deps.brand || await loadBrand(plan, deps);
  if (!brand) return { ok: false, status: "blocked", error: { code: "brand_target_not_resolved", message: "Could not resolve brand/target for WordPress blog publishing." } };
  if (!boolish(brand.write_allowed)) return { ok: false, status: "blocked", error: { code: "wordpress_write_not_allowed", message: `Target ${brand.target_key || brand.brand_name} is not write-enabled.` } };

  const credential = await resolveWpCredential({ plan, brand }, deps);
  if (credential.status !== "resolved" || !credential.secret_present || !credential.secret) {
    const intake = await createCredentialIntakeSession({ plan, brand, reason: credential.status || "credential_missing" }, deps);
    return { ok: true, status: "credential_intake_required", credential_status: credential.status || "missing", target_key: brand.target_key || plan.target_key || "", intake, resume: { workflow_key: WORKFLOW_KEY, plan_id: plan.plan_id || "", original_request_preserved: true }, output: { intake_url: intake.intake_url } };
  }

  const { postType, payload, requestedStatus } = buildPostPayload(plan, brand);
  const created = await createPost({ brand, credential, postType, payload }, deps);
  return { ok: true, status: "completed", credential_status: "resolved", target_key: brand.target_key || plan.target_key || "", post_status: requestedStatus, post_id: created.post_id, link: created.link, readback_status: created.readback_status, result: created, output: { post_id: created.post_id, link: created.link, status: created.status, readback_status: created.readback_status } };
}

export async function diagnoseWordpressAuthContext(plan = {}, deps = {}) {
  const brand = deps.brand || await loadBrand(plan, deps);
  if (!brand) return { ok: false, status: "blocked", error: { code: "brand_target_not_resolved" } };
  const credential = await resolveWpCredential({ plan, brand }, deps);
  if (credential.status !== "resolved" || !credential.secret_present || !credential.secret) {
    return { ok: false, status: "credential_unresolved", credential_status: credential.status || "missing" };
  }
  const fetchImpl = deps.fetch || globalThis.fetch;
  const wpBase = normalizeWpJsonBase(brand.base_url || brand.default_wp_api_base || (brand.brand_domain ? `https://${brand.brand_domain}/wp-json` : ""));
  const username = str(credential.username || brand.username || "gpt");
  const password = str(credential.secret);
  const response = await fetchImpl(`${wpBase}/users/me?context=edit`, {
    method: "GET",
    headers: { Authorization: basicAuth(username, password), Accept: "application/json" },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    return {
      ok: false,
      status: "wordpress_auth_context_failed",
      upstream_status: response.status,
      upstream_code: data?.code || "",
      upstream_message: data?.message || "",
      wp_base: wpBase,
      username_present: Boolean(username),
    };
  }
  const caps = data?.capabilities && typeof data.capabilities === "object" ? data.capabilities : {};
  return {
    ok: true,
    status: "wordpress_auth_context_resolved",
    wp_base: wpBase,
    user_id: data?.id || null,
    slug: data?.slug || "",
    name: data?.name || "",
    roles: Array.isArray(data?.roles) ? data.roles : [],
    can_edit_posts: Boolean(caps.edit_posts),
    can_publish_posts: Boolean(caps.publish_posts),
    can_create_posts: Boolean(caps.create_posts || caps.edit_posts),
  };
}

export const __test__ = { normalizeWpJsonBase, buildPostPayload };
