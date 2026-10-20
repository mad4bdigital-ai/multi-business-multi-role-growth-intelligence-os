import test from "node:test";
import assert from "node:assert/strict";
import { classifyMcpCatalogRecoveryReadback, collectMcpCatalogRecoveryDecision } from "./mcpCatalogRecoveryDecision.js";
import { MCP_CATALOG_TABLES, MCP_CATALOG_LEVEL_MIGRATION_SHA256, readMcpCatalogRuntimeIdentity } from "./mcpCatalogSchemaGuard.js";

const identity={ok:true,database_matches:true,principal_matches:true,identity_readback_performed:true};
const base=()=>({ok:false,identity,tables:MCP_CATALOG_TABLES.map(table=>({
  table,available:false,migration_apply_required:true,code:"mcp_catalog_schema_migration_required"
})),database_connection_performed:true,sql_readback_performed:true,migration_apply_required:true});

const liveEnv={DB_NAME:"catalog_runtime",DB_USER:"runtime_user",
  MCP_RUNTIME_EXPECTED_SQL_ACCOUNT:"runtime_user@localhost"};
function observedPool(available) {
  const connection={async query(sql) {
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
  },release(){}};
  return {getConnection:async()=>connection};
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
  const opts={pool,env:liveEnv};
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

test("pool facade without an acquired lease cannot mint a same-session Recovery certificate",async()=>{
  const conn=await observedPool(true).getConnection();
  const withoutLease={query:conn.query};
  const decision=await collectMcpCatalogRecoveryDecision({pool:withoutLease,env:liveEnv});
  assert.equal(decision.schema_ready,false);
  assert.equal(decision.status,"diagnosis_blocked");
  assert.equal(decision.same_session_readback_proven,false);
  assert.equal(decision.migration_apply_allowed,false);
});

test("metadata suggesting a missing column without a lease never proposes a migration",async()=>{
  const conn=await observedPool(false).getConnection();
  const decision=await collectMcpCatalogRecoveryDecision({pool:{query:conn.query},env:liveEnv});
  assert.equal(decision.governed_migration_proposed,false);
  assert.equal(decision.migration_apply_allowed,false);
});

test("username matches but host part of CURRENT_USER differs: no Recovery certificate",async()=>{
  const d=await collectMcpCatalogRecoveryDecision({
    pool:observedPool(true),
    env:{...liveEnv,MCP_RUNTIME_EXPECTED_SQL_ACCOUNT:"runtime_user@%"}
  });
  assert.equal(d.schema_ready,false);
  assert.equal(d.status,"diagnosis_blocked");
  assert.equal(d.migration_apply_allowed,false);
});

test("missing exact SQL account identity forbids migration recommendation",async()=>{
  const d=await collectMcpCatalogRecoveryDecision({
    pool:observedPool(false),
    env:{DB_NAME:"catalog_runtime",DB_USER:"runtime_user"}
  });
  assert.equal(d.governed_migration_proposed,false);
  assert.equal(d.status,"diagnosis_blocked");
});

test("raw Runtime identity cannot report ok for missing or mismatched MariaDB account host",async()=>{
  const conn=await observedPool(true).getConnection();
  const correct=await readMcpCatalogRuntimeIdentity({pool:conn,env:liveEnv});
  assert.equal(correct.ok,true);
  assert.equal(correct.exact_sql_account_matches,true);
  const mismatch=await readMcpCatalogRuntimeIdentity({pool:conn,env:{...liveEnv,MCP_RUNTIME_EXPECTED_SQL_ACCOUNT:"runtime_user@%"}});
  assert.equal(mismatch.ok,false);
  assert.equal(mismatch.code,"MCP_CATALOG_RUNTIME_SQL_ACCOUNT_MISMATCH");
  assert.equal(mismatch.principal_matches,true,"matching DB_USER prefix must not confer exact identity");
  const missing=await readMcpCatalogRuntimeIdentity({pool:conn,env:{DB_NAME:liveEnv.DB_NAME,DB_USER:liveEnv.DB_USER}});
  assert.equal(missing.ok,false);
  assert.equal(missing.code,"MCP_CATALOG_RUNTIME_SQL_ACCOUNT_CONFIG_MISSING");
});
