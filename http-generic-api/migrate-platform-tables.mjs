/**
 * migrate-platform-tables.mjs
 *
 * Runs all platform DDL migrations in order against the configured MySQL DB.
 * Safe to re-run — every statement uses CREATE TABLE IF NOT EXISTS.
 *
 * Usage:
 *   node migrate-platform-tables.mjs               # run all migrations
 *   node migrate-platform-tables.mjs --seed        # also seed reference data
 *   node migrate-platform-tables.mjs --dry-run     # print SQL only, no execute
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch { /* rely on process.env */ }

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SEED    = args.includes("--seed");
const ONLY_IDX = args.indexOf("--only");
const ONLY    = ONLY_IDX !== -1 ? String(args[ONLY_IDX + 1] || "").trim() : null;

const MIGRATIONS_DIR = resolve(__dirname, "migrations");

// ── Platform owner seed (applied once when --seed flag given) ─────────────────
const SEED_SQL = [
  // Plans
  `INSERT IGNORE INTO \`plans\` (plan_id, plan_key, display_name, service_mode, price_monthly_usd, features_json, limits_json) VALUES
    (UUID(), 'starter',     'Starter',            'self_serve', 0.00,   '{"ai_execution":true}',  '{"monthly_executions":100}'),
    (UUID(), 'growth',      'Growth',             'self_serve', 49.00,  '{"ai_execution":true,"analytics":true}', '{"monthly_executions":1000}'),
    (UUID(), 'assisted',    'Assisted',           'assisted',   149.00, '{"ai_execution":true,"analytics":true,"human_review":true}', '{"monthly_executions":5000}'),
    (UUID(), 'managed',     'Managed Service',    'managed',    499.00, '{"ai_execution":true,"analytics":true,"human_review":true,"dedicated_ops":true}', '{"monthly_executions":null}')`,

  // Assistance roles (7 levels)
  `INSERT IGNORE INTO \`assistance_roles\` (role_id, role_key, display_name, level, capabilities_json) VALUES
    (UUID(), 'reviewer_trainee',         'Reviewer Trainee',         1, '{"can_review":false,"can_approve":false}'),
    (UUID(), 'certified_reviewer',       'Certified Reviewer',       2, '{"can_review":true,"can_approve":false}'),
    (UUID(), 'senior_reviewer',          'Senior Reviewer',          3, '{"can_review":true,"can_approve":true}'),
    (UUID(), 'auditor',                  'Auditor',                  4, '{"can_review":true,"can_approve":true,"can_audit":true}'),
    (UUID(), 'supervisor',               'Supervisor',               5, '{"can_review":true,"can_approve":true,"can_audit":true,"can_supervise":true}'),
    (UUID(), 'managed_service_operator', 'Managed Service Operator', 6, '{"can_review":true,"can_approve":true,"can_audit":true,"can_supervise":true,"can_operate":true}'),
    (UUID(), 'training_mentor',          'Training Mentor',          7, '{"can_review":true,"can_approve":true,"can_audit":true,"can_supervise":true,"can_operate":true,"can_train":true}')`,

  // Quota rules — one monthly execution quota per plan
  `INSERT IGNORE INTO \`quota_rules\` (rule_id, plan_key, meter_key, limit_value, period, action) VALUES
    (UUID(), 'starter',  'ai_executions', 100,  'monthly', 'block'),
    (UUID(), 'growth',   'ai_executions', 1000, 'monthly', 'block'),
    (UUID(), 'assisted', 'ai_executions', 5000, 'monthly', 'warn'),
    (UUID(), 'managed',  'ai_executions', NULL, 'monthly', 'log'),
    (UUID(), 'starter',  'api_calls',     500,  'monthly', 'throttle'),
    (UUID(), 'growth',   'api_calls',     10000,'monthly', 'throttle'),
    (UUID(), 'assisted', 'api_calls',     50000,'monthly', 'warn'),
    (UUID(), 'managed',  'api_calls',     NULL, 'monthly', 'log'),
    (UUID(), 'starter',  'workflow_runs', 50,   'monthly', 'block'),
    (UUID(), 'growth',   'workflow_runs', 500,  'monthly', 'block'),
    (UUID(), 'assisted', 'workflow_runs', 2000, 'monthly', 'warn'),
    (UUID(), 'managed',  'workflow_runs', NULL, 'monthly', 'log')`,

  // Default rate-limit rules (applied when no tenant/app override)
  `INSERT IGNORE INTO \`rate_limit_rules\` (rule_id, plan_key, route_pattern, window_sec, max_requests, action) VALUES
    (UUID(), 'starter',  '/execute',          60,  10,  'block'),
    (UUID(), 'growth',   '/execute',          60,  60,  'block'),
    (UUID(), 'assisted', '/execute',          60,  200, 'throttle'),
    (UUID(), 'managed',  '/execute',          60,  500, 'log'),
    (UUID(), NULL,       '/access/resolve',   60,  300, 'throttle'),
    (UUID(), NULL,       '/bootstrap/readiness', 60, 30, 'throttle')`,
];

async function main() {
  const pool = createPool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    timezone: "Z",
  });

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !ONLY || f.startsWith(ONLY))
    .sort();

  console.log(`Found ${files.length} migration file(s).`);

  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const statements = sql
      .split(";")
      .map((s) =>
        // Strip leading comment lines so the DDL statement is not misidentified as a comment
        s.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()
      )
      .filter((s) => s.length > 0);

    console.log(`\n── ${file} (${statements.length} statements) ──`);

    for (const stmt of statements) {
      const preview = stmt.slice(0, 80).replace(/\s+/g, " ");
      if (DRY_RUN) {
        console.log(`  [dry-run] ${preview}...`);
        continue;
      }
      try {
        await pool.query(stmt);
        console.log(`  ✓ ${preview}...`);
      } catch (err) {
        console.error(`  ✗ FAILED: ${err.message}`);
        console.error(`    SQL: ${stmt.slice(0, 200)}`);
        await pool.end();
        process.exit(1);
      }
    }
  }

  if (SEED && !DRY_RUN) {
    console.log("\n── Seeding reference data ──");
    for (const sql of SEED_SQL) {
      const preview = sql.slice(0, 80).replace(/\s+/g, " ");
      try {
        await pool.query(sql);
        console.log(`  ✓ ${preview}...`);
      } catch (err) {
        console.error(`  ✗ Seed failed: ${err.message}`);
      }
    }
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
