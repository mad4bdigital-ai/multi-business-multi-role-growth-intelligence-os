/**
 * seed-entity-classification.mjs
 * Populates data_migration_inventory with authority model for all 54 tables.
 * Safe to re-run (ON DUPLICATE KEY UPDATE).
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch {}

const pool = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  timezone: "Z",
});

// [entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes?]
const ENTRIES = [
  // Sprint 02 — Tenancy
  ["tenant",               "tenants",                "canonical",    1, "platform_primary", "complete",     null],
  ["tenant_relationship",  "tenant_relationships",   "canonical",    1, "platform_primary", "complete",     null],
  ["membership",           "memberships",            "canonical",    1, "platform_primary", "complete",     null],
  ["invitation",           "invitations",            "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 03 — Identity & Plans
  ["user",                 "users",                  "canonical",    1, "platform_primary", "complete",     null],
  ["actor_profile",        "actor_profiles",         "canonical",    1, "platform_primary", "complete",     null],
  ["role_assignment",      "role_assignments",       "canonical",    1, "platform_primary", "complete",     null],
  ["plan",                 "plans",                  "canonical",    1, "platform_primary", "complete",     null],
  ["subscription",         "subscriptions",          "canonical",    1, "platform_primary", "complete",     null],
  ["entitlement",          "entitlements",           "canonical",    1, "platform_primary", "complete",     null],
  ["assistance_role",      "assistance_roles",       "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 04 — Customer Ops
  ["customer",             "customers",              "canonical",    1, "platform_primary", "complete",     null],
  ["contact",              "contacts",               "canonical",    1, "platform_primary", "complete",     null],
  ["thread",               "threads",                "canonical",    1, "platform_primary", "complete",     null],
  ["ticket",               "tickets",                "canonical",    1, "platform_primary", "complete",     null],
  ["timeline_event",       "timeline_events",        "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 05 — Logic Graph
  ["logic_definition",     "logic_definitions",      "canonical",    1, "platform_primary", "complete",     null],
  ["logic_pack",           "logic_packs",            "canonical",    1, "platform_primary", "complete",     null],
  ["pack_attachment",      "pack_attachments",       "canonical",    1, "platform_primary", "complete",     null],
  ["adaptation_record",    "adaptation_records",     "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 06 — Access Control
  ["request_envelope",     "request_envelopes",      "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 07 — Connected Systems
  ["connected_system",     "connected_systems",      "canonical",    1, "platform_primary", "complete",     null],
  ["installation",         "installations",          "canonical",    1, "platform_primary", "complete",     null],
  ["permission_grant",     "permission_grants",      "canonical",    1, "platform_primary", "complete",     null],
  ["workspace",            "workspace_registry",     "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 08 — Planner
  ["intent_resolution",    "intent_resolutions",     "canonical",    1, "platform_primary", "complete",     null],
  ["execution_plan",       "execution_plans",        "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 10 — Tracking
  ["tracking_workspace",   "tracking_workspaces",    "canonical",    1, "platform_primary", "complete",     null],
  ["tracked_event",        "tracked_events",         "canonical",    1, "platform_primary", "complete",     null],
  ["reporting_view",       "reporting_views",        "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 12 — Bootstrap
  ["onboarding_state",     "onboarding_states",      "canonical",    1, "platform_primary", "complete",     null],
  ["readiness_check",      "readiness_checks",       "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 14 — Workflow Orchestration
  ["workflow_run",         "workflow_runs",          "canonical",    1, "platform_primary", "complete",     null],
  ["step_run",             "step_runs",              "canonical",    1, "platform_primary", "complete",     null],
  ["approval_hold",        "approval_holds",         "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 15 — Observability
  ["telemetry_span",       "telemetry_spans",        "canonical",    1, "platform_primary", "complete",     null],
  ["usage_meter",          "usage_meters",           "canonical",    1, "platform_primary", "complete",     null],
  ["quota_rule",           "quota_rules",            "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 16 — Security & Compliance
  ["audit_entry",          "audit_log",              "canonical",    1, "platform_primary", "complete",     null],
  ["secret_reference",     "secret_references",      "canonical",    1, "platform_primary", "complete",     null],
  ["incident",             "incidents",              "canonical",    1, "platform_primary", "complete",     null],
  ["compliance_profile",   "compliance_profiles",    "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 17 — Developer API
  ["developer_app",        "developer_apps",         "canonical",    1, "platform_primary", "complete",     null],
  ["api_credential",       "api_credentials",        "canonical",    1, "platform_primary", "complete",     null],
  ["webhook",              "webhooks",               "canonical",    1, "platform_primary", "complete",     null],
  ["rate_limit_rule",      "rate_limit_rules",       "canonical",    1, "platform_primary", "complete",     null],
  // Sprint 18 — Data Hardening
  ["migration_inventory",  "data_migration_inventory","canonical",   1, "platform_primary", "complete",     null],
  ["readiness_log",        "release_readiness_log",  "canonical",    1, "platform_primary", "complete",     null],
  // Legacy tables — still active, migration pending
  ["brand",                "brands",                 "transitional", 2, "legacy_primary",   "in_progress",  "Being migrated to tenants via tenantBrandBridge"],
  ["action",               "actions",                "legacy",       3, "legacy_primary",   "not_started",  "Legacy action registry; target: logic_definitions"],
  ["endpoint",             "endpoints",              "legacy",       3, "legacy_primary",   "not_started",  "Legacy endpoint config; target: connected_systems"],
  ["execution_policy",     "execution_policies",     "transitional", 1, "platform_primary", "in_progress",  "Current runtime preflight authority; target policy model is platform_engine_policy_registry/platform_engine_policy_rules, not logic_definitions"],
  ["policy_logic_binding",  "policy_logic_bindings",  "canonical",    1, "platform_primary", "complete",     "Traceability bridge between execution_policies, target policy rules, and legacy logic mirrors"],
  ["task_route",           "task_routes",            "legacy",       3, "legacy_primary",   "not_started",  "Legacy intent routing; target: intent_resolutions"],
  ["workflow_legacy",      "workflows",              "legacy",       3, "legacy_primary",   "not_started",  "Legacy workflow definitions; target: workflow_runs"],
  ["execution_log",        "execution_log",          "legacy",       3, "legacy_primary",   "not_started",  "Legacy execution history; target: telemetry_spans"],
];

let written = 0;
for (const [entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes] of ENTRIES) {
  await pool.query(
    `INSERT INTO \`data_migration_inventory\`
       (entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       authority_model    = VALUES(authority_model),
       read_priority      = VALUES(read_priority),
       write_strategy     = VALUES(write_strategy),
       migration_status   = VALUES(migration_status),
       notes              = VALUES(notes),
       last_checked_at    = NOW()`,
    [entity_class, table_name, authority_model, read_priority, write_strategy, migration_status, notes]
  );
  written++;
}

await pool.end();
console.log(`Done. ${written} entity classification entries written.`);
