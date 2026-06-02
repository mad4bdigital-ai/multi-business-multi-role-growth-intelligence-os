#!/usr/bin/env node
import { getPool } from "../db.js";
import { planDatabaseLifecycleRetentionReview } from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = { limit: 50 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--limit") {
      args.limit = argv[index + 1] || args.limit;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const plan = await planDatabaseLifecycleRetentionReview({ limit: args.limit }, { pool });
  await pool.end();
  console.log(JSON.stringify(plan, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_LIFECYCLE_RETENTION_PLAN_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
