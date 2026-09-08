import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const contract = JSON.parse(fs.readFileSync(path.join(HERE, "config", "admin-recovery-chatgpt-connection.json"), "utf8"));
const surfaces = fs.readFileSync(path.join(ROOT, "canonicals", "openapi", "custom-gpt-surfaces.yaml"), "utf8");
const recoveryRoutes = fs.readFileSync(path.join(HERE, "routes", "recoveryKernelRoutes.js"), "utf8");
const systemLayer = fs.readFileSync(path.join(HERE, "routes", "systemLayerRoutes.js"), "utf8");
const broker = fs.readFileSync(path.join(HERE, "runtimeBreakglassBroker.js"), "utf8");

test("connection is pinned to the existing private Production Recovery projection", () => {
  assert.equal(contract.contract, "mad4b.admin-recovery-chatgpt-connection.v1");
  assert.equal(contract.environment, "production");
  assert.equal(contract.server_uri, "https://auth.mad4b.com");
  assert.equal(contract.principal_class, "admin_gpt");
  assert.equal(contract.projection.surface_key, "admin_recovery_production");
  assert.equal(contract.projection.registration_set, "production_recovery");
  assert.equal(contract.projection.private_only, true);
  assert.equal(contract.projection.shared_admin_core_member, false);
  assert.match(surfaces, /production_recovery:/);
  assert.match(surfaces, /admin_recovery_production/);
  assert.match(surfaces, /action_slot:\s*recovery_kernel/);
});

test("private recovery challenge and approved-step execution remain fixed server routes", () => {
  assert.match(recoveryRoutes, /\/admin\/recovery\/kernel\/approval-challenge/);
  assert.match(recoveryRoutes, /\/admin\/recovery\/kernel\/execute-approved/);
  assert.match(systemLayer, /recovery_kernel_create_approval_challenge/);
  assert.match(systemLayer, /recovery_kernel_execute_approved_step/);
});

test("connection never exposes generic GitHub dispatch, shell, SQL, tickets, or credentials", () => {
  const boundary = contract.execution_boundary;
  assert.equal(boundary.generic_workflow_dispatch_exposed, false);
  assert.equal(boundary.generic_shell_exposed, false);
  assert.equal(boundary.caller_supplied_execution_ticket_allowed, false);
  assert.equal(boundary.caller_supplied_repository_allowed, false);
  assert.equal(boundary.caller_supplied_workflow_allowed, false);
  assert.equal(boundary.caller_supplied_ref_allowed, false);
  assert.equal(boundary.caller_supplied_github_token_allowed, false);
  assert.equal(boundary.caller_supplied_database_identifier_allowed, false);
  assert.equal(boundary.caller_supplied_database_credentials_allowed, false);
  assert.equal(boundary.caller_supplied_sql_allowed, false);
});

test("runtime Breakglass broker keeps repo workflow ref and credential fields server-controlled", () => {
  for (const forbidden of [
    "github_token",
    "repository",
    "workflow",
    "workflow_file",
    "ref",
    "dispatch_ref",
    "database",
    "db_user",
    "db_password",
    "credential",
  ]) {
    assert.match(broker, new RegExp(`\\"${forbidden}\\"`));
  }
  assert.match(broker, /runtime_breakglass_production_sha_mismatch/);
  assert.match(broker, /actions\/workflows\/\$\{encodeURIComponent\(canonicalWorkflow\(\)\.file\)\}\/dispatches/);
});
