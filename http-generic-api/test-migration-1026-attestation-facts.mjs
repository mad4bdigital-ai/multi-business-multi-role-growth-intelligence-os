import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { assessMigrationSqlPreflight, splitSqlStatements } from "./releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, "migrations", "1026_sprint69_repository_reconciliation_automation.sql");
const sql = fs.readFileSync(migrationPath, "utf8");
const statements = splitSqlStatements(sql);
const preflight = assessMigrationSqlPreflight(sql, { migrationFile: path.basename(migrationPath) });
const facts = {
  migration_sha256: crypto.createHash("sha256").update(sql).digest("hex"),
  statement_count: statements.length,
  preflight_status: preflight.status,
  preflight_risk_count: preflight.risk_count,
  preflight_risks: preflight.risks,
};
throw new Error(`MIGRATION_1026_ATTESTATION_FACTS ${JSON.stringify(facts)}`);
