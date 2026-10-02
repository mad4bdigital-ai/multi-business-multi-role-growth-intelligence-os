import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  STAGING_RUNTIME_REGISTRY_RECONCILIATION_CONFIG,
  inspectStagingRuntimeRegistrySnapshot,
  parseStagingRuntimeRegistrySnapshot,
  planStagingRuntimeRegistryReconciliation
} from "./stagingRuntimeRegistrySnapshot.js";
import {
  applyStagingRuntimeRegistryReconciliation,
  reconcileStagingRuntimeRegistryReconciliation
} from "./stagingRuntimeRegistryReconciliation.js";

const SHA = "a".repeat(40);
const TICK = String.fromCharCode(96);
const tables = [
  "actions",
  "endpoints",
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
  "platform_endpoint_tool_exports"
];
const definitions = {
  actions: {
    identity: ["action_key"],
    columns: ["action_key","action_title","status","schema_json","oauth_last_validated_at"],
    row: { action_key:"canonical_action", action_title:"Canonical Action", status:"active", schema_json:'{"required":["a"],"type":"object"}', oauth_last_validated_at:"2026-10-02 01:02:03" }
  },
  endpoints: {
    identity: ["parent_action_key","endpoint_key"],
    columns: ["parent_action_key","endpoint_key","endpoint_title"],
    row: { parent_action_key:"canonical_action", endpoint_key:"canonical_endpoint", endpoint_title:"Canonical Endpoint" }
  },
  admin_platform_endpoint_tools: {
    identity: ["tool_key"],
    columns: ["tool_key","display_name","mcp_catalog_level"],
    row: { tool_key:"admin_tool", display_name:"Admin Tool", mcp_catalog_level:"core" }
  },
  tenant_platform_endpoint_tools: {
    identity: ["tool_key"],
    columns: ["tool_key","display_name","mcp_catalog_level"],
    row: { tool_key:"tenant_tool", display_name:"Tenant Tool", mcp_catalog_level:"core" }
  },
  platform_endpoint_tool_exports: {
    identity: ["export_key"],
    columns: ["export_key","parent_action_key","endpoint_key","tool_name"],
    row: { export_key:"export_1", parent_action_key:"canonical_action", endpoint_key:"canonical_endpoint", tool_name:"Admin Tool" }
  }
};
function sqlString(value) {
  if (value === null) return "NULL";
  return "'" + String(value).replaceAll("\\","\\\\").replaceAll("'","''") + "'";
}
function statementFor(table) {
  const def = definitions[table];
  return "INSERT INTO " + TICK + table + TICK + " (" + def.columns.map((column) => TICK + column + TICK).join(", ") + ") VALUES (" + def.columns.map((column) => sqlString(def.row[column])).join(", ") + ");";
}
function snapshotFixture() {
  const sql = Buffer.from(tables.map(statementFor).join("\n") + "\n","utf8");
  const gzip = zlib.gzipSync(sql,{level:9,mtime:0});
  const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const metadata = {
    contract:"mad4b.staging.runtime-registry-reconciliation-snapshot.v1",
    file:"runtime.registry-reconciliation.sql.gz",
    sha256:digest(gzip),
    uncompressed_sha256:digest(sql),
    compressed_bytes:gzip.length,
    statement_count:tables.length,
    table_count:tables.length,
    tables:[...tables],
    row_counts:Object.fromEntries(tables.map((table)=>[table,1])),
    projections:Object.fromEntries(tables.map((table)=>[table,{
      included_columns:[...definitions[table].columns],
      excluded_columns:[],
      column_types:Object.fromEntries(definitions[table].columns.map((column)=>[column,column.endsWith("_json")?"longtext":column==="oauth_last_validated_at"?"timestamp":"varchar"])),
      identity_columns:[...definitions[table].identity],
      order_index:"configured_identity"
    }])),
    source_kind:"disposable_git_migration_projection",
    target_role:"runtime",
    replay_mode:"in_place_insert_only",
    exact_source_commit:SHA,
    live_environment_data_copied:false,
    production_accessed:false,
    provider_accessed:false,
    secrets_included:false
  };
  return { gzip, metadata };
}
function cloneState(state) {
  return Object.fromEntries(Object.entries(state).map(([table,rows])=>[table,rows.map((row)=>({...row}))]));
}
function blankState() {
  return Object.fromEntries(tables.map((table)=>[table,[]]));
}
function schemaRows({ omit = null } = {}) {
  const required = {
    actions:["action_key","action_title","status","allowed_actor_roles","allowed_governance_levels","oauth_secret_storage_type","oauth_last_validated_at"],
    endpoints:["parent_action_key","endpoint_key","endpoint_title"],
    admin_platform_endpoint_tools:["tool_key","display_name","mcp_catalog_level"],
    tenant_platform_endpoint_tools:["tool_key","display_name","mcp_catalog_level"],
    platform_endpoint_tool_exports:["export_key","parent_action_key","endpoint_key","tool_name"]
  };
  const rows=[];
  for(const [table,columns] of Object.entries(required)) for(const column of columns) if(table+"."+column!==omit) rows.push({TABLE_NAME:table,COLUMN_NAME:column});
  return rows;
}
function executorFor(initial = blankState(), { omitSchema = null, failInsertAt = null, rollbackFails = false } = {}) {
  let state = cloneState(initial);
  let transactionBackup = null;
  let insertCount = 0;
  const queries = [];
  const statements = new Map(tables.map((table)=>[statementFor(table),{table,row:{...definitions[table].row}}]));
  return {
    queries,
    get state(){return state;},
    async query(sql,params=[]){
      const source=String(sql);
      queries.push({sql:source,params});
      if(source.includes("information_schema.COLUMNS")) return [schemaRows({omit:omitSchema})];
      const liveMatch=source.match(new RegExp("FROM\\\\s+"+TICK+"([A-Za-z0-9_]+)"+TICK,"iu"));
      if(/^SELECT\s/iu.test(source)&&liveMatch) return [state[liveMatch[1]].map((row)=>({...row}))];
      if(source==="START TRANSACTION"){transactionBackup=cloneState(state);return[{ok:1}];}
      if(source==="ROLLBACK"){
        if(rollbackFails) throw Object.assign(new Error("rollback transport lost"),{code:"ROLLBACK_LOST"});
        if(transactionBackup) state=cloneState(transactionBackup);
        transactionBackup=null;
        return[{ok:1}];
      }
      if(source==="COMMIT"){transactionBackup=null;return[{ok:1}];}
      if(/^INSERT\s+INTO\b/iu.test(source)){
        insertCount+=1;
        if(failInsertAt===insertCount) throw Object.assign(new Error("injected insert failure"),{code:"INJECTED_INSERT_FAILURE"});
        const fixture=statements.get(source);
        if(!fixture) throw new Error("Unexpected INSERT statement");
        state[fixture.table].push({...fixture.row});
        return[{affectedRows:1}];
      }
      throw new Error("Unexpected SQL: "+source.slice(0,160));
    }
  };
}
function ledgerFor() {
  const records=new Map();
  const transition=(plan,state,details={})=>records.set(plan,{...(records.get(plan)||{}),...details,state});
  return {
    records,
    async reserve(input){if(records.has(input.plan_sha256))throw Object.assign(new Error("consumed"),{code:"STAGING_REGISTRY_RECONCILIATION_PLAN_ALREADY_CONSUMED"});records.set(input.plan_sha256,{...input,state:"reserved"});},
    async markExecuting(plan,details){transition(plan,"executing",details);},
    async markSucceeded(plan,details){transition(plan,"succeeded",details);},
    async markUnknown(plan,details){transition(plan,"unknown_outcome",details);},
    async markKnownNotApplied(plan,details){transition(plan,"known_not_applied",details);},
    async markReconciledNoMutation(plan,details){transition(plan,"reconciled_no_mutation",details);},
    async read(plan){return records.get(plan)||null;}
  };
}
async function code(fn) {
  try{await fn();return null;}catch(error){return error?.code||"UNKNOWN";}
}
const {gzip,metadata}=snapshotFixture();

assert.deepEqual(STAGING_RUNTIME_REGISTRY_RECONCILIATION_CONFIG.schema_prerequisites.map((item)=>[item.file,item.sha256,item.statement_count]),[
  ["20260902_staging_actions_runtime_contract_reconciliation.sql","6ca8879ec300b5970f6ddc3d9eeded38eda8dee12abd6bdeb7ba7d2ffa53ee2c",1],
  ["20260815_custom_gpt_mcp_catalog_levels.sql","528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681",7]
]);
assert.equal(STAGING_RUNTIME_REGISTRY_RECONCILIATION_CONFIG.schema_prerequisites[0].purpose,"actions_schema_contract_only_not_row_population");
parseStagingRuntimeRegistrySnapshot({snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});

const missingExecutor=executorFor();
const missing=await inspectStagingRuntimeRegistrySnapshot({executor:missingExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(missing.status,"missing_rows");
assert.equal(missing.missing_count,5);
assert.equal(missing.conflict_count,0);
assert.equal(missing.repair_allowed,true);

const schemaBlocked=await inspectStagingRuntimeRegistrySnapshot({executor:executorFor(blankState(),{omitSchema:"actions.allowed_actor_roles"}),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(schemaBlocked.status,"schema_not_ready");
assert.equal(schemaBlocked.repair_allowed,false);
assert.deepEqual(schemaBlocked.schema.missing_columns,["actions.allowed_actor_roles"]);

const plan=await planStagingRuntimeRegistryReconciliation({executor:missingExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
assert.equal(plan.status_before,"missing_rows");
assert.equal(plan.repair_allowed,true);
assert.equal(plan.missing_statement_sha256.length,5);
assert.equal("sql" in plan,false);
assert.equal("target" in plan,false);
assert.equal(plan.caller_sql_forbidden,true);
assert.equal(plan.caller_target_forbidden,true);

const applyExecutor=executorFor();
const applyPlan=await planStagingRuntimeRegistryReconciliation({executor:applyExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const applyLedger=ledgerFor();
const applied=await applyStagingRuntimeRegistryReconciliation({executor:applyExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:applyPlan,confirmation:applyPlan.required_confirmation,actual_commit:SHA,ledger:applyLedger});
assert.equal(applied.status,"reconciled");
assert.equal(applied.inserted_statement_count,5);
assert.equal(applied.readback_verified,true);
assert.equal((await applyLedger.read(applyPlan.plan_sha256)).state,"succeeded");
assert.equal(applyExecutor.queries.some(({sql})=>/^\s*(UPDATE|DELETE|REPLACE|TRUNCATE|DROP)\b/iu.test(sql)),false);

const confirmationExecutor=executorFor();
const confirmationPlan=await planStagingRuntimeRegistryReconciliation({executor:confirmationExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const confirmationLedger=ledgerFor();
assert.equal(await code(()=>applyStagingRuntimeRegistryReconciliation({executor:confirmationExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:confirmationPlan,confirmation:confirmationPlan.required_confirmation.toLowerCase(),actual_commit:SHA,ledger:confirmationLedger})),"STAGING_REGISTRY_RECONCILIATION_CONFIRMATION_REQUIRED");
assert.equal(confirmationLedger.records.size,0);
assert.equal(confirmationExecutor.queries.some(({sql})=>sql==="START TRANSACTION"),false);

const driftExecutor=executorFor();
const driftPlan=await planStagingRuntimeRegistryReconciliation({executor:driftExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
driftExecutor.state.actions.push({...definitions.actions.row});
const driftLedger=ledgerFor();
assert.equal(await code(()=>applyStagingRuntimeRegistryReconciliation({executor:driftExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:driftPlan,confirmation:driftPlan.required_confirmation,actual_commit:SHA,ledger:driftLedger})),"STAGING_REGISTRY_RECONCILIATION_PRECONDITION_CHANGED");
assert.equal(driftLedger.records.size,0);
assert.equal(driftExecutor.queries.some(({sql})=>sql==="START TRANSACTION"),false);

const planTamperExecutor=executorFor();
const planTamper=await planStagingRuntimeRegistryReconciliation({executor:planTamperExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const tamperedPlan=structuredClone(planTamper);
tamperedPlan.missing_count+=1;
assert.equal(await code(()=>applyStagingRuntimeRegistryReconciliation({executor:planTamperExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:tamperedPlan,confirmation:planTamper.required_confirmation,actual_commit:SHA,ledger:ledgerFor()})),"STAGING_REGISTRY_RECONCILIATION_PLAN_HASH_MISMATCH");

const exactState=Object.fromEntries(tables.map((table)=>[table,[{...definitions[table].row}]]));
const exact=await inspectStagingRuntimeRegistrySnapshot({executor:executorFor(exactState),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(exact.status,"already_satisfied");
assert.equal(exact.missing_count,0);
assert.equal(exact.repair_allowed,false);

const jsonEquivalentState=cloneState(exactState);
jsonEquivalentState.actions[0].schema_json={type:"object",required:["a"]};
const jsonEquivalent=await inspectStagingRuntimeRegistrySnapshot({executor:executorFor(jsonEquivalentState),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(jsonEquivalent.status,"already_satisfied","JSON object/string representations must compare semantically");
assert.equal(jsonEquivalent.conflict_count,0);

const temporalEquivalentState=cloneState(exactState);
temporalEquivalentState.actions[0].oauth_last_validated_at=new Date("2026-10-02T01:02:03.000Z");
const temporalEquivalent=await inspectStagingRuntimeRegistrySnapshot({executor:executorFor(temporalEquivalentState),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(temporalEquivalent.status,"already_satisfied","Date/string temporal representations must compare semantically");
assert.equal(temporalEquivalent.conflict_count,0);

const conflictState=cloneState(exactState);
conflictState.actions[0].action_title="Locally Changed";
const conflict=await inspectStagingRuntimeRegistrySnapshot({executor:executorFor(conflictState),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(conflict.status,"conflict");
assert.equal(conflict.conflict_count,1);
assert.equal(conflict.repair_allowed,false);

const extraState=cloneState(exactState);
extraState.actions.push({action_key:"local_extra",action_title:"Local Extra",status:"active"});
const extra=await inspectStagingRuntimeRegistrySnapshot({executor:executorFor(extraState),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA});
assert.equal(extra.status,"already_satisfied");
assert.equal(extra.extra_count,1);

const extraApplyState=blankState();
extraApplyState.actions.push({action_key:"local_extra",action_title:"Local Extra",status:"active"});
const extraApplyExecutor=executorFor(extraApplyState);
const extraApplyPlan=await planStagingRuntimeRegistryReconciliation({executor:extraApplyExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const extraApplyLedger=ledgerFor();
const extraApplied=await applyStagingRuntimeRegistryReconciliation({executor:extraApplyExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:extraApplyPlan,confirmation:extraApplyPlan.required_confirmation,actual_commit:SHA,ledger:extraApplyLedger});
assert.equal(extraApplied.status,"reconciled");
assert.equal(extraApplied.extra_count,1);
assert.equal(extraApplyExecutor.state.actions.some((row)=>row.action_key==="local_extra"),true);
assert.equal((await extraApplyLedger.read(extraApplyPlan.plan_sha256)).extra_live_rows_preserved,1);

const duplicateState=cloneState(exactState);
duplicateState.endpoints.push({...definitions.endpoints.row});
assert.equal(await code(()=>inspectStagingRuntimeRegistrySnapshot({executor:executorFor(duplicateState),snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA})),"STAGING_REGISTRY_RECONCILIATION_LIVE_IDENTITY_DUPLICATE");

const forbiddenMetadata=structuredClone(metadata);
forbiddenMetadata.projections.actions.included_columns.push("api_key_value");
forbiddenMetadata.projections.actions.column_types.api_key_value="text";
assert.equal(await code(async()=>parseStagingRuntimeRegistrySnapshot({snapshot_gzip:gzip,snapshot_metadata:forbiddenMetadata,expected_commit:SHA})),"STAGING_REGISTRY_RECONCILIATION_FORBIDDEN_COLUMN_PROJECTED");

const tampered=Buffer.from(gzip);
tampered[tampered.length-1]^=1;
assert.equal(await code(async()=>parseStagingRuntimeRegistrySnapshot({snapshot_gzip:tampered,snapshot_metadata:metadata,expected_commit:SHA})),"STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_HASH_MISMATCH");
assert.equal(await code(async()=>parseStagingRuntimeRegistrySnapshot({snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:"b".repeat(40)})),"STAGING_REGISTRY_RECONCILIATION_SNAPSHOT_METADATA_INVALID");

const rollbackExecutor=executorFor(blankState(),{failInsertAt:1});
const rollbackPlan=await planStagingRuntimeRegistryReconciliation({executor:rollbackExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const rollbackLedger=ledgerFor();
assert.equal(await code(()=>applyStagingRuntimeRegistryReconciliation({executor:rollbackExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:rollbackPlan,confirmation:rollbackPlan.required_confirmation,actual_commit:SHA,ledger:rollbackLedger})),"STAGING_REGISTRY_RECONCILIATION_KNOWN_NOT_APPLIED");
assert.equal((await rollbackLedger.read(rollbackPlan.plan_sha256)).state,"known_not_applied");
assert.equal(rollbackExecutor.state.actions.length,0);

const reconcileNoMutationExecutor=executorFor();
const reconcileNoMutationPlan=await planStagingRuntimeRegistryReconciliation({executor:reconcileNoMutationExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const reconcileNoMutationLedger=ledgerFor();
await reconcileNoMutationLedger.reserve({plan_sha256:reconcileNoMutationPlan.plan_sha256});
await reconcileNoMutationLedger.markExecuting(reconcileNoMutationPlan.plan_sha256,{});
await reconcileNoMutationLedger.markUnknown(reconcileNoMutationPlan.plan_sha256,{reason:"transport_ambiguous"});
const reconciledNoMutation=await reconcileStagingRuntimeRegistryReconciliation({executor:reconcileNoMutationExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:reconcileNoMutationPlan,actual_commit:SHA,ledger:reconcileNoMutationLedger});
assert.equal(reconciledNoMutation.status,"reconciled_no_mutation");
assert.equal((await reconcileNoMutationLedger.read(reconcileNoMutationPlan.plan_sha256)).state,"reconciled_no_mutation");

const reconcileSucceededPlanExecutor=executorFor();
const reconcileSucceededPlan=await planStagingRuntimeRegistryReconciliation({executor:reconcileSucceededPlanExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const reconcileSucceededExecutor=executorFor(exactState);
const reconcileSucceededLedger=ledgerFor();
await reconcileSucceededLedger.reserve({plan_sha256:reconcileSucceededPlan.plan_sha256});
await reconcileSucceededLedger.markExecuting(reconcileSucceededPlan.plan_sha256,{});
await reconcileSucceededLedger.markUnknown(reconcileSucceededPlan.plan_sha256,{reason:"commit_ack_lost"});
const reconciledSucceeded=await reconcileStagingRuntimeRegistryReconciliation({executor:reconcileSucceededExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:reconcileSucceededPlan,actual_commit:SHA,ledger:reconcileSucceededLedger});
assert.equal(reconciledSucceeded.status,"reconciled_succeeded");
assert.equal((await reconcileSucceededLedger.read(reconcileSucceededPlan.plan_sha256)).state,"succeeded");

const unknownExecutor=executorFor(blankState(),{failInsertAt:2,rollbackFails:true});
const unknownPlan=await planStagingRuntimeRegistryReconciliation({executor:unknownExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:SHA,actual_commit:SHA});
const unknownLedger=ledgerFor();
assert.equal(await code(()=>applyStagingRuntimeRegistryReconciliation({executor:unknownExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:unknownPlan,confirmation:unknownPlan.required_confirmation,actual_commit:SHA,ledger:unknownLedger})),"STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_REQUIRED");
assert.equal((await unknownLedger.read(unknownPlan.plan_sha256)).state,"unknown_outcome");
assert.equal(await code(()=>reconcileStagingRuntimeRegistryReconciliation({executor:unknownExecutor,snapshot_gzip:gzip,snapshot_metadata:metadata,plan:unknownPlan,actual_commit:SHA,ledger:unknownLedger})),"STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_REQUIRED");

console.log("Staging runtime registry reconciliation tests passed");
