import { getPool } from "./db.js";
import {
  buildActivationHardRunSummary,
  getRuntimeParity,
  getRuntimeVerificationRun,
  listRuntimeVerificationEvidence,
} from "./runtimeVerificationService.js";

const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie)/i;
const DEFAULT_TILE_LIMIT = 25;
const DEFAULT_EVIDENCE_LIMIT = 10;

function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, item]) => [key, stripSensitive(item)])
  );
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function clampLimit(value, fallback = DEFAULT_TILE_LIMIT, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function tableExists(tableName) {
  const rows = await query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function readOperationalTiles(limit = DEFAULT_TILE_LIMIT) {
  if (!(await tableExists("activation_operational_tile_registry"))) return [];
  const rows = await query(
    `SELECT tile_key, provider_family, connector_family, scope_class, display_name, description,
            category, default_visibility, source_mode, status_callback_key, freshness_sla_seconds,
            priority_order, risk_level, status
       FROM activation_operational_tile_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, tile_key ASC
      LIMIT ?`,
    [limit]
  );
  return rows;
}

async function readOperationalCallbacks(limit = DEFAULT_TILE_LIMIT) {
  if (!(await tableExists("activation_callback_registry"))) return [];
  const rows = await query(
    `SELECT callback_key, tile_key, provider_family, connector_family, intent_key,
            runtime_action_key, endpoint_selector, safe_mode, allowed_sources_json,
            output_contract_json, freshness_sla_seconds, priority_order, status
       FROM activation_callback_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, callback_key ASC
      LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    ...row,
    allowed_sources: parseJson(row.allowed_sources_json, []),
    output_contract: parseJson(row.output_contract_json, {}),
    allowed_sources_json: undefined,
    output_contract_json: undefined,
  }));
}

async function readAttentionRules(limit = DEFAULT_TILE_LIMIT) {
  if (!(await tableExists("activation_attention_rule_registry"))) return [];
  return query(
    `SELECT rule_key,
            display_name,
            NULL AS description,
            source_table_like AS source_table,
            severity,
            status AS rule_status,
            priority_order,
            status
       FROM activation_attention_rule_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, rule_key ASC
      LIMIT ?`,
    [limit]
  );
}

async function readRemediationRunbooks(limit = DEFAULT_TILE_LIMIT) {
  if (!(await tableExists("runtime_gap_remediation_registry"))) return [];
  const rows = await query(
    `SELECT gap_key, classification, owner_key, severity, remediation_type, auto_fix_allowed,
            approval_required, recommended_action, runbook_json, status
       FROM runtime_gap_remediation_registry
      WHERE status = 'active'
      ORDER BY FIELD(severity,'critical','high','medium','low','info'), gap_key ASC
      LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({ ...row, runbook: parseJson(row.runbook_json, {}), runbook_json: undefined }));
}

async function readFreshnessPolicies(limit = DEFAULT_TILE_LIMIT) {
  if (!(await tableExists("activation_freshness_policy_registry"))) return [];
  return query(
    `SELECT policy_key,
            provider_family,
            connector_family,
            surface_key_like AS source_surface_key,
            freshness_sla_seconds,
            NULL AS stale_after_seconds,
            NULL AS critical_after_seconds,
            status
       FROM activation_freshness_policy_registry
      WHERE status = 'active'
      ORDER BY freshness_sla_seconds ASC, policy_key ASC
      LIMIT ?`,
    [limit]
  );
}

function summarizeConsole({ parity, activationSummary, tiles, callbacks, attentionRules, runbooks, freshnessPolicies, latestRun }) {
  const blockingGaps = Array.isArray(latestRun?.gaps)
    ? latestRun.gaps.filter((gap) => Number(gap.blocks_production_parity || 0) === 1)
    : [];
  return {
    production_parity: parity.production_parity || "unknown",
    readiness_classification: parity.readiness_classification || "unknown",
    activation_status: activationSummary.status || "unknown",
    latest_run_id: parity.latest_run_id || null,
    blocking_gap_count: Number(parity.blocking_gap_count || blockingGaps.length || 0),
    ci_gate_status: parity.ci_gate_status || "unknown",
    release_readiness_status: parity.release_readiness_status || "unknown",
    runtime_health_status: parity.runtime_health_status || "unknown",
    migration_status: parity.migration_status || "unknown",
    operational_tile_count: tiles.length,
    callback_count: callbacks.length,
    attention_rule_count: attentionRules.length,
    remediation_runbook_count: runbooks.length,
    freshness_policy_count: freshnessPolicies.length,
    secrets_included: false,
  };
}

export async function buildOperationalConsole(input = {}) {
  const environmentKey = input.environment_key || input.environmentKey || "production";
  const tileLimit = clampLimit(input.tile_limit || input.limit, DEFAULT_TILE_LIMIT, 100);
  const evidenceLimit = clampLimit(input.evidence_limit, DEFAULT_EVIDENCE_LIMIT, 50);

  const parity = await getRuntimeParity(environmentKey);
  const activationSummary = await buildActivationHardRunSummary();
  const latestRun = parity.latest_run_id ? await getRuntimeVerificationRun(parity.latest_run_id) : null;
  const evidence = parity.latest_run_id
    ? await listRuntimeVerificationEvidence(parity.latest_run_id, { limit: evidenceLimit, surface: input.surface })
    : { items: [], page: { hasMore: false, nextCursor: null }, secrets_included: false };

  const [tiles, callbacks, attentionRules, runbooks, freshnessPolicies] = await Promise.all([
    readOperationalTiles(tileLimit),
    readOperationalCallbacks(tileLimit),
    readAttentionRules(tileLimit),
    readRemediationRunbooks(tileLimit),
    readFreshnessPolicies(tileLimit),
  ]);

  const consolePayload = {
    ok: parity.production_parity === "verified" && Number(parity.blocking_gap_count || 0) === 0,
    activation_layer: "operational_console",
    environment_key: environmentKey,
    summary: summarizeConsole({ parity, activationSummary, tiles, callbacks, attentionRules, runbooks, freshnessPolicies, latestRun }),
    runtime_parity: parity,
    activation_summary: activationSummary,
    latest_verification_run: latestRun
      ? {
          run_id: latestRun.run_id,
          run_status: latestRun.run_status,
          production_parity: latestRun.production_parity,
          expected_commit_sha: latestRun.expected_commit_sha,
          deployed_commit_sha: latestRun.deployed_commit_sha,
          summary: latestRun.summary,
          steps: latestRun.steps,
          gaps: latestRun.gaps,
        }
      : null,
    operational_tiles: tiles,
    callbacks,
    attention_rules: attentionRules,
    remediation_runbooks: runbooks,
    freshness_policies: freshnessPolicies,
    evidence_manifest: evidence,
    generated_at: new Date().toISOString(),
    secrets_included: false,
  };

  return stripSensitive(consolePayload);
}

export async function readOperationalConsoleEvidence(input = {}) {
  const environmentKey = input.environment_key || input.environmentKey || "production";
  const parity = await getRuntimeParity(environmentKey);
  if (!parity.latest_run_id) {
    return { ok: true, environment_key: environmentKey, items: [], page: { hasMore: false, nextCursor: null }, secrets_included: false };
  }
  const evidence = await listRuntimeVerificationEvidence(parity.latest_run_id, {
    surface: input.surface,
    limit: clampLimit(input.limit, DEFAULT_EVIDENCE_LIMIT, 100),
    cursor: input.cursor || 0,
  });
  return stripSensitive({ ok: true, environment_key: environmentKey, run_id: parity.latest_run_id, ...evidence, secrets_included: false });
}
