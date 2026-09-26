import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "production-recovery-control-store-bootstrap.yml");
const source = fs.readFileSync(workflowPath, "utf8");

for (const required of [
  "issue_comment:",
  "workflow_dispatch:",
  "ISSUE_NUMBER",
  "7999",
  "AUTHOR_ASSOCIATION",
  "OWNER",
  "PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP_STATUS",
  "PLAN_PRODUCTION_RECOVERY_CONTROL_STORE_BOOTSTRAP",
  "APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA",
  "environment: Production",
  "https://auth.mad4b.com",
  "/admin/recovery-bootstrap/status",
  "/admin/recovery-bootstrap/plan",
  "/admin/recovery-bootstrap/apply",
  "same_cycle_readback_performed",
  "target_database_mutation_performed",
  "provider_mutation_performed",
  "production_runtime_mutation_performed",
  "secrets_included",
]) {
  assert(source.includes(required), `workflow missing required bounded contract: ${required}`);
}

for (const forbidden of [
  "raw_sql",
  "sql=",
  "database_name:",
  "RECOVERY_CONTROL_DB_PASSWORD:",
  "HOSTINGER_API_TOKEN:",
  "ssh ",
  "scp ",
]) {
  assert(!source.includes(forbidden), `workflow must not expose forbidden bootstrap input: ${forbidden}`);
}

assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
assert.match(source, /\^\[0-9a-f\]\{64\}\$/u);

console.log("production recovery control-store bootstrap workflow tests passed");
