import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/150_sprint65_remote_ssh_runtime_foundation.sql", "utf8");

assert(migration.includes("remote_ssh_runtime"), "migration must register remote_ssh_runtime plugin");
assert(migration.includes("CREATE TABLE IF NOT EXISTS remote_runtime_targets"), "migration must create remote runtime target registry");
assert(migration.includes("CREATE TABLE IF NOT EXISTS remote_runtime_command_allowlists"), "migration must create remote runtime command allowlist registry");
assert(migration.includes("v_remote_runtime_target_coverage_issues"), "migration must create remote runtime diagnostic view");

for (const table of ["app_integrations", "user_app_connections", "credential_intake_sessions"]) {
  assert(migration.includes(`ALTER TABLE ${table}`), `migration must extend auth_type enum for ${table}`);
}
assert(migration.includes("'ssh_key_pair'"), "migration must add ssh_key_pair auth type");
assert(migration.includes("'local_path'"), "migration must add local_path auth type");

for (const action of [
  "remote_ssh.probe",
  "remote_ssh.tail_logs",
  "remote_ssh.exec_allowlisted",
  "remote_ssh.deploy_pull",
  "remote_ssh.restart_app",
  "remote_ssh.local_path_status",
]) {
  assert(migration.includes(action), `migration must include action ${action}`);
}

for (const command of ["status", "tail_logs", "git_status", "deploy_pull", "restart_app", "run_smoke"]) {
  assert(migration.includes(`'${command}'`), `migration must seed command allowlist ${command}`);
}

assert(migration.includes("FROM connected_systems cs"), "migration must build on existing connected_systems Hostinger SSH setup");
assert(migration.includes("cs.connector_family = 'hostinger_ssh'"), "migration must bridge hostinger_ssh connected systems");
assert(migration.includes("FROM local_project_path_registry lpr"), "migration must bridge local project path registry");
assert(migration.includes("local.connector.shell"), "migration must bind local shell virtual tool path");
assert(migration.includes("local.connector.files"), "migration must bind local files virtual tool path");
assert(migration.includes("hostinger_ssh_status"), "migration must bind existing Hostinger SSH status tool");
assert(migration.includes("hostinger_ssh_tail_logs"), "migration must bind existing Hostinger SSH tail logs tool");
assert(migration.includes("hostinger_ssh_restart_app"), "migration must bind existing Hostinger SSH restart tool");

assert(migration.includes("no arbitrary shell") || migration.includes("arbitrary shell"), "migration comments must explicitly avoid arbitrary shell");
assert(migration.includes("secrets_included',false"), "target metadata must mark secrets_included=false");
assert(!/BEGIN\s+RSA\s+PRIVATE\s+KEY/i.test(migration), "migration must not contain private key material");
assert(!/BEGIN\s+OPENSSH\s+PRIVATE\s+KEY/i.test(migration), "migration must not contain OpenSSH private key material");
assert(!/password\s*[:=]\s*['\"][^'\"]+/i.test(migration), "migration must not embed password literals");

assert(migration.includes("UNIQUE KEY uq_remote_runtime_system_target"), "targets must dedupe existing connected_systems bridge rows");
assert(migration.includes("UNIQUE KEY uq_remote_runtime_local_path_target"), "targets must dedupe local path bridge rows");
assert(migration.includes("UNIQUE KEY uq_remote_runtime_command"), "command allowlists must dedupe command keys");

console.log("remote SSH runtime foundation migration tests passed");
