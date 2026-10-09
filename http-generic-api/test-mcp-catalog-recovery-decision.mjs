import test from "node:test";
import assert from "node:assert/strict";
import { classifyMcpCatalogRecoveryReadback } from "./mcpCatalogRecoveryDecision.js";
import { MCP_CATALOG_TABLES, MCP_CATALOG_LEVEL_MIGRATION_SHA256 } from "./mcpCatalogSchemaGuard.js";

const identity={ok:true,database_matches:true,principal_matches:true,identity_readback_performed:true};
const base=()=>({ok:false,identity,tables:MCP_CATALOG_TABLES.map(table=>({
  table,available:false,migration_apply_required:true,code:"mcp_catalog_schema_migration_required"
})),database_connection_performed:true,sql_readback_performed:true,migration_apply_required:true});

test("proven missing catalog column produces bounded plan only, not SQL executor",()=>{
  const decision=classifyMcpCatalogRecoveryReadback(base());
  assert.equal(decision.status,"migration_proposal_only");
  assert.equal(decision.governed_migration_proposed,true);
  assert.equal(decision.migration.sha256,MCP_CATALOG_LEVEL_MIGRATION_SHA256);
  assert.equal(decision.migration_apply_allowed,false);
  assert.equal(decision.production_deploy_allowed,false);
  assert.equal(decision.sql_mutation_performed,false);
  assert.match(decision.source_evidence_sha256,/^[0-9a-f]{64}$/);
});

test("both columns present on correct runtime principal becomes read-only ready",()=>{
  const data=base();data.ok=true;data.migration_apply_required=false;
  data.tables=data.tables.map(t=>({...t,available:true,migration_apply_required:false,code:null}));
  const result=classifyMcpCatalogRecoveryReadback(data);
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
