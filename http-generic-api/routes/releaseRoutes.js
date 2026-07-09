import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import { runReleaseReadiness } from "../releaseReadiness.js";
import { runSessionArchiveSmoke } from "../sessionArchiveSmoke.js";
import { backfillGptSessionArchiveFromJsonl } from "../sessionArchiveService.js";
import { markCapabilityEnvelopeReferenced } from "../capabilityResolutionEnvelopeGuard.js";
import { getRuntimeParity } from "../runtimeVerificationService.js";
import {
  capabilityFamilyAuthorizationError,
  resolveToolCapabilityFamilyAuthorization,
} from "../toolCapabilityFamilyAuthorization.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_ADMIN_USER = "platform_admin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENT_MANIFEST_PATH = path.resolve(__dirname, "..", "deployment-manifest.json");

export function buildReleaseRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  const sessionArchiveSmokeRunner = deps.runSessionArchiveSmoke || runSessionArchiveSmoke;
  const getPoolFn = deps.getPool || getPool;
  const resolveCapabilityFamilyAuthorizationFn = deps.resolveToolCapabilityFamilyAuthorization || resolveToolCapabilityFamilyAuthorization;
  const markCapabilityEnvelopeReferencedFn = deps.markCapabilityEnvelopeReferenced || markCapabilityEnvelopeReferenced;

  async function countRowsIfAvailable(pool, tableName) {
    try {
      const [[existsRow]] = await pool.query(
        "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
        [tableName]
      );
      if (Number(existsRow?.count || 0) === 0) return { exists: false, count: 0 };
      const [[countRow]] = await pool.query(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
      return { exists: true, count: Number(countRow?.count || 0) };
    } catch (err) {
      return { exists: false, count: 0, error: err.message };
    }
  }

  async function readDeploymentManifest() {
    try {
      const raw = await fs.readFile(DEPLOYMENT_MANIFEST_PATH, "utf8");
      const parsed = JSON.parse(raw);
      return {
        present: true,
        repository: parsed.repository || null,
        branch: parsed.branch || null,
        commit_sha: parsed.commit_sha || null,
        commit_source: parsed.commit_source || null,
        deployed_at: parsed.deployed_at || null,
        service_version: parsed.service_version || null,
        build_source: parsed.build_source || null,
      };
    } catch (err) {
      return { present: false, error: err.message };
    }
  }

  async function readLatestFullReadinessRun(pool) {
    try {
      const [rows] = await pool.query(
        `SELECT run_id, MIN(checked_at) AS checked_at,
                SUM(status = 'pass') AS pass_count,
                SUM(status = 'fail') AS fail_count,
                SUM(status = 'warn') AS warn_count,
                COUNT(*) AS check_count
           FROM release_readiness_log
          GROUP BY run_id
          ORDER BY checked_at DESC
          LIMIT 1`
      );
      const row = rows?.[0];
      if (!row) return null;
      return {
        run_id: row.run_id,
        checked_at: row.checked_at,
        pass_count: Number(row.pass_count || 0),
        warn_count: Number(row.warn_count || 0),
        fail_count: Number(row.fail_count || 0),
        check_count: Number(row.check_count || 0),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  async function buildFastReadinessProjection() {
    const pool = getPoolFn();
    const checkedAt = new Date().toISOString();
    let dbConnectivity = { status: "pass", detail: "Database reachable." };
    try {
      await pool.query("SELECT 1 AS ok");
    } catch (err) {
      dbConnectivity = { status: "fail", detail: err.message };
    }

    const [runtimeParity, deploymentManifest, latestFullReadinessRun, readinessLogCount, adminToolCount] = await Promise.all([
      getRuntimeParity("production").catch((err) => ({ production_parity: "unknown", error: err.message, secrets_included: false })),
      readDeploymentManifest(),
      dbConnectivity.status === "pass" ? readLatestFullReadinessRun(pool) : null,
      dbConnectivity.status === "pass" ? countRowsIfAvailable(pool, "release_readiness_log") : { exists: false, count: 0 },
      dbConnectivity.status === "pass" ? countRowsIfAvailable(pool, "admin_platform_endpoint_tools") : { exists: false, count: 0 },
    ]);

    const degradedSurfaces = [];
    if (dbConnectivity.status !== "pass") degradedSurfaces.push({ key: "db_connectivity", ...dbConnectivity });
    if (runtimeParity?.production_parity && runtimeParity.production_parity !== "verified") {
      degradedSurfaces.push({
        key: "runtime_production_parity_gate",
        status: "warn",
        detail: runtimeParity.production_parity,
      });
    }
    if (!deploymentManifest.present) {
      degradedSurfaces.push({ key: "deployment_manifest", status: "warn", detail: deploymentManifest.error || "manifest missing" });
    }

    const overall = degradedSurfaces.some((surface) => surface.status === "fail")
      ? "fail"
      : degradedSurfaces.length ? "warn" : "pass";

    return {
      ok: overall !== "fail",
      overall,
      checked_at: checkedAt,
      response_mode: "fast_summary",
      full_response_available_with: "?full=true",
      bounded_projection: true,
      summary_source: "fast_release_readiness_projection",
      summary: {
        total: 4,
        pass: Math.max(0, 4 - degradedSurfaces.length),
        warn: degradedSurfaces.filter((surface) => surface.status === "warn").length,
        fail: degradedSurfaces.filter((surface) => surface.status === "fail").length,
      },
      key_statuses: {
        db_connectivity: dbConnectivity.status,
        release_readiness_log: readinessLogCount.exists ? "pass" : "warn",
        runtime_production_parity_gate: runtimeParity?.readiness_classification || runtimeParity?.production_parity || "unknown",
        deployment_manifest: deploymentManifest.present ? "pass" : "warn",
      },
      latest_full_readiness_run: latestFullReadinessRun?.error ? null : latestFullReadinessRun,
      runtime_parity: {
        environment_key: runtimeParity?.environment_key || "production",
        production_parity: runtimeParity?.production_parity || "unknown",
        readiness_classification: runtimeParity?.readiness_classification || "unknown",
        expected_commit_sha: runtimeParity?.expected_commit_sha || null,
        deployed_commit_sha: runtimeParity?.deployed_commit_sha || null,
        latest_run_id: runtimeParity?.latest_run_id || null,
        blocking_gap_count: Number(runtimeParity?.blocking_gap_count || 0),
        verified_at: runtimeParity?.verified_at || null,
      },
      deployment_manifest: deploymentManifest,
      registry_counts: { release_readiness_log: readinessLogCount, admin_platform_endpoint_tools: adminToolCount },
      degraded_surfaces: degradedSurfaces,
      secrets_included: false,
    };
  }

  function compactReadinessProjection(report, mode = "summary") {
    const checks = Object.entries(report || {})
      .filter(([, value]) => value && typeof value === "object" && typeof value.status === "string")
      .map(([key, value]) => ({
        key,
        status: value.status,
        detail: value.detail || null,
      }));
    return {
      ok: report.overall !== "fail",
      overall: report.overall,
      run_id: report.run_id,
      checked_at: report.checked_at,
      summary: report.summary,
      response_mode: mode,
      full_response_available_with: "?full=true",
      bounded_projection: true,
      check_count: checks.length,
      degraded_surfaces: checks.filter((check) => check.status !== "pass"),
      key_statuses: {
        db_connectivity: report.db_connectivity?.status || null,
        governed_migration_ledger: report.governed_migration_ledger?.status || null,
        migration_drift: report.migration_drift?.status || null,
        runtime_production_parity_gate: report.runtime_production_parity_gate?.status || null,
        platform_tool_dispatch_binding_integrity: report.platform_tool_dispatch_binding_integrity?.status || null,
      },
      secrets_included: false,
    };
  }

  async function handleReadiness(req, res) {
    try {
      const persist = req.query.persist === "true" || req.query.persist === "1";
      const explicitSummary = req.query.summary === "true" || req.query.summary === "1";
      const explicitFull = req.query.full === "true" || req.query.full === "1" || req.query.detail === "full";

      const report = await runReleaseReadiness({ persist });
      const httpStatus = 200;

      if (explicitFull && !explicitSummary) {
        return res.status(httpStatus).json({
          ok: report.overall !== "fail",
          ...report,
          response_mode: "full",
          secrets_included: false,
        });
      }

      return res.status(httpStatus).json(compactReadinessProjection(report));
    } catch (err) {
      return res.status(500).json({
        ok: false,
        status: "degraded_transport",
        response_mode: "summary_default",
        error: { code: "release_readiness_failed", message: err.message },
        secrets_included: false,
      });
    }
  }

  // ── GET /release/readiness ────────────────────────────────────────────────
  // Full platform health check: all tables, seed data, legacy connectivity.
  // ?persist=true writes results to release_readiness_log.
  // ?summary=true returns only the summary (faster for uptime probes).
  router.get("/release/readiness", requireBackendApiKey, handleReadiness);
  router.get("/admin/release/readiness", requireBackendApiKey, handleReadiness);

  async function handleReleaseDashboard(req, res) {
    try {
      const report = await runReleaseReadiness({ persist: false });
      const dashboard = {
        ok: report.overall !== "fail",
        overall: report.overall,
        run_id: report.run_id,
        checked_at: report.checked_at,
        release_status: report.summary,
        ledger: {
          status: report.governed_migration_ledger?.status || null,
          total_entries: report.governed_migration_ledger?.total_entries ?? null,
          apply_count: report.governed_migration_ledger?.mode_counts?.apply ?? 0,
          record_only_count: report.governed_migration_ledger?.mode_counts?.record_only ?? 0,
          expected_count: report.governed_migration_ledger?.expected_count ?? null,
          covered_count: report.governed_migration_ledger?.covered_count ?? null,
          missing_expected_count: report.governed_migration_ledger?.missing_expected_migrations?.length ?? null,
        },
        admin_tool_registry_smoke: {
          status: report.admin_tool_registry_smoke?.status || null,
          expected_count: report.admin_tool_registry_smoke?.expected_count ?? null,
          covered_count: report.admin_tool_registry_smoke?.covered_count ?? null,
          missing_count: report.admin_tool_registry_smoke?.missing_expected_tools?.length ?? null,
          disabled_count: report.admin_tool_registry_smoke?.disabled_expected_tools?.length ?? null,
          invalid_count: report.admin_tool_registry_smoke?.invalid_expected_tools?.length ?? null,
          executes_tools: Boolean(report.admin_tool_registry_smoke?.executes_tools),
        },
        migration_drift: {
          status: report.migration_drift?.status || null,
          raw_missing_total: report.migration_drift?.missing_total ?? null,
          actionable_missing_total: report.migration_drift?.actionable_missing_total ?? null,
          files_scanned: report.migration_drift?.files_scanned ?? null,
          candidate_files: report.migration_drift?.migration_apply_plan?.candidate_files || [],
        },
        graph_memory: {
          status: report.graph_memory_diagnostics?.status || null,
          resolved: Boolean(report.graph_memory_diagnostics?.resolved),
          asset_count: Number(report.graph_memory_diagnostics?.asset_count || 0),
        },
        degraded_surfaces: [
          report.db_connectivity,
          report.migration_inventory,
          report.governed_migration_ledger,
          report.admin_tool_registry_smoke,
          report.migration_drift,
          report.graph_memory_diagnostics,
        ].filter((check) => check && check.status !== "pass").map((check) => ({ status: check.status, detail: check.detail || null })),
        source_of_truth: "release_readiness",
        dashboard_role: "compact_read_only_projection",
        secrets_included: false,
      };
      return res.status(200).json(dashboard);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "release_dashboard_failed", message: err.message }, secrets_included: false });
    }
  }

  router.get("/release/dashboard", requireBackendApiKey, handleReleaseDashboard);
  router.get("/admin/release/dashboard", requireBackendApiKey, handleReleaseDashboard);

  async function handleSessionArchiveSmoke(req, res) {
    try {
      const pool = getPoolFn();
      const capabilityFamilyAuthorization = await resolveCapabilityFamilyAuthorizationFn({
        pool,
        callerType: "admin",
        principal: {
          tenant_id: PLATFORM_TENANT_ID,
          user_id: PLATFORM_ADMIN_USER,
        },
        toolKey: "release_session_archive_smoke",
        args: req.body || {},
        expectedFamily: "session_archive_write",
        requirePolicy: true,
      });
      if (!capabilityFamilyAuthorization.ok) {
        throw capabilityFamilyAuthorizationError(
          capabilityFamilyAuthorization,
          "Session archive smoke capability-family authorization denied this operation.",
        );
      }
      if (capabilityFamilyAuthorization.envelope_id) {
        await markCapabilityEnvelopeReferencedFn({
          pool,
          envelopeId: capabilityFamilyAuthorization.envelope_id,
          executionRef: "releaseRoutes:release_session_archive_smoke",
        });
      }

      const result = await sessionArchiveSmokeRunner({
        tenantId: req.body?.tenant_id,
        userId: req.body?.user_id,
        includeDriveReadback: req.body?.include_drive_readback !== false,
        cleanup: req.body?.cleanup !== false,
        smokeSubfolder: req.body?.smoke_subfolder,
        forceDocRollover: req.body?.force_doc_rollover === true,
        docRolloverChars: req.body?.doc_rollover_chars,
      });
      return res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        status: "fail",
        smoke_type: "session_archive_drive_writeback",
        error: { code: "session_archive_smoke_failed", message: err.message },
      });
    }
  }

  // Writes a tiny GPT action session and verifies Drive doc, JSONL, SQL pointers,
  // and activation readback. Intended for daily scheduler/monitor probes.
  router.post("/release/session-archive-smoke", requireBackendApiKey, handleSessionArchiveSmoke);
  router.post("/admin/release/session-archive-smoke", requireBackendApiKey, handleSessionArchiveSmoke);

  async function handleSessionArchiveBackfill(req, res) {
    try {
      const pool = getPool();
      const dryRun = req.body?.dry_run !== false;
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 5), 25));
      const requestedSessionIds = Array.isArray(req.body?.session_ids)
        ? req.body.session_ids.map((id) => String(id || "").trim()).filter(Boolean)
        : String(req.body?.session_id || "").trim()
          ? [String(req.body.session_id).trim()]
          : [];

      let candidates = [];
      if (requestedSessionIds.length) {
        const [rows] = await pool.query(
          `SELECT session_id, archive_status, started_at, turn_rows, user_turns, assistant_turns, tool_turns, drive_doc_id, drive_jsonl_id
             FROM \`v_gpt_session_archive_monitoring\`
            WHERE session_id IN (?)
            ORDER BY started_at ASC`,
          [requestedSessionIds]
        );
        candidates = rows;
      } else {
        const [rows] = await pool.query(
          `SELECT m.session_id, m.archive_status, m.started_at, m.turn_rows, m.user_turns, m.assistant_turns, m.tool_turns, m.drive_doc_id, m.drive_jsonl_id
             FROM \`v_gpt_session_archive_monitoring\` m
            WHERE m.tool_turns >= 10
              AND (m.user_turns = 0 OR m.assistant_turns = 0)
              AND COALESCE(m.drive_jsonl_id, '') <> ''
              AND NOT EXISTS (
                SELECT 1 FROM \`session_events\` e
                 WHERE e.session_id COLLATE utf8mb4_uca1400_ai_ci = m.session_id
                   AND e.action_key = 'gpt_session_archive_backfill'
              )
            ORDER BY m.tool_turns DESC
            LIMIT ${limit}`
        );
        candidates = rows;
      }

      if (dryRun) {
        return res.status(200).json({
          ok: true,
          dry_run: true,
          candidate_count: candidates.length,
          candidates,
          action_required: "rerun with dry_run=false to rebuild transcript docs from JSONL",
          secrets_included: false,
        });
      }

      const capabilityFamilyAuthorization = await resolveToolCapabilityFamilyAuthorization({
        pool,
        callerType: "admin",
        principal: {
          tenant_id: PLATFORM_TENANT_ID,
          user_id: PLATFORM_ADMIN_USER,
        },
        toolKey: "gpt_session_archive_backfill",
        args: req.body || {},
        expectedFamily: "session_archive_write",
        requirePolicy: true,
      });
      if (!capabilityFamilyAuthorization.ok) {
        throw capabilityFamilyAuthorizationError(
          capabilityFamilyAuthorization,
          "Session archive backfill capability-family authorization denied this operation.",
        );
      }
      if (capabilityFamilyAuthorization.envelope_id) {
        await markCapabilityEnvelopeReferenced({
          pool,
          envelopeId: capabilityFamilyAuthorization.envelope_id,
          executionRef: "releaseRoutes:gpt_session_archive_backfill",
        });
      }

      const results = [];
      for (const candidate of candidates.slice(0, limit)) {
        try {
          results.push(await backfillGptSessionArchiveFromJsonl({
            pool,
            sessionId: candidate.session_id,
            reason: req.body?.reason || "legacy_tool_only_backfill",
          }));
        } catch (err) {
          results.push({
            ok: false,
            session_id: candidate.session_id,
            error: { code: err.code || "gpt_session_archive_backfill_failed", message: err.message },
            secrets_included: false,
          });
        }
      }

      const failed = results.filter((row) => row.ok === false);
      return res.status(failed.length ? 207 : 200).json({
        ok: failed.length === 0,
        dry_run: false,
        candidate_count: candidates.length,
        processed_count: results.length,
        failed_count: failed.length,
        results,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "gpt_session_archive_backfill_route_failed",
          message: err.message,
          details: err.details || undefined,
        },
        secrets_included: false,
      });
    }
  }

  router.post("/release/session-archive-backfill", requireBackendApiKey, handleSessionArchiveBackfill);
  router.post("/admin/release/session-archive-backfill", requireBackendApiKey, handleSessionArchiveBackfill);

  // ── GET /release/readiness-history ────────────────────────────────────────
  // Returns the last N readiness runs from release_readiness_log.
  router.get("/release/readiness-history", requireBackendApiKey, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const [runs] = await getPool().query(
        `SELECT run_id, MIN(checked_at) AS checked_at,
                SUM(status = 'pass') AS pass_count,
                SUM(status = 'fail') AS fail_count,
                SUM(status = 'warn') AS warn_count
         FROM \`release_readiness_log\`
         GROUP BY run_id
         ORDER BY checked_at DESC
         LIMIT ${limit}`
      );
      return res.status(200).json({ ok: true, runs, count: runs.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "history_read_failed", message: err.message } });
    }
  });

  // ── GET /release/readiness-history/:run_id ────────────────────────────────
  router.get("/release/readiness-history/:run_id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT check_key, status, detail, checked_at FROM `release_readiness_log` WHERE run_id = ? ORDER BY id",
        [req.params.run_id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "run_not_found", message: "Run not found." } });
      const fail_count = rows.filter((r) => r.status === "fail").length;
      const warn_count = rows.filter((r) => r.status === "warn").length;
      return res.status(200).json({
        ok: true,
        run_id: req.params.run_id,
        overall: fail_count > 0 ? "fail" : warn_count > 0 ? "warn" : "pass",
        checks: rows,
        summary: { total: rows.length, pass: rows.length - fail_count - warn_count, warn: warn_count, fail: fail_count },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "run_read_failed", message: err.message } });
    }
  });

  // ── POST /release/entity-classification ──────────────────────────────────
  // Upserts entity classification entries (source of truth mapping per table).
  router.post("/release/entity-classification", requireBackendApiKey, async (req, res) => {
    try {
      const entries = Array.isArray(req.body) ? req.body : [req.body];
      if (!entries.length) return res.status(400).json({ ok: false, error: { code: "empty_body", message: "Provide an array of classification entries." } });

      let written = 0;
      for (const e of entries) {
        const { entity_class, table_name, authority_model = "canonical", read_priority = 1, write_strategy = "platform_primary", migration_status = "not_started", notes } = e;
        if (!entity_class || !table_name) continue;
        await getPool().query(
          `INSERT INTO \`data_migration_inventory\`
             (entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes, last_checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             authority_model = VALUES(authority_model), read_priority = VALUES(read_priority),
             write_strategy = VALUES(write_strategy), migration_status = VALUES(migration_status),
             notes = VALUES(notes), last_checked_at = NOW()`,
          [entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes || null]
        );
        written++;
      }

      return res.status(200).json({ ok: true, written, total: entries.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "classification_write_failed", message: err.message } });
    }
  });

  // ── GET /release/entity-classification ───────────────────────────────────
  router.get("/release/entity-classification", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, row_count, notes, last_checked_at FROM `data_migration_inventory` ORDER BY read_priority, entity_class"
      );
      return res.status(200).json({ ok: true, classifications: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "classification_read_failed", message: err.message } });
    }
  });

  return router;
}
