import test from "node:test";
import assert from "node:assert/strict";
import { classifyMcpCatalogRecoveryReadback, collectMcpCatalogRecoveryDecision } from "./mcpCatalogRecoveryDecision.js";
import { MCP_CATALOG_TABLES, MCP_CATALOG_LEVEL_MIGRATION_SHA256 } from "./mcpCatalogSchemaGuard.js";

const identity={ok:true,database_matches:true,principal_matches:true,identity_readback_performed:true};
const base=()=>({ok:false,identity,tables:MCP_CATALOG_TABLES.map(table=>({
  table,available:false,migration_apply_required:true,code:"mcp_catalog_schema_migration_required"
})),database_connection_performed:true,sql_readback_performed:true,migration_apply_required:true});

const liveEnv={DB_NAME:"catalog_runtime",DB_USER:"runtime_user"};
function observedPool(available) {
  return {async query(sql) {
    if(sql.includes("SELECT DATABASE()"))return [[{
      current_database:"catalog_runtime",current_account:"runtime_user@localhost"
    }]];
    if(sql.includes("information_schema.columns"))
      return [[{column_count:available?1:0}]];
    if(sql.includes("LIMIT 0")){
      if(available)return [[],[]];
      const err=new Error("missing column");err.code="ER_BAD_FIELD_ERROR";throw err;
    }
    throw Error("unexpected query");
  }};
}

test("proven missing catalog column produces bounded plan only, not SQL executor",async()=>{
  const forged=classifyMcpCatalogRecoveryReadback(base());
  assert.equal(forged.status,"diagnosis_blocked");
  const decision=await collectMcpCatalogRecoveryDecision({pool:observedPool(false),env:liveEnv});
  assert.equal(decision.readback_collector_verified,true);
  assert.equal(decision.status,"migration_proposal_only");
  assert.equal(decision.governed_migration_proposed,true);
  assert.equal(decision.migration.sha256,MCP_CATALOG_LEVEL_MIGRATION_SHA256);
  assert.equal(decision.migration_apply_allowed,false);
  assert.equal(decision.production_deploy_allowed,false);
  assert.equal(decision.sql_mutation_performed,false);
  assert.match(decision.source_evidence_sha256,/^[0-9a-f]{64}$/);
});

test("both columns present on correct runtime principal becomes read-only ready",async()=>{
  const data=base();data.ok=true;data.migration_apply_required=false;
  data.tables=data.tables.map(t=>({...t,available:true,migration_apply_required:false,code:null}));
  assert.equal(classifyMcpCatalogRecoveryReadback(data).schema_ready,false,
    "Even fake all-true evidence cannot certify a Runtime database");
  const result=await collectMcpCatalogRecoveryDecision({pool:observedPool(true),env:liveEnv});
  assert.equal(result.schema_ready,true);
  assert.equal(result.status,"ready_verified");
  assert.equal(result.governed_migration_proposed,false);
  assert.equal(result.migration_apply_allowed,false);
});

test("database, principal, or metadata mismatch never proposes DDL",()=>{
  for(const change of [
    {identity:{...identity,database_matches:false}},
    {identity:{...identity,principal_matches:false}},
    {identity:{...identity,identity_readback_performed:false}},
    {sql_readback_performed:false},
    {tables:[base().tables[0]]},
    {migration_apply_required:false},
    {tables:[base().tables[0],{...base().tables[1],available:false,migration_apply_required:false}]}
  ]){
    const verdict=classifyMcpCatalogRecoveryReadback({...base(),...change});
    assert.equal(verdict.governed_migration_proposed,false,JSON.stringify(change));
    assert.equal(verdict.schema_ready,false);
    assert.equal(verdict.migration_apply_allowed,false);
  }
});

test("caller-provided ready=true without same-session evidence is never accepted",()=>{
  const report=classifyMcpCatalogRecoveryReadback({
    ok:true,identity:{ok:true,database_matches:true,principal_matches:true},
    tables:MCP_CATALOG_TABLES.map(table=>({table,available:true})),
    migration_apply_required:false,database_connection_performed:false,
    sql_readback_performed:false
  });
  assert.equal(report.schema_ready,false);
  assert.equal(report.status,"diagnosis_blocked");
});


test("same reused DB connection cannot replay cached available column after migration drift",async()=>{
  let available=true, releases=0, projectionQueries=0;
  const conn={
    async query(sql) {
      if(sql.includes("SELECT DATABASE()"))return [[{
        current_database:"catalog_runtime",current_account:"runtime_user@localhost"
      }]];
      if(sql.includes("information_schema.columns"))
        return [[{column_count:available?1:0}]];
      if(sql.includes("LIMIT 0")){
        projectionQueries++;
        if(available)return [[],[]];
        const err=new Error("Column removed");err.code="ER_BAD_FIELD_ERROR";throw err;
      }
      throw Error("unexpected probe");
    },
    release(){releases++;}
  };
  const pool={getConnection:async()=>conn};
  const opts={pool,env:{DB_NAME:"catalog_runtime",DB_USER:"runtime_user"}};
  const ready=await collectMcpCatalogRecoveryDecision(opts);
  assert.equal(ready.status,"ready_verified");
  assert.equal(projectionQueries,2);
  available=false;
  const drift=await collectMcpCatalogRecoveryDecision(opts);
  assert.equal(drift.status,"migration_proposal_only");
  assert.equal(drift.schema_ready,false);
  assert.equal(drift.migration_apply_allowed,false);
  assert.equal(projectionQueries,4,"freshly probe both tables rather than return 30s cached status");
  assert.equal(releases,2);
});
