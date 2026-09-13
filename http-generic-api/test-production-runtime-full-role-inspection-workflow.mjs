import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.resolve(HERE, "..", ".github", "workflows", "production-runtime-parity-evidence.yml");
const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

function section(start, end) {
  const startIndex = workflow.indexOf(start);
  assert.notEqual(startIndex, -1, `missing workflow section: ${start}`);
  const endIndex = workflow.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing workflow section terminator: ${end}`);
  return workflow.slice(startIndex, endIndex);
}

test("Production parity workflow exposes a dedicated read-only full-role inspection mode", () => {
  assert.match(workflow, /bootstrap_mode:[\s\S]*?- full_role_inspection/u);
  assert.match(workflow, /bootstrap_target_source:[\s\S]*?- host_local_role_env/u);

  const guard = section(
    "- name: Validate bootstrap target source scope",
    "- name: Validate Host Breakglass catalog binding",
  );
  assert.match(guard, /repository_allowlist\|hostinger_runtime_env\|host_local_role_env/u);
  assert.match(guard, /hostinger_runtime_env_dry_run_only/u);
  assert.match(guard, /host_local_role_env_full_role_inspection_only/u);
  assert.match(guard, /full_role_inspection_requires_host_local_role_env/u);
  assert.match(guard, /full_role_inspection_mutation_authority_denied/u);
});

test("full-role inspection calls only the protected role census endpoint with bounded caller input", () => {
  const step = section(
    "- name: Run Hostinger-side full role inspection",
    "- name: Run Hostinger-side runtime environment dry-run",
  );

  assert.match(step, /inputs\.bootstrap_mode == 'full_role_inspection' && inputs\.bootstrap_target_source == 'host_local_role_env'/u);
  assert.match(step, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/u);
  assert.match(step, /https:\/\/auth\.mad4b\.com\/deployment-info\/runtime-bootstrap-role-dry-run/u);
  assert.match(step, /\{expected_sha:\$expected_sha,target_key:\$target_key\}/u);
  assert.match(step, /raw-full-role-inspection\.json/u);
  assert.match(step, /full-role-inspection\.json/u);

  assert.doesNotMatch(step, /MYSQL_BOOTSTRAP_/u);
  assert.doesNotMatch(step, /HOSTINGER_PROD_SSH/u);
  assert.doesNotMatch(step, /execute_sql_capsule|execute_shell_capsule|apply_migration|apply_grants/u);
  assert.doesNotMatch(step, /bootstrap_migration_confirmation|bootstrap_grants_confirmation|bootstrap_rebuild_confirmation/u);
});

test("full-role inspection validates all three roles and emits only sanitized durable evidence", () => {
  const step = section(
    "- name: Run Hostinger-side full role inspection",
    "- name: Run Hostinger-side runtime environment dry-run",
  );

  assert.match(step, /mad4b\.host-breakglass-host-local-inspection\.v1/u);
  assert.match(step, /mad4b\.production-runtime-full-role-inspection-evidence\.v1/u);
  assert.match(step, /full_inspection_catalog/u);
  assert.match(step, /role_database_object_counts/u);
  assert.match(step, /role_database_object_classifications/u);
  assert.match(step, /role_database_object_count_fingerprints/u);
  assert.match(step, /runtime_persistence/u);
  assert.match(step, /database_mutation_performed == false/u);
  assert.match(step, /migration_apply_performed == false/u);
  assert.match(step, /grant_mutation_performed == false/u);
  assert.match(step, /workflow_dispatch_performed == false/u);
  assert.match(step, /repository_mutation_performed:false/u);
  assert.match(step, /provider_mutation_performed:false/u);
  assert.match(step, /secrets_included:false/u);
  assert.match(step, /umask 077/u);
  assert.match(step, /trap cleanup_full_role_inspection EXIT/u);
  assert.match(step, /rm -f "\$\{payload_file\}" "\$\{header_file\}" "\$\{raw_result_file\}"/u);
  assert.match(step, /rm -f "\$\{raw_result_file\}"/u);

  // The durable artifact is explicitly checked for raw identity/credential field names.
  assert.match(step, /connection_string/u);
  assert.match(step, /raw_values_exposed == false/u);
});

test("pull-request contract executes the source-level full-role workflow regression", () => {
  assert.match(workflow, /Validate Production full-role inspection workflow contract/u);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/u);
  assert.match(workflow, /node --test test-production-runtime-full-role-inspection-workflow\.mjs/u);
});
