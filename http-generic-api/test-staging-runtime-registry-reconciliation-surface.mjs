import assert from "node:assert/strict";
import fs from "node:fs";
import { STAGING_ROLE_GRANT_POLICIES } from "./databasePrivilegeContracts.js";

const read=(file)=>fs.readFileSync(new URL("../"+file,import.meta.url),"utf8");
const repair=read("autopilot-portable-staging/Repair-StagingRuntimeRegistry.ps1");
const materializer=fs.readFileSync(new URL("./scripts/staging-runtime-registry-reconciliation-materialize-sql.mjs",import.meta.url),"utf8");
const runtimeCheck=fs.readFileSync(new URL("./scripts/staging-runtime-registry-reconciliation-runtime-check.mjs",import.meta.url),"utf8");
const config=JSON.parse(fs.readFileSync(new URL("./config/staging-runtime-registry-reconciliation.json",import.meta.url),"utf8"));
const stagingOverlay=JSON.parse(fs.readFileSync(new URL("./config/host-breakglass-staging-contract.json",import.meta.url),"utf8"));

assert.equal(config.contract,"mad4b.staging-runtime-registry-reconciliation.v1");
assert.equal(config.target_environment,"staging");
assert.equal(config.target_role,"runtime");
assert.equal(config.insertion_only,true);
assert.equal(config.updates_allowed,false);
assert.equal(config.deletes_allowed,false);
assert.equal(config.caller_sql_forbidden,true);
assert.equal(config.caller_target_forbidden,true);
assert.equal(config.production_access_forbidden,true);
assert.equal(config.provider_access_forbidden,true);
assert.deepEqual(config.tables.map((entry)=>entry.table),[
  "actions","endpoints","admin_platform_endpoint_tools","tenant_platform_endpoint_tools","platform_endpoint_tool_exports"
]);
assert.deepEqual(config.schema_prerequisites.map((entry)=>entry.file),[
  "20260902_staging_actions_runtime_contract_reconciliation.sql",
  "20260815_custom_gpt_mcp_catalog_levels.sql"
]);

const declared=new Map(stagingOverlay.readiness_remediation.schema_repair_migrations.map((entry)=>[entry.file,entry]));
for(const prerequisite of config.schema_prerequisites){
  const entry=declared.get(prerequisite.file);
  assert.ok(entry,prerequisite.file+" must be registered in Staging schema repair authority");
  assert.equal(entry.sha256,prerequisite.sha256);
  assert.equal(entry.statement_count,prerequisite.statement_count);
  assert.equal(entry.role,"runtime");
  assert.equal(entry.allowed_modes.includes("apply_migration"),true);
}
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.admin_platform_endpoint_tools,["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.tenant_platform_endpoint_tools,["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.endpoints,["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.platform_endpoint_tool_exports,["SELECT"]);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("endpoints"),true);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("platform_endpoint_tool_exports"),true);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("actions"),true);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations,["SELECT","INSERT","UPDATE"]);

assert.match(repair,/ValidateSet\("Plan","Apply","Reconcile"\)/u);
assert.match(repair,/origin\/main\)\.Trim\(\)\.ToLowerInvariant\(\) -eq \$ExpectedCommit/u);
assert.match(repair,/runtime\.registry-reconciliation\.sql\.gz/u);
assert.match(repair,/staging-schema-bundle-manifest\.json/u);
assert.match(repair,/exclusive host lock/u);
assert.match(repair,/MYSQL_PWD="\$MARIADB_ROOT_PASSWORD"/u);
assert.doesNotMatch(repair,/Read-Env[^\r\n]*RUNTIME_DB_ROOT_PASSWORD/u);
assert.match(repair,/caller_sql_forbidden/u);
assert.match(repair,/caller_target_forbidden/u);
assert.match(repair,/status="access_prerequisites_required"/u);
assert.match(repair,/runbook_key="database\.access_repair"/u);
assert.match(repair,/apply_action="apply_grants"/u);
assert.equal((repair.match(/runbook_key="database\.schema_repair"/gu)||[]).length,2);
assert.equal((repair.match(/apply_action="apply_migration"/gu)||[]).length,2);
assert.match(repair,/production_mutation_performed=\$false/u);
assert.match(repair,/provider_mutation_performed=\$false/u);
assert.match(repair,/mutation_retry_allowed=\$false/u);
assert.match(repair,/unknown_outcome/u);
assert.match(repair,/same_cycle_readback_failed_after_transport_success/u);
assert.match(repair,/success_receipt_persistence_failed/u);
assert.match(repair,/Mode -eq "Reconcile"/u);

assert.match(materializer,/SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE/u);
assert.match(materializer,/START TRANSACTION/u);
assert.match(materializer,/COMMIT/u);
assert.match(materializer,/resolveRegistryPlanStatements/u);
assert.match(materializer,/UPDATE\|DELETE\|REPLACE\|TRUNCATE\|DROP\|ALTER\|CREATE\|GRANT\|REVOKE/u);
assert.doesNotMatch(materializer,/DB_PASSWORD|RUNTIME_DB_ROOT_PASSWORD|HOSTINGER/u);

assert.match(runtimeCheck,/deployment-manifest\.json/u);
assert.match(runtimeCheck,/DEPLOYMENT_ENVIRONMENT/u);
assert.match(runtimeCheck,/staging_local_windows_docker/u);
assert.match(runtimeCheck,/reconcile-readback/u);
assert.doesNotMatch(runtimeCheck,/production_hostinger_autodeploy|HOSTINGER/u);

console.log("Staging runtime registry reconciliation surface guards passed");
