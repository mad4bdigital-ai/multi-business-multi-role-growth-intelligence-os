import { Router } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

function boundedInt(value, fallback, min = 1, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function nonEmptyString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function resolveEvolutionScope(input = {}) {
  const scopeKey = nonEmptyString(input.scope_key || input.scopeKey);
  if (scopeKey) return scopeKey;
  const brandKey = nonEmptyString(input.brand_key || input.brandKey);
  const tenantId = nonEmptyString(input.tenant_id || input.tenantId);
  if (brandKey && tenantId) return `brand:${brandKey}|tenant:${tenantId}`;
  const err = new Error("scope_key or brand_key+tenant_id is required.");
  err.status = 400;
  err.code = "platform_evolution_scope_required";
  throw err;
}

function safeJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Platform evolution request failed.").slice(0, 300),
    },
    secrets_included: false,
  });
}

function runtimeBaseUrl() {
  return String(
    process.env.INTERNAL_RUNTIME_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.PLATFORM_JWT_ISSUER ||
    "https://auth.mad4b.com"
  ).replace(/\/$/, "");
}

function scopeKeyComparisonSql(columnName = "scope_key") {
  return `${columnName} = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin`;
}

function issueInternalTenantSmokeJwt({ user_id, email, tenant_id }) {
  const secret = process.env.JWT_SECRET || "development_fallback_secret_only";
  return jwt.sign(
    {
      user_id,
      email,
      tenant_id,
      purpose: "tenant_evolution_smoke",
      client: "platform_evolution_tenant_smoke",
    },
    secret,
    { expiresIn: "5m", jwtid: randomUUID() }
  );
}

async function smokeGet(path, token) {
  const base = runtimeBaseUrl();
  try {
    const response = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 500) }; }
    return { status: response.status, ok: response.ok, body };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      body: {
        ok: false,
        error: { code: "tenant_smoke_self_call_failed", message: err?.message || String(err) },
        secrets_included: false,
      },
    };
  }
}

function smokeSummary(result) {
  return {
    status: result.status,
    ok: result.ok,
    response_ok: result.body?.ok === true,
    count: result.body?.count ?? null,
    scope_key: result.body?.scope_key ?? null,
    secrets_included: result.body?.secrets_included ?? null,
    error_code: result.body?.error?.code || null,
  };
}

export function buildPlatformEvolutionRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.get("/platform/evolution/activation-card", async (req, res) => {
    try {
      const scopeKey = resolveEvolutionScope(req.query || {});
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_activation_card WHERE scope_key = ? LIMIT 1`,
        [scopeKey]
      );
      return res.json({ ok: true, scope_key: scopeKey, card: rows[0] || null, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "platform_evolution_activation_card_failed");
    }
  });

  router.get("/platform/evolution/thread-map", async (req, res) => {
    try {
      const scopeKey = resolveEvolutionScope(req.query || {});
      const status = nonEmptyString(req.query.status);
      const priority = nonEmptyString(req.query.priority);
      const limit = boundedInt(req.query.limit, 50, 1, 250);
      const where = ["scope_key = ?"];
      const params = [scopeKey];
      if (status) { where.push("status = ?"); params.push(status); }
      if (priority) { where.push("priority = ?"); params.push(priority); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_thread_map WHERE ${where.join(" AND ")} ORDER BY FIELD(priority,'critical','high','medium','low'), thread_key LIMIT ?`,
        params
      );
      return res.json({ ok: true, scope_key: scopeKey, count: rows.length, threads: rows, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "platform_evolution_thread_map_failed");
    }
  });

  router.get("/platform/evolution/switch-options", async (req, res) => {
    try {
      const userId = nonEmptyString(req.query.user_id || req.query.userId);
      const email = nonEmptyString(req.query.email);
      const tenantId = nonEmptyString(req.query.tenant_id || req.query.tenantId);
      const brandKey = nonEmptyString(req.query.brand_key || req.query.brandKey);
      const limit = boundedInt(req.query.limit, 50, 1, 250);
      const where = ["access_state = 'allowed'"];
      const params = [];
      if (userId) { where.push("user_id = ?"); params.push(userId); }
      if (email) { where.push("email = ?"); params.push(email); }
      if (tenantId) { where.push("tenant_id = ?"); params.push(tenantId); }
      if (brandKey) { where.push("brand_key = ?"); params.push(brandKey); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT scope_key, tenant_id, brand_key, user_id, email, user_display_name, membership_role, assigned_role, tenant_type, tenant_display_name, business_type_key, knowledge_profile_key, brand_path_status, access_state
           FROM v_platform_evolution_scope_access
          WHERE ${where.join(" AND ")}
          ORDER BY tenant_display_name ASC, brand_key ASC, email ASC
          LIMIT ?`,
        params
      );
      return res.json({
        ok: true,
        count: rows.length,
        switch_options: rows,
        switch_policy: {
          mode: "admin_scope_selection",
          selected_scope_parameter: "scope_key",
          requires_allowed_scope: true,
          tenant_checkpoint_write_enabled: false,
        },
        secrets_included: false,
      });
    } catch (err) {
      return errorResponse(res, err, "platform_evolution_switch_options_failed");
    }
  });

  router.post("/platform/evolution/tenant-smoke", async (req, res) => {
    try {
      const body = req.body || {};
      const userId = nonEmptyString(body.user_id || body.userId);
      const email = nonEmptyString(body.email);
      const tenantId = nonEmptyString(body.tenant_id || body.tenantId);
      const brandKey = nonEmptyString(body.brand_key || body.brandKey);
      const scopeKey = nonEmptyString(body.scope_key || body.scopeKey);
      if (!userId && !email) {
        const err = new Error("user_id or email is required for tenant evolution smoke.");
        err.status = 400;
        err.code = "tenant_evolution_smoke_user_required";
        throw err;
      }
      const where = ["access_state = 'allowed'"];
      const params = [];
      if (userId) { where.push("user_id = ?"); params.push(userId); }
      if (email) { where.push("email = ?"); params.push(email); }
      if (tenantId) { where.push("tenant_id = ?"); params.push(tenantId); }
      if (brandKey) { where.push("brand_key = ?"); params.push(brandKey); }
      if (scopeKey) { where.push("scope_key = ?"); params.push(scopeKey); }
      const [scopes] = await getPool().query(
        `SELECT scope_key, tenant_id, brand_key, user_id, email, membership_role, assigned_role, access_state
           FROM v_platform_evolution_scope_access
          WHERE ${where.join(" AND ")}
          ORDER BY tenant_id ASC, brand_key ASC
          LIMIT 1`,
        params
      );
      const scope = scopes[0] || null;
      if (!scope) {
        const err = new Error("No allowed tenant evolution scope found for smoke.");
        err.status = 403;
        err.code = "tenant_evolution_smoke_scope_not_allowed";
        throw err;
      }

      const token = issueInternalTenantSmokeJwt({
        user_id: scope.user_id,
        email: scope.email,
        tenant_id: scope.tenant_id,
      });
      const encodedScope = encodeURIComponent(scope.scope_key);
      const encodedBrand = encodeURIComponent(scope.brand_key || "");
      const switchResult = await smokeGet(`/tenant/evolution/switch-options?brand_key=${encodedBrand}&limit=5`, token);
      const cardResult = await smokeGet(`/tenant/evolution/activation-card?scope_key=${encodedScope}`, token);
      const threadResult = await smokeGet(`/tenant/evolution/thread-map?scope_key=${encodedScope}&limit=3`, token);
      const checks = {
        switch_options: smokeSummary(switchResult),
        activation_card: smokeSummary(cardResult),
        thread_map: smokeSummary(threadResult),
      };
      const passed =
        checks.switch_options.status === 200 && checks.switch_options.response_ok === true && checks.switch_options.secrets_included === false &&
        checks.activation_card.status === 200 && checks.activation_card.response_ok === true && checks.activation_card.secrets_included === false &&
        checks.thread_map.status === 200 && checks.thread_map.response_ok === true && checks.thread_map.secrets_included === false;

      return res.status(passed ? 200 : 502).json({
        ok: passed,
        scope_key: scope.scope_key,
        tenant_id: scope.tenant_id,
        brand_key: scope.brand_key,
        user_id: scope.user_id,
        checks,
        smoke_policy: {
          token_returned: false,
          jwt_ttl_seconds: 300,
          tenant_checkpoint_write_enabled: false,
          runtime_base_url: runtimeBaseUrl(),
        },
        secrets_included: false,
      });
    } catch (err) {
      return errorResponse(res, err, "platform_evolution_tenant_smoke_failed");
    }
  });

  router.get("/platform/evolution/open-evidence", async (req, res) => {
    try {
      const scopeKey = resolveEvolutionScope(req.query || {});
      const threadKey = nonEmptyString(req.query.thread_key || req.query.threadKey);
      const linkedSurface = nonEmptyString(req.query.linked_surface || req.query.linkedSurface);
      const limit = boundedInt(req.query.limit, 50, 1, 250);
      const where = ["scope_key = ?"];
      const params = [scopeKey];
      if (threadKey) { where.push("thread_key = ?"); params.push(threadKey); }
      if (linkedSurface) { where.push("linked_surface = ?"); params.push(linkedSurface); }
      params.push(limit);
      const [rows] = await getPool().query(
        `SELECT * FROM v_platform_evolution_open_evidence WHERE ${where.join(" AND ")} ORDER BY FIELD(linked_priority,'critical','high','medium','low'), linked_updated_at DESC LIMIT ?`,
        params
      );
      return res.json({ ok: true, scope_key: scopeKey, count: rows.length, evidence: rows, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "platform_evolution_open_evidence_failed");
    }
  });

  router.post("/platform/evolution/checkpoints", async (req, res) => {
    try {
      const body = req.body || {};
      const scopeKey = resolveEvolutionScope(body);
      const summaryText = nonEmptyString(body.summary_text || body.summaryText);
      if (!summaryText) {
        const err = new Error("summary_text is required.");
        err.status = 400;
        err.code = "platform_evolution_summary_required";
        throw err;
      }
      const checkpointId = body.checkpoint_id || randomUUID();
      const tenantId = body.tenant_id || body.tenantId || null;
      const userId = body.user_id || body.userId || null;
      const brandKey = body.brand_key || body.brandKey || null;
      const checkpointType = body.checkpoint_type || body.checkpointType || "operation";
      const mainCommitSha = body.main_commit_sha || body.mainCommitSha || null;
      const deployedCommitSha = body.deployed_commit_sha || body.deployedCommitSha || null;
      const activationStatus = body.activation_status || body.activationStatus || null;
      const releaseReadinessStatus = body.release_readiness_status || body.releaseReadinessStatus || null;
      const activationSessionId = body.activation_session_id || body.activationSessionId || null;
      const createdBy = body.created_by || body.createdBy || "platform_evolution_tool";
      const threadSnapshotJson = JSON.stringify(safeJson(body.thread_snapshot_json || body.threadSnapshotJson, body.thread_snapshot || body.threadSnapshot || null));
      const deltaJson = JSON.stringify(safeJson(body.delta_json || body.deltaJson, body.delta || null));
      const evidenceJson = JSON.stringify(safeJson(body.evidence_json || body.evidenceJson, body.evidence || null));
      const nextActionsJson = JSON.stringify(safeJson(body.next_actions_json || body.nextActionsJson, body.next_actions || body.nextActions || []));

      await getPool().query(
        `INSERT INTO platform_evolution_checkpoints (
          checkpoint_id, scope_key, tenant_id, user_id, brand_key, checkpoint_type,
          activation_session_id, main_commit_sha, deployed_commit_sha, activation_status, release_readiness_status,
          summary_text, thread_snapshot_json, delta_json, evidence_json, next_actions_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [checkpointId, scopeKey, tenantId, userId, brandKey, checkpointType, activationSessionId, mainCommitSha, deployedCommitSha, activationStatus, releaseReadinessStatus, summaryText, threadSnapshotJson, deltaJson, evidenceJson, nextActionsJson, createdBy]
      );
      await getPool().query(
        `UPDATE platform_evolution_threads SET last_checkpoint_id = ?, updated_by = ? WHERE scope_key = ?`,
        [checkpointId, createdBy, scopeKey]
      );
      return res.status(201).json({ ok: true, checkpoint_id: checkpointId, scope_key: scopeKey, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "platform_evolution_checkpoint_create_failed");
    }
  });

  return router;
}
