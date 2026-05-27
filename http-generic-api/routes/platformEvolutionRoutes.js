import { Router } from "express";
import { randomUUID } from "node:crypto";
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
