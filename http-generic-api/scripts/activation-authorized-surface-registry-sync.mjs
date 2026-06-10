#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const SURFACE_DIR = path.join(API_DIR, "activation-surfaces");
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const BLOCKED_COLUMN_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json)/i;
const REQUIRED_KEYS = ["surface_key", "display_name", "source_table", "result_columns", "include_for_admin", "include_for_tenant"];
const CONFIRMATION = "APPLY_ACTIVATION_AUTHORIZED_SURFACE_REGISTRY_SYNC";

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { apply: false, confirm: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--confirm") parsed.confirm = String(argv[++i] || "");
    else if (arg.startsWith("--confirm=")) parsed.confirm = arg.slice("--confirm=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return parsed;
}

function assertSafeIdentifier(value, field, surfaceKey) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value || "").trim();
  if (!SAFE_IDENTIFIER.test(text)) {
    throw new Error(`Unsafe identifier in ${surfaceKey || "manifest"}.${field}: ${text}`);
  }
  return text;
}

function assertSafeResultColumn(column, surfaceKey) {
  const text = assertSafeIdentifier(column, "result_columns", surfaceKey);
  if (BLOCKED_COLUMN_PATTERN.test(text)) {
    throw new Error(`Blocked activation result column in ${surfaceKey}: ${text}`);
  }
  return text;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true";
}

function normalizeManifest(raw, filename) {
  const surfaceKey = raw?.surface_key || filename.replace(/\.json$/i, "");
  for (const key of REQUIRED_KEYS) {
    if (!(key in raw)) throw new Error(`Missing required activation surface key ${key} in ${filename}`);
  }
  const includeForTenant = normalizeBoolean(raw.include_for_tenant);
  const resultColumns = Array.isArray(raw.result_columns) ? raw.result_columns : [];
  if (!resultColumns.length) throw new Error(`Activation surface ${surfaceKey} requires result_columns.`);

  const normalized = {
    surface_key: assertSafeIdentifier(surfaceKey, "surface_key", surfaceKey),
    display_name: String(raw.display_name || "").trim(),
    description: raw.description ? String(raw.description) : null,
    source_table: assertSafeIdentifier(raw.source_table, "source_table", surfaceKey),
    result_key_column: assertSafeIdentifier(raw.result_key_column, "result_key_column", surfaceKey),
    result_label_column: assertSafeIdentifier(raw.result_label_column, "result_label_column", surfaceKey),
    tenant_column: assertSafeIdentifier(raw.tenant_column, "tenant_column", surfaceKey),
    user_column: assertSafeIdentifier(raw.user_column, "user_column", surfaceKey),
    status_column: assertSafeIdentifier(raw.status_column, "status_column", surfaceKey),
    active_status_values: Array.isArray(raw.active_status_values) ? raw.active_status_values.map((item) => String(item)) : [],
    result_columns: resultColumns.map((column) => assertSafeResultColumn(column, surfaceKey)),
    include_for_admin: normalizeBoolean(raw.include_for_admin),
    include_for_tenant: includeForTenant,
    max_rows: Math.min(Math.max(Number(raw.max_rows || 25) || 25, 1), 100),
    sort_order: Math.min(Math.max(Number(raw.sort_order || 100) || 100, 0), 10000),
    status: ["active", "disabled", "archived"].includes(String(raw.status || "active")) ? String(raw.status || "active") : "active",
    notes: raw.notes ? String(raw.notes) : "Repo-managed activation surface.",
  };

  if (!normalized.display_name) throw new Error(`Activation surface ${surfaceKey} requires display_name.`);
  if (includeForTenant && !normalized.tenant_column && !normalized.user_column) {
    throw new Error(`Tenant-visible activation surface ${surfaceKey} requires tenant_column or user_column.`);
  }
  return normalized;
}

async function loadManifests() {
  const files = (await fs.readdir(SURFACE_DIR)).filter((file) => file.endsWith(".json")).sort();
  const manifests = [];
  for (const file of files) {
    const fullPath = path.join(SURFACE_DIR, file);
    const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
    manifests.push({ file, ...normalizeManifest(raw, file) });
  }
  const duplicates = manifests
    .map((item) => item.surface_key)
    .filter((key, index, list) => list.indexOf(key) !== index);
  if (duplicates.length) throw new Error(`Duplicate activation surface_key(s): ${[...new Set(duplicates)].join(", ")}`);
  return manifests;
}

async function applyManifest(surface) {
  await getPool().query(
    `INSERT INTO activation_authorized_surface_registry
      (surface_key, display_name, description, source_table, result_key_column, result_label_column,
       tenant_column, user_column, status_column, active_status_values_json, result_columns_json,
       include_for_admin, include_for_tenant, max_rows, sort_order, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       description = VALUES(description),
       source_table = VALUES(source_table),
       result_key_column = VALUES(result_key_column),
       result_label_column = VALUES(result_label_column),
       tenant_column = VALUES(tenant_column),
       user_column = VALUES(user_column),
       status_column = VALUES(status_column),
       active_status_values_json = VALUES(active_status_values_json),
       result_columns_json = VALUES(result_columns_json),
       include_for_admin = VALUES(include_for_admin),
       include_for_tenant = VALUES(include_for_tenant),
       max_rows = VALUES(max_rows),
       sort_order = VALUES(sort_order),
       status = VALUES(status),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [
      surface.surface_key,
      surface.display_name,
      surface.description,
      surface.source_table,
      surface.result_key_column,
      surface.result_label_column,
      surface.tenant_column,
      surface.user_column,
      surface.status_column,
      JSON.stringify(surface.active_status_values),
      JSON.stringify(surface.result_columns),
      surface.include_for_admin ? 1 : 0,
      surface.include_for_tenant ? 1 : 0,
      surface.max_rows,
      surface.sort_order,
      surface.status,
      surface.notes,
    ]
  );
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {
    // best-effort cleanup only
  }
}

async function main() {
  const args = parseArgs();
  const manifests = await loadManifests();
  if (args.apply && args.confirm !== CONFIRMATION) {
    throw new Error(`Apply requires --confirm=${CONFIRMATION}`);
  }

  const summary = {
    ok: true,
    mode: args.apply ? "apply" : "dry_run",
    source: "repo_activation_surface_manifests",
    manifest_dir: path.relative(API_DIR, SURFACE_DIR),
    manifest_count: manifests.length,
    surface_keys: manifests.map((item) => item.surface_key),
    applies_sql: args.apply,
    required_confirmation: CONFIRMATION,
    external_provider_called: false,
    secrets_included: false,
  };

  if (args.apply) {
    for (const manifest of manifests) await applyManifest(manifest);
    summary.applied_count = manifests.length;
    await closePoolQuietly();
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  await closePoolQuietly();
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "activation_surface_registry_sync_failed", message: error.message }, secrets_included: false }, null, 2));
  process.exit(1);
});
