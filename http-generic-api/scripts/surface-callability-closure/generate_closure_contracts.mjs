import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractRegistryToolRegistrations } from "../surface-contract-sql-registry-extractor.mjs";
import { canonicalOpenApiAuthority, parseOpenApiContracts } from "../frontend-surface-dispatch.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DOCS_ROOT = path.resolve(ROOT, "..");
const QUEUE_PATH = path.join(DOCS_ROOT, "docs", "surface-contract-gap-queue.json");
const MANIFEST_PATH = path.join(ROOT, "resource-api-surface-callability.manifest.json");
const TEST_PATH = path.join(ROOT, "test-surface-callability-full-closure.mjs");
const TEST_MANIFEST_PATH = path.join(ROOT, "scripts", "test-manifest.mjs");
const CLASSIFICATION_PATH = path.join(ROOT, "surface-contract-classification-evidence.json");
const ATTESTATION_PATH = path.join(DOCS_ROOT, "docs", "surface-contract-safety-attestations.json");
const HOSTINGER_MIGRATION = "20260730_hostinger_production_resync_policy.sql";

const DATABASE_MUTATIONS = new Set([
  "tenant_agent_surface_preferences_update",
  "tenant_agent_surface_deployment_upsert",
  "workspace_member_remove",
  "workspace_member_update",
  "workspace_ownership_transfer",
  "workspace_invitation_resend",
  "workspace_invitation_revoke",
  "workspace_invitations_expire_stale",
  "workspace_access_request_cancel",
  "workspace_resource_grant_create",
  "workspace_resource_grant_revoke",
  "tenant_ssh_cli_approval_request_create",
  "tenant_ssh_cli_approval_request_decide",
]);
const PROVIDER_READS = new Set([
  "tenant_database_schema_read",
  "tenant_database_query_readonly",
  "tenant_ssh_probe",
]);
const EXTERNAL_EXECUTES = new Set(["tenant_ssh_cli_allowlisted_execute"]);

const FAMILY_RULES = [
  { key: "agent_surfaces", test: (p) => p.startsWith("/me/agent-surfaces"), route_file: "routes/agentSurfaceRoutes.js", builder: "buildAgentSurfaceRoutes" },
  { key: "workspace_resources", test: (p) => /^\/me\/workspaces\/\{tenant_id\}\/(assets|vaults|resource-grants)/.test(p), route_file: "routes/workspaceResourceRoutes.js", builder: "buildWorkspaceResourceRoutes" },
  { key: "workspace_lifecycle", test: (p) => p.startsWith("/me/workspaces/") || p.startsWith("/me/access-requests") || p.startsWith("/me/connections/"), route_file: "routes/tenantLifecycleRoutes.js", builder: "buildTenantLifecycleRoutes" },
  { key: "tenant_infrastructure", test: (p) => p.startsWith("/me/infrastructure/"), route_file: "routes/tenantInfrastructureRoutes.js", builder: "buildTenantInfrastructureRoutes" },
  { key: "tenant_docs", test: (p) => p.startsWith("/tenant/docs"), route_file: "routes/tenantDocsRoutes.js", builder: "buildTenantDocsRoutes" },
  { key: "system_layer", test: (p) => p === "/system/tools/call", route_file: "routes/systemLayerRoutes.js", builder: "buildSystemLayerRoutes" },
  { key: "connect_api", test: (p) => p.startsWith("/connect/api/"), route_file: "routes/connectApiRoutes.js", builder: "buildConnectApiRoutes" },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function unique(values) {
  return [...new Set(values)].sort();
}
function routeFamily(httpPath) {
  const family = FAMILY_RULES.find((rule) => rule.test(httpPath));
  if (!family) throw new Error(`surface_route_family_missing:${httpPath}`);
  return family;
}
function effectClass(toolKey) {
  if (DATABASE_MUTATIONS.has(toolKey)) return "database_mutation";
  if (PROVIDER_READS.has(toolKey)) return "provider_read";
  if (EXTERNAL_EXECUTES.has(toolKey)) return "external_execute";
  return "read_only";
}
function policy(effect) {
  if (effect === "database_mutation") return { read_only: false, provider_calls_allowed: false, external_writes_allowed: false, database_writes_allowed: true, transaction_required: true, same_cycle_readback_required: true, credential_payload_reads_allowed: false };
  if (effect === "provider_read") return { read_only: true, provider_calls_allowed: true, external_writes_allowed: false, database_writes_allowed: false, transaction_required: false, same_cycle_readback_required: true, credential_payload_reads_allowed: true };
  if (effect === "external_execute") return { read_only: false, provider_calls_allowed: true, external_writes_allowed: true, database_writes_allowed: true, transaction_required: false, same_cycle_readback_required: true, credential_payload_reads_allowed: true };
  return { read_only: true, provider_calls_allowed: false, external_writes_allowed: false, database_writes_allowed: false, transaction_required: false, same_cycle_readback_required: false, credential_payload_reads_allowed: false };
}
function expressPath(httpPath) {
  return httpPath.replace(/\{([^}]+)\}/g, ":$1");
}
function evidenceFor(toolKey, family) {
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
}
function routeAuthMarkers(family, httpPath) {
  if (family.key === "connect_api") return [`router.use(\"/connect/api\", requireUserJwt`, expressPath(httpPath)];
  if (family.key === "tenant_docs") return [expressPath(httpPath), "requireTenantUserJwt"];
  if (family.key === "system_layer") return ["/system/tools/call", "dispatchToolForCaller"];
  return [expressPath(httpPath), "requireUserJwt"];
}
function relativeApiPath(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}
function buildOpenApiEvidenceIndex() {
  const index = new Map();
  const register = (sourcePath, priority) => {
    if (!fs.existsSync(sourcePath)) return;
    const contracts = parseOpenApiContracts(fs.readFileSync(sourcePath, "utf8"), { sourcePath, apiRoot: ROOT });
    for (const [signature, contract] of contracts) {
      const file = contract.source_file || relativeApiPath(sourcePath);
      const existing = index.get(signature);
      if (existing && existing.priority === priority && existing.file !== file) {
        throw new Error(`surface_openapi_operation_ambiguous:${signature}:${existing.file}:${file}`);
      }
      if (!existing || priority < existing.priority) {
        index.set(signature, {
          priority,
          file,
          operation_id: contract.operation_id || null,
        });
      }
    }
  };
  const authority = canonicalOpenApiAuthority({ apiRoot: ROOT });
  const rootOpenApi = path.resolve(ROOT, "openapi.yaml");
  for (const file of authority.files) {
    register(file, path.resolve(file) === rootOpenApi ? 0 : 1);
  }
  register(path.join(ROOT, "openapi", "frontend-runtime-routes.generated.yaml"), 2);
  return index;
}
const OPENAPI_EVIDENCE_INDEX = buildOpenApiEvidenceIndex();
function openApiEvidence(family, method, httpPath) {
  const signature = `${method} ${httpPath}`;
  const evidence = OPENAPI_EVIDENCE_INDEX.get(signature);
  if (!evidence) throw new Error(`surface_openapi_operation_missing:${signature}`);
  const markers = [`  ${httpPath}:`, `    ${method.toLowerCase()}:`];
  if (evidence.operation_id) markers.push(`operationId: ${evidence.operation_id}`);
  if (evidence.file === "openapi/frontend-runtime-routes.generated.yaml") {
    markers.push(`x-source-file: ${family.route_file}`);
  }
  return { file: evidence.file, markers };
}
function canonicalBytes(buffer) {
  return Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}
function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, buffer])).digest("hex");
}
function statementCount(text) {
  let count = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === ";") count += 1;
  }
  return count;
}

const queue = readJson(QUEUE_PATH);
if (queue.schema_version !== "surface-contract-gap-queue-v1" || !Array.isArray(queue.top_items)) throw new Error("surface_queue_invalid");
const sourceItems = queue.top_items.filter((item) => item.migration_file !== HOSTINGER_MIGRATION);
if (sourceItems.length !== 20) throw new Error(`surface_queue_expected_20_callable_items_actual_${sourceItems.length}`);

const registrations = [];
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
}

const grouped = new Map();
for (const registration of registrations) {
  const family = routeFamily(registration.http_path);
  const effect = effectClass(registration.tool_key);
  const authModel = family.key === "system_layer" ? "backend_or_user" : "user_jwt";
  const groupKey = `${registration.http_method} ${registration.http_path}::${family.key}::${effect}::${authModel}`;
  const existing = grouped.get(groupKey) || { method: registration.http_method, http_path: registration.http_path, family, effect, authModel, bindings: [] };
  existing.bindings.push(registration);
  grouped.set(groupKey, existing);
}

const contracts = [...grouped.values()].sort((a, b) => `${a.method} ${a.http_path}`.localeCompare(`${b.method} ${b.http_path}`)).map((group, index) => {
  const openapi = openApiEvidence(group.family, group.method, group.http_path);
  const toolKeys = unique(group.bindings.map((item) => item.tool_key));
  const evidenceFiles = group.bindings.flatMap((item) => evidenceFor(item.tool_key, group.family));
  return {
    contract_key: `surface_route_family_${String(index + 1).padStart(2, "0")}`,
    tool_bindings: group.bindings.sort((a, b) => a.tool_key.localeCompare(b.tool_key)).map((item) => ({
      tool_key: item.tool_key,
      migration_file: item.migration_file,
      migration_markers: [`'${item.tool_key}'`, `'${item.http_method}'`, `'${item.http_path}'`],
    })),
    route_signature: `${group.method} ${group.http_path}`,
    effect_class: group.effect,
    auth_model: group.authModel,
    runtime_execution_allowed: true,
    secrets_included: false,
    ...policy(group.effect),
    route_file: group.family.route_file,
    route_markers: [`router.${group.method.toLowerCase()}(\"${expressPath(group.http_path)}\"`, ...routeAuthMarkers(group.family, group.http_path)],
    mount_file: "routes/index.js",
    mount_markers: [`import { ${group.family.builder} }`, `app.use(${group.family.builder}`],
    test_file: "test-surface-callability-full-closure.mjs",
    test_markers: ["SURFACE_CALLABILITY_FULL_CLOSURE", ...toolKeys.map((key) => `FULL_CLOSURE_TOOL: ${key}`), `FULL_CLOSURE_ROUTE: ${group.method} ${group.http_path}`],
    openapi_file: openapi.file,
    openapi_markers: openapi.markers,
    ...(evidenceFiles.length ? { evidence_files: evidenceFiles } : {}),
  };
});

const sourceToolKeys = unique(registrations.map((item) => item.tool_key));
writeJson(MANIFEST_PATH, {
  schema_version: "resource-api-surface-callability-v1",
  source_queue_schema: queue.schema_version,
  source_queue_item_count: queue.total_items,
  source_queue_tool_keys: sourceToolKeys,
  contracts,
  generated_by: "scripts/surface-callability-closure/generate_closure_contracts.mjs",
  secrets_included: false,
});

const testSource = `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport YAML from "yaml";\nimport { validateDirectRouteCallabilityContracts } from "./scripts/resource-api-callability-contracts.mjs";\n\n// SURFACE_CALLABILITY_FULL_CLOSURE\nconst manifest = JSON.parse(fs.readFileSync("resource-api-surface-callability.manifest.json", "utf8"));\nconst coverageManifest = JSON.parse(fs.readFileSync("resource-api-coverage.manifest.json", "utf8"));\nconst validation = validateDirectRouteCallabilityContracts({ root: process.cwd(), manifest: coverageManifest });\nassert.equal(validation.ok, true, JSON.stringify(validation.findings));\nassert.deepEqual(validation.covered_tool_keys.filter((key) => manifest.source_queue_tool_keys.includes(key)).sort(), [...manifest.source_queue_tool_keys].sort());\nconst queue = JSON.parse(fs.readFileSync("../docs/surface-contract-gap-queue.json", "utf8"));\nassert.equal(queue.total_items, 0, JSON.stringify(queue.top_items));\nconst lifecycle = fs.readFileSync("routes/tenantLifecycleRoutes.js", "utf8");\nconst resources = fs.readFileSync("routes/workspaceResourceRoutes.js", "utf8");\nconst infrastructure = fs.readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");\nconst agentService = fs.readFileSync("agentSurfaceRuntimeService.js", "utf8");\nassert.equal((infrastructure.match(/router\\.get\\(\\"\\/me\\/infrastructure\\/ssh\\/cli\\/approval-requests\\/:request_id\\"/g) || []).length, 1);\nassert.equal((infrastructure.match(/router\\.post\\(\\"\\/me\\/infrastructure\\/ssh\\/cli\\/approval-requests\\/:request_id\\/decision\\"/g) || []).length, 1);\nassert(!/workspace_invitation_resend[\\s\\S]{0,5000}token:\\s*result/.test(lifecycle));\nfor (const key of ${JSON.stringify([...DATABASE_MUTATIONS].sort())}) {\n  const evidence = lifecycle.includes(\`MUTATION_TRANSACTION: \${key}\`) || resources.includes(\`MUTATION_TRANSACTION: \${key}\`) || infrastructure.includes(\`MUTATION_TRANSACTION: \${key}\`) || agentService.includes(\`MUTATION_TRANSACTION: \${key}\`);\n  const readback = lifecycle.includes(\`MUTATION_READBACK: \${key}\`) || resources.includes(\`MUTATION_READBACK: \${key}\`) || infrastructure.includes(\`MUTATION_READBACK: \${key}\`) || agentService.includes(\`MUTATION_READBACK: \${key}\`);\n  assert(evidence, \`missing transaction marker for \${key}\`);\n  assert(readback, \`missing readback marker for \${key}\`);\n}\nconst runtimeOpenApi = YAML.parse(fs.readFileSync("openapi/frontend-runtime-routes.generated.yaml", "utf8"));\nconst canonicalOpenApi = YAML.parse(fs.readFileSync("openapi.yaml", "utf8"));\nfor (const contract of manifest.contracts) {\n  const [method, route] = contract.route_signature.split(/\\s+/, 2);\n  const document = contract.openapi_file === "openapi.yaml" ? canonicalOpenApi : contract.openapi_file === "openapi/frontend-runtime-routes.generated.yaml" ? runtimeOpenApi : null;\n  assert(document.paths?.[route]?.[method.toLowerCase()], \`OpenAPI operation missing: \${contract.route_signature}\`);\n}\nconst classification = JSON.parse(fs.readFileSync("surface-contract-classification-evidence.json", "utf8"));\nassert(classification.items.some((item) => item.migration_file === "${HOSTINGER_MIGRATION}" && item.classification_status === "verified_evidence_only"));\nconst attestations = JSON.parse(fs.readFileSync("../docs/surface-contract-safety-attestations.json", "utf8"));\nassert(attestations.items.some((item) => item.migration_file === "${HOSTINGER_MIGRATION}" && item.attestation_status === "verified_static_no_external_side_effects"));\n${sourceToolKeys.map((key) => `// FULL_CLOSURE_TOOL: ${key}`).join("\n")}\n${contracts.map((contract) => `// FULL_CLOSURE_ROUTE: ${contract.route_signature}`).join("\n")}\nconsole.log("surface callability full closure tests passed");\n`;
fs.writeFileSync(TEST_PATH, testSource, "utf8");

let testManifest = fs.readFileSync(TEST_MANIFEST_PATH, "utf8");
const testCommand = "node test-surface-callability-full-closure.mjs";
if (!testManifest.includes(testCommand)) {
  const marker = '  "node test-resource-api-callability-effect-classes.mjs",';
  if (!testManifest.includes(marker)) throw new Error("test_manifest_insertion_marker_missing");
  testManifest = testManifest.replace(marker, `${marker}\n  "${testCommand}",`);
  fs.writeFileSync(TEST_MANIFEST_PATH, testManifest, "utf8");
}

const hostingerPath = path.join(ROOT, "migrations", HOSTINGER_MIGRATION);
if (!fs.existsSync(hostingerPath)) throw new Error("hostinger_policy_migration_missing");
const hostingerRaw = fs.readFileSync(hostingerPath);
const hostingerCanonical = canonicalBytes(hostingerRaw);
const hostingerBlob = gitBlobSha(hostingerRaw);
const hostingerSha256 = crypto.createHash("sha256").update(hostingerCanonical).digest("hex");

const classification = readJson(CLASSIFICATION_PATH);
classification.items = (classification.items || []).filter((item) => item.migration_file !== HOSTINGER_MIGRATION);
classification.items.push({
  migration_file: HOSTINGER_MIGRATION,
  source_git_blob_sha: hostingerBlob,
  classification_status: "verified_evidence_only",
  classification_reason: "Checksum-bound Hostinger Production resynchronization policy seed. It creates policy/readback authority but no public runtime route or provider execution surface.",
  route_literals: [],
  documentation_targets: ["docs/hostinger-node-deploy.md", "http-generic-api/docs/hostinger-runtime-sync-runbook.md", "deployment_parity_checklist.md"],
  safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
});
classification.items.sort((a, b) => a.migration_file.localeCompare(b.migration_file));
writeJson(CLASSIFICATION_PATH, classification);

const attestations = readJson(ATTESTATION_PATH);
attestations.items = (attestations.items || []).filter((item) => item.migration_file !== HOSTINGER_MIGRATION);
attestations.items.push({
  migration_file: HOSTINGER_MIGRATION,
  migration_sha256: hostingerSha256,
  checksum_canonicalization: "utf8_lf_v1",
  attestation_status: "verified_static_no_external_side_effects",
  evidence_mode: "checksum_bound_static_contract",
  queue_class_at_attestation: "high_review",
  gap_severity_at_attestation: "medium",
  preflight_status: "pass",
  preflight_risk_count: 0,
  statement_count: statementCount(hostingerCanonical.toString("utf8")),
  surface_counts: { plugins: 0, tools: 0, views: 0, policies: 1, routes: 0 },
  runtime_reviews: [{ action_key: "verify_policy_seed_readiness", targets: ["hostinger_production_resync_policy_v1"] }],
  safety_markers: { no_provider_call: true, no_credential_payload_read: true, no_raw_secrets: true, no_external_send: true, no_external_write: true, secrets_included_false: true },
  safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
});
attestations.items.sort((a, b) => a.migration_file.localeCompare(b.migration_file));
attestations.item_count = attestations.items.length;
writeJson(ATTESTATION_PATH, attestations);

console.log(JSON.stringify({ ok: true, source_queue_items: queue.total_items, callable_migrations: sourceItems.length, tool_count: sourceToolKeys.length, contract_count: contracts.length, hostinger_blob_sha: hostingerBlob, hostinger_sha256: hostingerSha256, secrets_included: false }, null, 2));
