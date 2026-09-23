import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.resolve(HERE, "..", ".github", "workflows", "production-runtime-parity-evidence.yml");
const STAGING_REBUILD_AUTHORITY_PATH = path.resolve(HERE, "stagingRebuildEmptyAuthority.js");
const ROLE_SELECTION_RESOLVER_PATH = path.resolve(HERE, "hostBreakglassRoleSelectionArtifact.js");
const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
const stagingRebuildAuthority = fs.readFileSync(STAGING_REBUILD_AUTHORITY_PATH, "utf8");
const roleSelectionResolver = fs.readFileSync(ROLE_SELECTION_RESOLVER_PATH, "utf8");

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

test("full-role inspection validates all three roles and emits mutation-grade sanitized durable evidence", () => {
  const step = section(
    "- name: Run Hostinger-side full role inspection",
    "- name: Run Hostinger-side runtime environment dry-run",
  );

  assert.match(step, /mad4b\.host-breakglass-host-local-inspection\.v1/u);
  assert.match(step, /mad4b\.production-runtime-full-role-inspection-evidence\.v1/u);
  assert.match(step, /full_inspection_catalog/u);
  assert.match(step, /\$root\.full_inspection == true/u);
  assert.match(step, /\$root\.target_binding\.target_fingerprint/u);
  assert.match(step, /target_binding:\{target_fingerprint:\.target_binding\.target_fingerprint\}/u);
  assert.match(step, /source_binding:\{expected_sha:\$expected_sha\}/u);
  assert.match(step, /expected_sha:\$expected_sha/u);
  assert.match(step, /full_inspection:true/u);
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

  // The durable artifact preserves only the target hash, never raw database/principal identity.
  assert.match(step, /target_fingerprint/u);
  assert.match(step, /connection_string/u);
  assert.match(step, /raw_values_exposed == false/u);
});

test("full-role producer and role-selection consumer use one canonical artifact contract", () => {
  const upload = section(
    "- name: Upload bounded no-secret bootstrap evidence",
    "\n\n  live:",
  );
  assert.match(upload, /name: production-runtime-bootstrap-\$\{\{ inputs\.bootstrap_mode \}\}-\$\{\{ inputs\.expected_sha \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(roleSelectionResolver, /FULL_INSPECTION_ARTIFACT_MODE = "full_role_inspection"/u);
  assert.match(roleSelectionResolver, /FULL_INSPECTION_RESULT_ENTRY = "full-role-inspection\.json"/u);
  assert.match(roleSelectionResolver, /production-runtime-bootstrap-\$\{FULL_INSPECTION_ARTIFACT_MODE\}-\$\{expectedSha\}-\$\{runId\}/u);
  assert.doesNotMatch(roleSelectionResolver, /production-runtime-bootstrap-dry_run-\$\{expectedSha\}-\$\{runId\}/u);
  assert.match(roleSelectionResolver, /extractZipEntry\(zip, FULL_INSPECTION_RESULT_ENTRY, MAX_RESULT_BYTES\)/u);
});

test("full-role role/classification consistency predicate is valid jq and guards the workflow source", () => {
  const step = section(
    "- name: Run Hostinger-side full role inspection",
    "- name: Run Hostinger-side runtime environment dry-run",
  );

  assert.doesNotMatch(step, /all\(\$roles\[\] as \$role;/u);
  assert.match(
    step,
    /\(\[ \$roles\[\] as \$role \| \(\(\$root\.role_database_object_classifications\[\$role\] == "zero_objects"\) == \(\$root\.role_database_object_counts\[\$role\]\.total == 0\)\) \] \| all\)/u,
  );

  const predicate = `
    (["governance","runtime","runtime_persistence"]) as $roles |
    {
      role_database_object_classifications:{
        governance:"zero_objects",
        runtime:"nonempty_objects",
        runtime_persistence:"nonempty_objects"
      },
      role_database_object_counts:{
        governance:{total:0},
        runtime:{total:1},
        runtime_persistence:{total:1}
      }
    } as $root |
    ([ $roles[] as $role | (($root.role_database_object_classifications[$role] == "zero_objects") == ($root.role_database_object_counts[$role].total == 0)) ] | all)
  `;

  const result = spawnSync("jq", ["-n", "-e", predicate], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Production full-role evidence cannot be consumed as Staging rebuild mutation authority", () => {
  // Production evidence is deliberately a different contract from the durable Staging
  // inspection run that is allowed to participate in rebuild planning and ticket issuance.
  assert.doesNotMatch(stagingRebuildAuthority, /mad4b\.production-runtime-full-role-inspection-evidence\.v1/u);
  assert.match(stagingRebuildAuthority, /mad4b\.staging-durable-full-inspection\.v2/u);
  assert.match(stagingRebuildAuthority, /targetKey !== "staging-runtime"/u);
  assert.match(stagingRebuildAuthority, /source: "durable_full_inspection"/u);
  assert.match(stagingRebuildAuthority, /run\.durable_full_inspection !== true/u);
  assert.match(stagingRebuildAuthority, /caller_role_selection_allowed: false/u);

  // Recording recomputes canonical Staging role selection from counts and bundle bindings;
  // prepare/approve accept only durable run references, never caller-selected roles.
  assert.match(
    stagingRebuildAuthority,
    /assertExactKeys\(input, new Set\(\["expected_sha", "target_key", "correlation_id", "inspection", "role_bundle_bindings"\]\), "Rebuild-empty inspection recording"\)/u,
  );
  assert.match(
    stagingRebuildAuthority,
    /assertExactKeys\(input, new Set\(\["expected_sha", "inspection_run_id", "idempotency_key"\]\), "Rebuild-empty prepare"\)/u,
  );
  assert.match(
    stagingRebuildAuthority,
    /assertExactKeys\(input, new Set\(\["expected_sha", "inspection_run_id", "idempotency_key", "approval_confirmation"\]\), "Rebuild-empty approval"\)/u,
  );
  assert.match(stagingRebuildAuthority, /issueExecutionTicket\(\{/u);
  assert.match(stagingRebuildAuthority, /operation: "database\.rebuild_empty"/u);
  assert.match(stagingRebuildAuthority, /role_selection_required: true/u);
});

test("pull-request contract executes the full-role and role-selection regressions", () => {
  assert.match(workflow, /Validate Production full-role inspection workflow contract/u);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/u);
  assert.match(workflow, /node --test test-production-runtime-full-role-inspection-workflow\.mjs test-host-breakglass-role-selection-artifact\.mjs/u);
});
