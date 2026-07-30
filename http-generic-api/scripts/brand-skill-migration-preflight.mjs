#!/usr/bin/env node
import { getPool } from "../db.js";
import { assessBrandSkillMigrationPreflight } from "../brandSkillMigrationPreflight.js";

let pool = null;
let report;
try {
  pool = getPool();
  report = await assessBrandSkillMigrationPreflight({
    pool,
    requireRuntimeBaseline: true,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
} catch (error) {
  report = {
    ok: false,
    ready: false,
    status: "fail",
    mode: "read_only_preflight",
    applies_sql: false,
    error: {
      code: error?.code || "BRAND_SKILL_MIGRATION_PREFLIGHT_FAILED",
      message: "Brand skill migration preflight failed.",
    },
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (typeof pool?.end === "function") await pool.end();
}
