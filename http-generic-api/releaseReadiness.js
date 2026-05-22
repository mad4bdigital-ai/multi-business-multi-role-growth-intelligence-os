/**
 * releaseReadiness.js — Sprint 18
 *
 * Comprehensive platform health + release-readiness check.
 * Runs structural, data, and operational checks and returns a full report.
 *
 * Structural checks (table existence):
 *   All 42 new platform tables must exist.
 *
 * Data checks (seed integrity):
 *   Plans seeded, assistance roles seeded, quota rules seeded.
 *
 * Operational checks:
 *   DB connectivity, legacy tables reachable, migration inventory populated.
 */

import { getPool } from "./db.js";
import { randomUUID } from "node:crypto";
import { resolvePlatformGraphMemory } from "./services/platformGraphMemoryResolver.js";

// ── All platform tables that must exist ───────────────────────────────────────
const REQUIRED_TABLES = [
  // Sprint 02
  "tenants", "tenant_relationships", "memberships", "invitations",
  // Sprint 03
  "users", "actor_profiles", "role_assignments", "plans",
  "subscriptions", "entitlements", "assistance_roles",
  // Sprint 04
  "customers", "contacts", "threads", "tickets", "timeline_events",
  // Sprint 05
  "logic_definitions", "logic_packs", "pack_attachments", "adaptation_records",
  // Sprint 06
  "request_envelopes",
  // Sprint 07
  "connected_systems", "installations", "permission_grants", "workspace_registry",
  // Sprint 08
  "intent_resolutions", "execution_plans",
  // Sprint 10
  "tracking_workspaces", "tracked_events", "reporting_views",
  // Sprint 12
  "onboarding_states", "readiness_checks",
  // Sprint 14
  "workflow_runs", "step_runs", "approval_holds",
  // Sprint 15
  "telemetry_spans", "usage_meters", "quota_rules",
  // Sprint 16
  "audit_log", "secret_references", "incidents", "compliance_profiles",
  // Sprint 17
  "developer_apps", "api_credentials", "webhooks", "rate_limit_rules",
  // Sprint 18
  "data_migration_inventory", "release_readiness_log",
];

// ── Legacy tables that must still be reachable ────────────────────────────────
const LEGACY_TABLES = [
  "brands", "actions", "endpoints", "execution_policies",
  "task_routes", "workflows", "execution_log",
];

async function checkDbConnectivity() {
  try {
    await getPool().query("SELECT 1");
    return { status: "pass", detail: "DB connection OK." };
  } catch (err) {
    return { status: "fail", detail: `DB connection failed: ${err.message}` };
  }
}

async function checkTableExists(table) {
  try {
    const [[row]] = await getPool().query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [table]
    );
    return row.cnt > 0
      ? { status: "pass", detail: `Table '${table}' exists.` }
      : { status: "fail", detail: `Table '${table}' is MISSING.` };
  } catch (err) {
    return { status: "fail", detail: `Check failed for '${table}': ${err.message}` };
  }
}

async function checkSeedData() {
  const checks = {};

  const [[plans]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `plans`");
  checks.plans_seeded = plans.cnt >= 4
    ? { status: "pass", detail: `${plans.cnt} plan(s) in DB (need ≥ 4).` }
    : { status: "fail", detail: `Only ${plans.cnt} plan(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[roles]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `assistance_roles`");
  checks.assistance_roles_seeded = roles.cnt >= 7
    ? { status: "pass", detail: `${roles.cnt} assistance role(s) in DB (need ≥ 7).` }
    : { status: "fail", detail: `Only ${roles.cnt} role(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[quotas]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `quota_rules`");
  checks.quota_rules_seeded = quotas.cnt >= 4
    ? { status: "pass", detail: `${quotas.cnt} quota rule(s) in DB (need ≥ 4).` }
    : { status: "warn", detail: `Only ${quotas.cnt} quota rule(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[tenants]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `tenants`");
  checks.tenants_bootstrapped = tenants.cnt > 0
    ? { status: "pass", detail: `${tenants.cnt} tenant(s) provisioned.` }
    : { status: "warn", detail: "No tenants yet — run: node tenantBrandBridge.mjs --apply" };

  return checks;
}

async function checkMigrationInventory() {
  const [[row]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `data_migration_inventory`");
  return row.cnt > 0
    ? { status: "pass", detail: `Migration inventory has ${row.cnt} entity classification entries.` }
    : { status: "warn", detail: "Migration inventory is empty — entity classification not recorded." };
}

async function checkMigrationInventorySafe() {
  try {
    return await checkMigrationInventory();
  } catch (err) {
    return {
      status: "warn",
      detail: `Migration inventory unavailable: ${err?.message || "table check failed"}`
    };
  }
}

function graphMemoryCheckResult(memory = {}) {
  const assetCount = Number(memory.asset_count || 0);
  const resolved = Boolean(memory.resolved);
  return {
    status: resolved ? "pass" : "warn",
    detail: resolved
      ? `Graph memory resolved ${assetCount} asset(s) for release readiness diagnostics.`
      : memory.reason || "Graph memory returned no diagnostic assets.",
    requested: Boolean(memory.requested),
    resolved,
    asset_count: assetCount,
    asset_keys: Array.isArray(memory.assets)
      ? memory.assets.map((asset) => asset?.asset_key).filter(Boolean).slice(0, 10)
      : [],
    selection_policy: memory.selection_policy || {},
    secrets_included: false,
  };
}

async function checkGraphMemoryDiagnostics() {
  try {
    const memory = await resolvePlatformGraphMemory({
      input: {
        node_id: "platform.global",
        request_type: "release_readiness",
        diagnostic_surface: "release_readiness",
        depth: 1,
        memory_limit: 5,
      },
      limit: 5,
    });
    return graphMemoryCheckResult(memory);
  } catch (err) {
    return {
      status: "warn",
      detail: `Graph memory diagnostics unavailable: ${err?.message || "unknown error"}`,
      requested: true,
      resolved: false,
      asset_count: 0,
      asset_keys: [],
      selection_policy: {},
      secrets_included: false,
    };
  }
}

async function checkLegacyTables() {
  const results = {};
  for (const table of LEGACY_TABLES) {
    const r = await checkTableExists(table);
    results[table] = r;
  }
  return results;
}

// ── Public: run all release readiness checks ─────────────────────────────────
export async function runReleaseReadiness({ persist = false } = {}) {
  const run_id = randomUUID();
  const report = {
    run_id,
    checked_at: new Date().toISOString(),
    overall: "pass",
    db_connectivity: null,
    platform_tables: {},
    legacy_tables: {},
    seed_data: {},
    migration_inventory: null,
    graph_memory_diagnostics: null,
  };

  // DB connectivity
  report.db_connectivity = await checkDbConnectivity();
  if (report.db_connectivity.status === "fail") {
    report.overall = "fail";
    return report;
  }

  // Platform table checks (parallel)
  const tableResults = await Promise.all(REQUIRED_TABLES.map((t) => checkTableExists(t)));
  for (let i = 0; i < REQUIRED_TABLES.length; i++) {
    report.platform_tables[REQUIRED_TABLES[i]] = tableResults[i];
    if (tableResults[i].status === "fail") report.overall = "fail";
  }

  // Legacy table checks (parallel)
  report.legacy_tables = await checkLegacyTables();
  for (const [, r] of Object.entries(report.legacy_tables)) {
    if (r.status === "fail" && report.overall !== "fail") report.overall = "warn";
  }

  // Seed data checks
  report.seed_data = await checkSeedData();
  for (const [, r] of Object.entries(report.seed_data)) {
    if (r.status === "fail" && report.overall !== "fail") report.overall = "fail";
    else if (r.status === "warn" && report.overall === "pass") report.overall = "warn";
  }

  // Migration inventory
  report.migration_inventory = await checkMigrationInventorySafe();
  if (report.migration_inventory.status === "warn" && report.overall === "pass") report.overall = "warn";

  // Summary counts
  const allChecks = [
    report.db_connectivity,
    ...Object.values(report.platform_tables),
    ...Object.values(report.legacy_tables),
    ...Object.values(report.seed_data),
    report.migration_inventory,
  ];
  report.summary = {
    total: allChecks.length,
    pass: allChecks.filter((c) => c.status === "pass").length,
    warn: allChecks.filter((c) => c.status === "warn").length,
    fail: allChecks.filter((c) => c.status === "fail").length,
    platform_tables_total: REQUIRED_TABLES.length,
    platform_tables_ok: Object.values(report.platform_tables).filter((c) => c.status === "pass").length,
  };

  if (persist) {
    try {
      const pool = getPool();
      const entries = [
        ["db_connectivity", report.db_connectivity],
        ...Object.entries(report.platform_tables),
        ...Object.entries(report.legacy_tables).map(([k, v]) => [`legacy.${k}`, v]),
        ...Object.entries(report.seed_data),
        ["migration_inventory", report.migration_inventory],
      ];
      await Promise.all(entries.map(([key, r]) =>
        pool.query(
          "INSERT INTO `release_readiness_log` (run_id, check_key, status, detail) VALUES (?, ?, ?, ?)",
          [run_id, key, r.status, r.detail || null]
        )
      ));
    } catch { /* non-blocking */ }
  }

  return report;
}
