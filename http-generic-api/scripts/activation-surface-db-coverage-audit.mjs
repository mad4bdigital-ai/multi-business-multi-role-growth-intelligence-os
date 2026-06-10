#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const SURFACE_DIR = path.join(API_DIR, "activation-surfaces");
const EXCLUSION_DIR = path.join(SURFACE_DIR, "exclusions");
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SENSITIVE_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json)/i;
const TABLE_PATTERN = /^(tenants|memberships|role_assignments|actions|admin_platform_endpoint_tools|tenant_platform_endpoint_tools|workspace_registry|connected_systems|installations|permission_grants|agents|agent_|workflows|workflow_|task_routes|platform_pending_tasks|app_|user_app_connections|tenant_integration_policies|platform_.*plugin|skill_|logic_packs|local_gateway_tools)$/i;
const CORE_LOADER = new Set(["memberships", "role_assignments", "actions", "admin_platform_endpoint_tools"]);

function jsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".json")).sort().map((file) => path.join(dir, file));
}
function readJson(filePath) { return JSON.parse(readFileSync(filePath, "utf8")); }
function assertIdent(value, label) {
  if (!SAFE_IDENTIFIER.test(String(value || ""))) throw new Error(`Unsafe ${label}: ${value}`);
  return String(value);
}
function add(map, table, item) {
  if (!table) return;
  const key = assertIdent(table, "coverage table");
  const rows = map.get(key) || [];
  rows.push(item);
  map.set(key, rows);
}
function loadCoverage() {
  const map = new Map();
  let manifestCount = 0;
  for (const filePath of jsonFiles(SURFACE_DIR)) {
    const manifest = readJson(filePath);
    const surfaceKey = assertIdent(manifest.surface_key, "surface_key");
    const sourceTable = assertIdent(manifest.source_table, "source_table");
    for (const column of manifest.result_columns || []) {
      const safeColumn = assertIdent(column, "result column");
      if (SENSITIVE_PATTERN.test(safeColumn)) throw new Error(`Sensitive result column ${safeColumn} in ${filePath}`);
    }
    const covered = Array.isArray(manifest.covered_source_tables) ? manifest.covered_source_tables : [];
    if (sourceTable.startsWith("v_activation_") && covered.length === 0) throw new Error(`View surface ${surfaceKey} requires covered_source_tables.`);
    add(map, sourceTable, { type: "source_table", surface_key: surfaceKey });
    for (const table of covered) add(map, table, { type: "covered_source_table", surface_key: surfaceKey, activation_view: sourceTable });
    manifestCount += 1;
  }
  return { map, manifestCount };
}
function loadExclusions() {
  const map = new Map();
  for (const filePath of jsonFiles(EXCLUSION_DIR)) {
    const exclusion = readJson(filePath);
    if (!exclusion.reason || String(exclusion.reason).trim().length < 20) throw new Error(`Bad exclusion reason in ${filePath}`);
    if (!exclusion.owner) throw new Error(`Missing exclusion owner in ${filePath}`);
    if (SENSITIVE_PATTERN.test(JSON.stringify(exclusion))) throw new Error(`Sensitive-looking text in ${filePath}`);
    for (const table of [exclusion.source_table, ...(Array.isArray(exclusion.source_tables) ? exclusion.source_tables : [])].filter(Boolean)) map.set(assertIdent(table, "excluded table"), exclusion.reason);
  }
  return map;
}
async function candidates() {
  const [rows] = await getPool().query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  return rows.map((row) => row.TABLE_NAME).filter((table) => TABLE_PATTERN.test(table));
}
async function closePool() { try { await getPool().end(); } catch {} }
async function main() {
  const { map, manifestCount } = loadCoverage();
  const exclusions = loadExclusions();
  const tables = await candidates();
  const missing = [];
  const covered = [];
  const excluded = [];
  for (const table of tables) {
    const evidence = [...(map.get(table) || []), ...(CORE_LOADER.has(table) ? [{ type: "activation_core_loader" }] : [])];
    if (evidence.length) covered.push({ table, coverage: evidence.map((item) => item.surface_key || item.type) });
    else if (exclusions.has(table)) excluded.push({ table, reason: exclusions.get(table) });
    else missing.push(table);
  }
  const out = { ok: missing.length === 0, readiness_key: "activation_source_table_coverage", readiness_status: missing.length ? "fail" : "pass", candidate_table_count: tables.length, covered_count: covered.length, excluded_count: excluded.length, missing_count: missing.length, manifest_count: manifestCount, missing_tables: missing, covered_tables: covered, external_provider_called: false, secrets_included: false };
  console.log(JSON.stringify(out, null, 2));
  await closePool();
  process.exit(out.ok ? 0 : 2);
}
main().catch(async (error) => { await closePool(); console.error(JSON.stringify({ ok: false, error: { code: error.code || "activation_source_table_coverage_audit_failed", message: error.message }, secrets_included: false }, null, 2)); process.exit(1); });
