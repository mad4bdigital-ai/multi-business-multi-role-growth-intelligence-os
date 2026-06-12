import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const migration = await fs.readFile(
  path.join(root, "migrations/307_sprint69_hostinger_deploy_restart_option_support.sql"),
  "utf8"
);

assert.match(migration, /remote_runtime_hostinger_deploy_release/, "deploy/release capability must be supported");
assert.match(migration, /hostinger_ssh_restart_app/, "restart capability must be supported");
assert.match(migration, /positive_dry_run_passed_execution_gated_certified/, "deploy must be dry-run certified and execution gated");
assert.match(migration, /positive_dry_run_passed_break_glass_execution_gated_certified/, "restart must be dry-run certified and break-glass gated");
assert.match(migration, /capability_envelope/, "both options must require capability-envelope governance");
assert.match(migration, /readback/, "both options must require post-action readback");
assert.match(migration, /secrets_included/, "migration must explicitly preserve no-secrets evidence semantics");
assert.match(migration, /v_platform_exports_current/, "capability export view must include route/certification capabilities");
assert.doesNotMatch(migration, /REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED'\s*,\s*false/, "deploy executor flag must not be disabled by the migration");
assert.doesNotMatch(migration, /dry_run=false/i, "migration must not execute deploy or restart");

console.log("hostinger deploy restart option contract tests passed");
