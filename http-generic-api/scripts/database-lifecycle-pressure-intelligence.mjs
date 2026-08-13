#!/usr/bin/env node
import { collectDatabaseLifecyclePressureEvidence } from "../databaseLifecyclePressureIntelligence.js";
import { getPool } from "../db.js";

function parseArgs(argv) {
  const args = { limit: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--limit") {
      args.limit = argv[index + 1] || args.limit;
      index += 1;
    } else if (value === "--observed-at") {
      args.observed_at = argv[index + 1] || null;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();
  try {
    const report = await collectDatabaseLifecyclePressureEvidence(args, { pool });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || "DATABASE_LIFECYCLE_PRESSURE_INTELLIGENCE_FAILED",
    message: error.message,
    dry_run: true,
    will_write: false,
    will_execute: false,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
