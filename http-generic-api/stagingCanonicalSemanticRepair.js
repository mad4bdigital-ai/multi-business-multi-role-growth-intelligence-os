import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesCanonicalPlatformAdminWorkspace } from "./src/infrastructure/authorityScope/platformAdminWorkspaceResolver.js";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";

const apiRoot=path.dirname(fileURLToPath(import.meta.url));
const contractPath=path.join(apiRoot,"config","runtime-data-lifecycle-contract.json");
const registryPath=path.join(apiRoot,"config","canonical-semantic-artifacts.json");
const migrationManifestPath=path.join(apiRoot,"config","staging-database-role-migration-manifest.json");
const contractBytes=fs.readFileSync(contractPath);
const registryBytes=fs.readFileSync(registryPath);
const migrationManifestBytes=fs.readFileSync(migrationManifestPath);
const lifecycleContract=JSON.parse(contractBytes.toString("utf8"));
const artifactRegistry=JSON.parse(registryBytes.toString("utf8"));
const migrationManifest=JSON.parse(migrationManifestBytes.toString("utf8"));
const canonicalRow=lifecycleContract.datasets.workspace_registry.canonical_rows[0];
const semanticArtifact=artifactRegistry.artifacts.find((entry)=>entry.artifact_key===canonicalRow.artifact_key);
if(!semanticArtifact) throw new Error("Platform Admin canonical semantic artifact is not registered.");
const seedPath=path.join(apiRoot,semanticArtifact.source_file);
const seedBytes=fs.readFileSync(seedPath);
const seedStatements=splitStatements(seedBytes.toString("utf8"));

const SHA=/^[a-f0-9]{40}$/u;
const REPOSITORY="mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const PLAN_KEYS=Object.freeze([
  "contract","plan_schema_version","expected_repository","expected_commit","target_environment","target_role",
  "lifecycle_contract_sha256","semantic_artifact_registry_sha256","staging_migration_manifest_sha256","artifact",
  "precondition_fingerprint","semantic_fingerprint_before","exact_identity_count","resolver_candidate_count","conflict_count",
  "precondition_status","repair_allowed","same_cycle_readback_required","acknowledgement_is_execution_authority",
  "execution_authority","production_access_forbidden","provider_access_forbidden","caller_sql_forbidden","caller_target_forbidden"
]);
const IDENTITY=Object.freeze({
  workspace_id:canonicalRow.selector_tokens[0],
  tenant_id:canonicalRow.resolver_cardinality.tenant_id,
  workspace_key:canonicalRow.mutation_selector.update_where_equals.workspace_key,
  display_name:canonicalRow.mutation_selector.update_where_equals.display_name,
  workspace_type:canonicalRow.mutation_selector.update_where_equals.workspace_type,
  bootstrap_status:canonicalRow.mutation_selector.update_where_equals.bootstrap_status,
  authority_scope_key:canonicalRow.resolver_cardinality.authority_scope_key,
  platform_admin_workspace:canonicalRow.resolver_cardinality.platform_admin_workspace
});

function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));return value;}
function fingerprint(value){return sha256(JSON.stringify(stable(value)));}
function clean(value){return String(value??"").trim();}
function parseConfigState(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)) return {valid:true,value};
  try{const parsed=JSON.parse(String(value||"{}"));return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?{valid:true,value:parsed}:{valid:false,value:{}};}
  catch{return {valid:false,value:{}};}
}
function exactIdentity(row){return clean(row?.workspace_id)===IDENTITY.workspace_id&&clean(row?.tenant_id)===IDENTITY.tenant_id&&clean(row?.workspace_key)===IDENTITY.workspace_key;}
function exactCanonicalReady(row){
  const config=parseConfigState(row?.config_json);
  return config.valid&&exactIdentity(row)&&clean(row?.display_name)===IDENTITY.display_name&&clean(row?.workspace_type)===IDENTITY.workspace_type
    &&clean(row?.bootstrap_status)===IDENTITY.bootstrap_status&&clean(config.value.authority_scope_key)===IDENTITY.authority_scope_key
    &&(config.value.platform_admin_workspace===true||config.value.platform_admin_workspace===1);
}
function publicCandidate(row){
  const config=parseConfigState(row?.config_json);
  return {workspace_id:clean(row?.workspace_id)||null,tenant_id:clean(row?.tenant_id)||null,workspace_key:clean(row?.workspace_key)||null,
    bootstrap_status:clean(row?.bootstrap_status)||null,authority_scope_key:config.valid?clean(config.value.authority_scope_key)||null:null,
    platform_admin_workspace:config.valid?(config.value.platform_admin_workspace===true||config.value.platform_admin_workspace===1):null,config_valid:config.valid};
}
function semanticProjection(rowsValue){return rowsValue.map(publicCandidate).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
async function rows(executor,sql,params=[]){const result=await executor.query(sql,params);const value=Array.isArray(result)&&Array.isArray(result[0])?result[0]:result;return Array.isArray(value)?value:[];}

function artifactIntegrity(){
  const actualSha=sha256(seedBytes);const actualStatements=seedStatements.length;const expectedSource=`migrations/${canonicalRow.seed_file}`;
  const manifestSeeds=migrationManifest?.canonical_seed_lifecycle?.seed_files||[];const failures=[];
  if(semanticArtifact.source_file!==expectedSource)failures.push("source_file");
  if(semanticArtifact.sha256!==actualSha)failures.push("sha256");
  if(Number(semanticArtifact.statement_count)!==actualStatements)failures.push("statement_count");
  if(semanticArtifact.target_role!=="runtime")failures.push("target_role");
  if(semanticArtifact.lifecycle_class!=="canonical_registry")failures.push("lifecycle_class");
  if(!semanticArtifact.replay_modes?.includes("in_place_semantic_repair"))failures.push("in_place_semantic_repair");
  if(!manifestSeeds.includes(canonicalRow.seed_file))failures.push("staging_manifest_registration");
  if(failures.length>0){const error=new Error("Canonical semantic artifact integrity mismatch.");error.code="STAGING_CANONICAL_REPAIR_ARTIFACT_INTEGRITY_MISMATCH";error.details={failures};throw error;}
  return Object.freeze({artifact_key:semanticArtifact.artifact_key,file:`http-generic-api/${semanticArtifact.source_file}`,sha256:actualSha,statement_count:actualStatements,
    target_role:semanticArtifact.target_role,lifecycle_class:semanticArtifact.lifecycle_class,replay_modes:[...semanticArtifact.replay_modes],
    identity_contract:semanticArtifact.identity_contract,readback_contract:semanticArtifact.readback_contract,conflict_policy:semanticArtifact.conflict_policy});
}
const VERIFIED_ARTIFACT=artifactIntegrity();

export async function inspectStagingCanonicalSemanticRepair({executor}={}){
  if(!executor||typeof executor.query!=="function")throw new TypeError("A query-capable Runtime DB executor is required.");
  const tableRows=await rows(executor,"SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='workspace_registry'");
  const tableExists=Number(tableRows[0]?.count||0)===1;
  if(!tableExists){const evidence={source_role:"runtime",table_exists:false,row_count:0,relevant_row_count:0,exact_identity_count:0,resolver_candidate_count:0,ready_candidate_count:0,canonical_ready_count:0,conflict_count:0,malformed_config_count:0,candidate_ids:[]};
    return {status:"workspace_registry_missing",repair_allowed:false,evidence,semantic_fingerprint:fingerprint([]),precondition_fingerprint:fingerprint(evidence)};}
  const countRows=await rows(executor,"SELECT COUNT(*) AS count FROM workspace_registry");const totalRowCount=Number(countRows[0]?.count||0);
  const allRows=await rows(executor,`SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, config_json
       FROM workspace_registry
      WHERE workspace_id=?
         OR (tenant_id=? AND (workspace_key IN (?, ?) OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.authority_scope_key'))=? OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.platform_admin_workspace'))='true'))
      ORDER BY workspace_id`,
    [IDENTITY.workspace_id,IDENTITY.tenant_id,IDENTITY.workspace_key,canonicalRow.resolver_cardinality.workspace_key,IDENTITY.authority_scope_key]);
  const exactRows=allRows.filter(exactIdentity);
  const validRows=allRows.filter((row)=>parseConfigState(row?.config_json).valid);
  const resolverCandidates=validRows.filter(matchesCanonicalPlatformAdminWorkspace);
  const readyCandidates=resolverCandidates.filter((row)=>clean(row.bootstrap_status)==="ready");
  const canonicalReady=exactRows.filter(exactCanonicalReady);
  const malformedRows=allRows.filter((row)=>!parseConfigState(row?.config_json).valid);
  const conflictRows=allRows.filter((row)=>!exactIdentity(row)||!parseConfigState(row?.config_json).valid);
  let status="missing";
  if(malformedRows.length>0)status="malformed_config_json";
  else if(exactRows.length>1||readyCandidates.length>1)status="ambiguous";
  else if(conflictRows.length>0)status="identity_conflict";
  else if(exactRows.length===1&&canonicalReady.length===0)status="not_ready";
  else if(canonicalReady.length===1&&readyCandidates.length===1)status="resolved";
  const projection=semanticProjection(allRows);
  const evidence={source_role:"runtime",table_exists:true,row_count:totalRowCount,relevant_row_count:allRows.length,exact_identity_count:exactRows.length,
    resolver_candidate_count:resolverCandidates.length,ready_candidate_count:readyCandidates.length,canonical_ready_count:canonicalReady.length,conflict_count:conflictRows.length,
    malformed_config_count:malformedRows.length,candidate_ids:projection};
  return {status,repair_allowed:status==="missing"&&exactRows.length===0&&resolverCandidates.length===0&&conflictRows.length===0,evidence,
    semantic_fingerprint:fingerprint(projection),precondition_fingerprint:fingerprint(evidence)};
}

function planBody(plan){return Object.fromEntries(PLAN_KEYS.map((key)=>[key,plan[key]]));}
function validatePlanBindings(plan,actualCommit){
  const actual=clean(actualCommit).toLowerCase();
  if(!plan||plan.contract!=="mad4b.staging.canonical-semantic-repair-plan.v2"){const error=new Error("Canonical semantic repair plan contract is invalid.");error.code="STAGING_CANONICAL_REPAIR_PLAN_INVALID";throw error;}
  if(!SHA.test(actual)||actual!==plan.expected_commit){const error=new Error("Canonical semantic repair plan is stale for the checked-out commit.");error.code="STAGING_CANONICAL_REPAIR_STALE_PLAN";throw error;}
  if(fingerprint(planBody(plan))!==plan.plan_sha256){const error=new Error("Canonical semantic repair plan identity is invalid.");error.code="STAGING_CANONICAL_REPAIR_PLAN_HASH_MISMATCH";throw error;}
  if(plan.lifecycle_contract_sha256!==sha256(contractBytes)||plan.semantic_artifact_registry_sha256!==sha256(registryBytes)||plan.staging_migration_manifest_sha256!==sha256(migrationManifestBytes)
    ||plan.artifact?.sha256!==VERIFIED_ARTIFACT.sha256||Number(plan.artifact?.statement_count)!==VERIFIED_ARTIFACT.statement_count||plan.artifact?.artifact_key!==VERIFIED_ARTIFACT.artifact_key){
    const error=new Error("Canonical semantic repair source authority changed after planning.");error.code="STAGING_CANONICAL_REPAIR_SOURCE_AUTHORITY_CHANGED";throw error;}
}

export async function planStagingCanonicalSemanticRepair({executor,expected_commit,actual_commit}={}){
  const expectedCommit=clean(expected_commit).toLowerCase();const actualCommit=clean(actual_commit).toLowerCase();
  if(!SHA.test(expectedCommit)||expectedCommit!==actualCommit){const error=new Error("Canonical semantic repair requires the exact checked-out commit.");error.code="STAGING_CANONICAL_REPAIR_COMMIT_MISMATCH";throw error;}
  const inspection=await inspectStagingCanonicalSemanticRepair({executor});
  const body={contract:"mad4b.staging.canonical-semantic-repair-plan.v2",plan_schema_version:2,expected_repository:REPOSITORY,expected_commit:expectedCommit,target_environment:"staging",target_role:"runtime",
    lifecycle_contract_sha256:sha256(contractBytes),semantic_artifact_registry_sha256:sha256(registryBytes),staging_migration_manifest_sha256:sha256(migrationManifestBytes),artifact:VERIFIED_ARTIFACT,
    precondition_fingerprint:inspection.precondition_fingerprint,semantic_fingerprint_before:inspection.semantic_fingerprint,exact_identity_count:inspection.evidence.exact_identity_count,
    resolver_candidate_count:inspection.evidence.ready_candidate_count,conflict_count:inspection.evidence.conflict_count,precondition_status:inspection.status,repair_allowed:inspection.repair_allowed,
    same_cycle_readback_required:true,acknowledgement_is_execution_authority:false,execution_authority:"repository_bound_runtime_repair_capability",
    production_access_forbidden:true,provider_access_forbidden:true,caller_sql_forbidden:true,caller_target_forbidden:true};
  const planSha=fingerprint(body);
  return {...body,plan_sha256:planSha,required_confirmation:`REPAIR_STAGING_CANONICAL_DATA_${planSha.slice(0,12).toUpperCase()}`,inspection};
}

export async function applyStagingCanonicalSemanticRepair({executor,plan,confirmation,actual_commit,apply_artifact}={}){
  validatePlanBindings(plan,actual_commit);
  if(!plan.repair_allowed||clean(confirmation)!==plan.required_confirmation){const error=new Error("Canonical semantic repair plan is not authorized for apply.");error.code="STAGING_CANONICAL_REPAIR_CONFIRMATION_REQUIRED";throw error;}
  if(typeof apply_artifact!=="function")throw new TypeError("A repository-owned canonical artifact executor is required.");
  const current=await inspectStagingCanonicalSemanticRepair({executor});
  if(current.precondition_fingerprint!==plan.precondition_fingerprint||current.semantic_fingerprint!==plan.semantic_fingerprint_before||current.status!=="missing"){
    const error=new Error("Canonical semantic repair preconditions changed after planning.");error.code="STAGING_CANONICAL_REPAIR_PRECONDITION_CHANGED";throw error;}
  try{await apply_artifact(Object.freeze({...plan.artifact,plan_sha256:plan.plan_sha256}));}
  catch{const error=new Error("Canonical semantic repair mutation outcome is unknown; reconciliation readback is required before any retry.");error.code="STAGING_CANONICAL_REPAIR_RECONCILIATION_REQUIRED";
    error.details={status:"unknown_outcome",plan_sha256:plan.plan_sha256,mutation_retry_allowed:false};throw error;}
  const readback=await inspectStagingCanonicalSemanticRepair({executor});
  if(readback.status!=="resolved"||readback.evidence.canonical_ready_count!==1||readback.evidence.ready_candidate_count!==1){
    const error=new Error("Canonical semantic repair outcome requires reconciliation.");error.code="STAGING_CANONICAL_REPAIR_RECONCILIATION_REQUIRED";
    error.details={status:readback.status,plan_sha256:plan.plan_sha256,precondition_fingerprint:plan.precondition_fingerprint,postcondition_fingerprint:readback.precondition_fingerprint,mutation_retry_allowed:false};throw error;}
  return {contract:"mad4b.staging.canonical-semantic-repair-result.v2",status:"repaired",plan_sha256:plan.plan_sha256,artifact_sha256:plan.artifact.sha256,
    semantic_artifact_registry_sha256:plan.semantic_artifact_registry_sha256,precondition_fingerprint:plan.precondition_fingerprint,postcondition_fingerprint:readback.precondition_fingerprint,
    semantic_fingerprint_before:plan.semantic_fingerprint_before,semantic_fingerprint_after:readback.semantic_fingerprint,exact_row_count:readback.evidence.canonical_ready_count,
    resolver_candidate_count:readback.evidence.ready_candidate_count,mutation_performed:true,readback_verified:true,provider_mutation_performed:false,production_mutation_performed:false,secrets_included:false};
}

export async function reconcileStagingCanonicalSemanticRepair({executor,plan,actual_commit}={}){
  validatePlanBindings(plan,actual_commit);const readback=await inspectStagingCanonicalSemanticRepair({executor});
  const satisfied=readback.status==="resolved"&&readback.evidence.canonical_ready_count===1&&readback.evidence.ready_candidate_count===1;
  return {contract:"mad4b.staging.canonical-semantic-repair-reconciliation.v1",status:satisfied?"already_satisfied":"reconciliation_required",plan_sha256:plan.plan_sha256,
    mutation_performed:false,mutation_retry_allowed:false,readback_verified:satisfied,semantic_fingerprint:readback.semantic_fingerprint,postcondition_fingerprint:readback.precondition_fingerprint,
    exact_row_count:readback.evidence.canonical_ready_count,resolver_candidate_count:readback.evidence.ready_candidate_count,provider_mutation_performed:false,production_mutation_performed:false,secrets_included:false};
}

export const STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT=Object.freeze({identity:IDENTITY,artifact:VERIFIED_ARTIFACT,seed_file:canonicalRow.seed_file,seed_sha256:VERIFIED_ARTIFACT.sha256,
  statement_count:VERIFIED_ARTIFACT.statement_count,lifecycle_contract_sha256:sha256(contractBytes),semantic_artifact_registry_sha256:sha256(registryBytes),
  staging_migration_manifest_sha256:sha256(migrationManifestBytes)});
