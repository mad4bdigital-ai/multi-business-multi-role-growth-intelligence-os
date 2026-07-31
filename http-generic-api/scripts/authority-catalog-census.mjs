#!/usr/bin/env node
import { getPool } from "../db.js";
import { collectAuthorityCatalogCensus } from "../authorityCatalogCensus.js";

let pool = null;
try {
  pool = getPool();
  const report = await collectAuthorityCatalogCensus({ pool });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const report = {
    ok: false,
    status: "fail",
    mode: "read_only_authority_catalog_census",
    read_only: true,
    applies_sql: false,
    error: {
      code: error?.code || "AUTHORITY_CATALOG_CENSUS_FAILED",
      message: "Authority catalog census failed.",
    },
    closure_state: {
      t002_complete: false,
      t021_authorized: false,
    },
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (typeof pool?.end === "function") await pool.end();
}
