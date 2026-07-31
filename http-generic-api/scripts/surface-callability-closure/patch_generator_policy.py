# Temporary migration helper: all transformations are fail-closed and must be materialized before cleanup.
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "scripts" / "surface-callability-closure" / "generate_closure_contracts.mjs"
source = PATH.read_text(encoding="utf-8")

old_provider_set = '''const PROVIDER_READS = new Set([
  "tenant_database_preflight",
  "tenant_ssh_preflight",
  "tenant_database_schema_read",
  "tenant_database_query_readonly",
  "tenant_ssh_probe",
  "tenant_ssh_cli_allowlisted_dry_run",
]);'''
new_provider_set = '''const PROVIDER_READS = new Set([
  "tenant_database_schema_read",
  "tenant_database_query_readonly",
  "tenant_ssh_probe",
]);'''
if old_provider_set in source:
    source = source.replace(old_provider_set, new_provider_set, 1)
elif new_provider_set not in source:
    raise SystemExit("closure_generator_provider_read_set_marker_missing")

old_external_policy = 'if (effect === "external_execute") return { read_only: false, provider_calls_allowed: true, external_writes_allowed: true, database_writes_allowed: true, transaction_required: true, same_cycle_readback_required: true, credential_payload_reads_allowed: true };'
new_external_policy = 'if (effect === "external_execute") return { read_only: false, provider_calls_allowed: true, external_writes_allowed: true, database_writes_allowed: true, transaction_required: false, same_cycle_readback_required: true, credential_payload_reads_allowed: true };'
if old_external_policy in source:
    source = source.replace(old_external_policy, new_external_policy, 1)
elif new_external_policy not in source:
    raise SystemExit("closure_generator_external_policy_marker_missing")

old_evidence = '''function evidenceFor(toolKey, family) {
  if (!DATABASE_MUTATIONS.has(toolKey)) return [];
  if (toolKey.startsWith("tenant_agent_surface_")) return [{ role: "application_service", file: "agentSurfaceRuntimeService.js", markers: [`MUTATION_TRANSACTION: ${toolKey}`, `MUTATION_READBACK: ${toolKey}`] }];
  return [{ role: "mutation_handler", file: family.route_file, markers: [`MUTATION_TRANSACTION: ${toolKey}`, `MUTATION_READBACK: ${toolKey}`] }];
}'''
new_evidence = '''function evidenceFor(toolKey, family) {
  if (DATABASE_MUTATIONS.has(toolKey)) {
    if (toolKey.startsWith("tenant_agent_surface_")) return [{ role: "application_service", file: "agentSurfaceRuntimeService.js", markers: [`MUTATION_TRANSACTION: ${toolKey}`, `MUTATION_READBACK: ${toolKey}`] }];
    return [{ role: "mutation_handler", file: family.route_file, markers: [`MUTATION_TRANSACTION: ${toolKey}`, `MUTATION_READBACK: ${toolKey}`] }];
  }
  const providerMarkers = {
    tenant_database_query_readonly: ["executeReadonlyDatabaseQuery(", 'source: "tenant_database_query_readonly"', "read_only: true"],
    tenant_database_schema_read: ["readRemoteDatabaseSchema(", 'source: "information_schema"', "SET SESSION TRANSACTION READ ONLY"],
    tenant_ssh_probe: ["probeSshTcpBanner(", "ssh_banner_detected", "command_executed: false"],
  };
  if (providerMarkers[toolKey]) return [{ role: "provider_read_handler", file: family.route_file, markers: providerMarkers[toolKey] }];
  if (EXTERNAL_EXECUTES.has(toolKey)) return [{
    role: "external_execute_handler",
    file: family.route_file,
    markers: ["assertApprovedSshCliExecution(", "executionFacade.submitJob(", "executeApprovedSshCli(", "approval_request_id", "idempotency_key"],
  }];
  return [];
}'''
if old_evidence in source:
    source = source.replace(old_evidence, new_evidence, 1)
elif new_evidence not in source:
    raise SystemExit("closure_generator_evidence_function_marker_missing")

old_registration_collection = '''const registrations = [];
for (const item of sourceItems) {
  const relativeMigration = `migrations/${item.migration_file}`;
  const migrationPath = path.join(ROOT, relativeMigration);
  if (!fs.existsSync(migrationPath)) throw new Error(`surface_migration_missing:${relativeMigration}`);
  const extracted = extractRegistryToolRegistrations(fs.readFileSync(migrationPath, "utf8"));
  if (!extracted.length) throw new Error(`surface_registration_missing:${relativeMigration}`);
  for (const registration of extracted) {
    if (!registration.http_method || !registration.http_path) throw new Error(`surface_registration_incomplete:${relativeMigration}:${registration.tool_key}`);
    registrations.push({ ...registration, migration_file: relativeMigration });
  }
}'''
new_registration_collection = '''const registrations = [];
for (const item of sourceItems) {
  const relativeMigration = `migrations/${item.migration_file}`;
  const migrationPath = path.join(ROOT, relativeMigration);
  if (!fs.existsSync(migrationPath)) throw new Error(`surface_migration_missing:${relativeMigration}`);
  const expectedToolKeys = unique((item.remediation || [])
    .filter((action) => action.action_key === "verify_tool_registry_binding")
    .flatMap((action) => Array.isArray(action.targets) ? action.targets : []));
  if (!expectedToolKeys.length) throw new Error(`surface_queue_tool_targets_missing:${relativeMigration}`);
  const extracted = extractRegistryToolRegistrations(fs.readFileSync(migrationPath, "utf8"));
  if (!extracted.length) throw new Error(`surface_registration_missing:${relativeMigration}`);
  const registrationsByToolKey = new Map();
  for (const registration of extracted) {
    const matches = registrationsByToolKey.get(registration.tool_key) || [];
    matches.push(registration);
    registrationsByToolKey.set(registration.tool_key, matches);
  }
  for (const toolKey of expectedToolKeys) {
    const matches = registrationsByToolKey.get(toolKey) || [];
    if (matches.length !== 1) throw new Error(`surface_registration_expected_once:${relativeMigration}:${toolKey}:${matches.length}`);
    const registration = matches[0];
    if (!registration.http_method || !registration.http_path) throw new Error(`surface_registration_incomplete:${relativeMigration}:${registration.tool_key}`);
    registrations.push({ ...registration, migration_file: relativeMigration });
  }
}'''
if old_registration_collection in source:
    source = source.replace(old_registration_collection, new_registration_collection, 1)
elif new_registration_collection not in source:
    raise SystemExit("closure_generator_registration_collection_marker_missing")

PATH.write_text(source, encoding="utf-8")
print("closure generator effect, evidence, and queue-bound selection policy patch applied")
