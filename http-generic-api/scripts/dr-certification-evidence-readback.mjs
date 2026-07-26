#!/usr/bin/env node
import { getPool } from "../db.js";

const REQUIRED = [
  { key: "dr_certification.db_isolated_restore.latest", label: "db_isolated_restore", requiredMode: "isolated_db_restore_mariadb" },
  { key: "dr_certification.n8n_isolated_restore_boot.latest", label: "n8n_isolated_restore_boot", requiredMode: "isolated_n8n_restore_boot" },
];

function safeJson(value) {
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
}

function checkEvidence(label, row, requiredMode) {
  const config = safeJson(row?.config_json);
  const checks = [
    { key: "row_present", ok: Boolean(row) },
    { key: "status_active", ok: row?.status === "active" },
    { key: "config_json_valid", ok: Boolean(config) },
    { key: "ok_true", ok: config?.ok === true },
    { key: "mode_matches", ok: config?.mode === requiredMode },
    { key: "production_untouched", ok: config?.production_touched === false },
    { key: "secrets_not_included", ok: config?.secrets_included === false },
  ];
  if (label === "db_isolated_restore") {
    checks.push(
      { key: "full_import_attempted", ok: config?.full_import_attempted === true },
      { key: "table_count_matches", ok: Number(config?.readback?.table_count || 0) >= Number(config?.readback?.expected_table_count || 1) },
      { key: "container_removed", ok: config?.cleanup?.container_removed === true },
      { key: "plaintext_sql_removed", ok: config?.cleanup?.plaintext_sql_removed === true },
    );
  }
  if (label === "n8n_isolated_restore_boot") {
    checks.push(
      { key: "isolated_boot_attempted", ok: config?.isolated_boot_attempted === true },
      { key: "health_ok", ok: config?.health?.ok === true && Number(config?.health?.status || 0) === 200 },
      { key: "structural_markers_present", ok: config?.structural_restore?.markers?.has_database_sqlite === true && config?.structural_restore?.markers?.has_config === true && config?.structural_restore?.markers?.has_nodes_dir === true },
      { key: "isolated_process_stopped", ok: config?.cleanup?.isolated_process_stopped === true },
      { key: "extracted_restore_removed", ok: config?.cleanup?.extracted_restore_removed === true },
      { key: "plaintext_zip_removed", ok: config?.cleanup?.plaintext_zip_removed === true },
    );
  }
  return { label, status: checks.every((check) => check.ok) ? "pass" : "fail", checks, evidence_summary: config ? { mode: config.mode, completed_at: config.completed_at, evidence_path: config.evidence_path || null, secrets_included: config.secrets_included, production_touched: config.production_touched } : null };
}

async function main() {
  const pool = getPool();
  try {
    const [rows] = await pool.query(`SELECT config_key, config_json, status, updated_at FROM platform_runtime_config WHERE config_key IN (?)`, [REQUIRED.map((item) => item.key)]);
    const byKey = new Map((rows || []).map((row) => [row.config_key, row]));
    const reports = REQUIRED.map((item) => checkEvidence(item.label, byKey.get(item.key), item.requiredMode));
    const ok = reports.every((report) => report.status === "pass");
    console.log(JSON.stringify({ ok, status: ok ? "pass" : "fail", reports, external_write_performed: false, credential_payload_read: false, secrets_included: false }, null, 2));
    await pool.end().catch(() => {});
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: "fail", error: { code: error.code || "dr_certification_evidence_readback_failed", message: error.message }, secrets_included: false }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
