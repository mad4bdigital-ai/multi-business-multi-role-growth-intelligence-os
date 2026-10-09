// Read-only Runtime MCP catalog evidence and governance decision. Not a DDL executor.
import { createHash } from "node:crypto";
import {
  MCP_CATALOG_TABLES, MCP_CATALOG_LEVEL_COLUMN,
  MCP_CATALOG_LEVEL_MIGRATION, MCP_CATALOG_LEVEL_MIGRATION_SHA256,
  readMcpCatalogSchemaReadinessSafe,
} from "./mcpCatalogSchemaGuard.js";

const sha=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Only the bound SQL collector can mint a readiness object eligible for
// ready_verified or migration_proposal_only; JSON and caller booleans cannot.
const collectedReadbacks=new WeakSet();

export function classifyMcpCatalogRecoveryReadback(readiness) {
  const collectorProven=Boolean(readiness && collectedReadbacks.has(readiness));
  const identity=readiness?.identity;
  const tables=Array.isArray(readiness?.tables)?readiness.tables:[];
  const exactTables=tables.length===MCP_CATALOG_TABLES.length &&
    MCP_CATALOG_TABLES.every(name=>tables.filter(t=>t?.table===name).length===1);
  const verifiedIdentity=collectorProven && identity?.ok===true &&
    identity.database_matches===true && identity.principal_matches===true &&
    identity.identity_readback_performed===true;
  const readback=collectorProven && readiness?.database_connection_performed===true &&
    readiness.sql_readback_performed===true && exactTables;
  const allPresent=exactTables&&tables.every(t=>t?.available===true);
  const provenMissing=exactTables&&tables.some(t=>t?.migration_apply_required===true)&&
    tables.every(t=>t?.available===true||t?.migration_apply_required===true);
  const provenMigrationRequired=verifiedIdentity&&readback&&provenMissing&&
    readiness?.migration_apply_required===true;
  const alreadyReady=verifiedIdentity&&readback&&allPresent&&readiness?.ok===true;
  const blockers=[];
  if(!collectorProven) blockers.push("live_runtime_collector_evidence_missing");
  if(!verifiedIdentity) blockers.push("runtime_database_or_principal_unverified");
  if(!readback) blockers.push("same_session_catalog_readback_unverified");
  if(verifiedIdentity&&readback&&!alreadyReady&&!provenMigrationRequired)
    blockers.push("schema_absence_or_privilege_evidence_inconclusive");
  if(provenMigrationRequired) blockers.push("governed_migration_apply_and_independent_readback_required");
  const migration={
    name:MCP_CATALOG_LEVEL_MIGRATION,sha256:MCP_CATALOG_LEVEL_MIGRATION_SHA256,
    target_database_role:"runtime",required_column:MCP_CATALOG_LEVEL_COLUMN,
    target_tables:[...MCP_CATALOG_TABLES],
  };
  const status=alreadyReady?"ready_verified":provenMigrationRequired
    ?"migration_proposal_only":"diagnosis_blocked";
  return {
    contract:"mad4b.mcp-catalog-recovery-decision.v1",
    status,diagnosis_completed:alreadyReady||provenMigrationRequired,
    readback_collector_verified:collectorProven,
    diagnostic_fingerprint_only:true,
    runtime_identity_proven:verifiedIdentity,same_session_readback_proven:readback,
    schema_ready:alreadyReady,governed_migration_proposed:provenMigrationRequired,
    migration,
    source_evidence_sha256:sha({verifiedIdentity,readback,tableStates:tables.map(t=>({
      table:t.table,available:t.available===true,migration_required:t.migration_apply_required===true,
      code:String(t.code||"").slice(0,128)
    })).sort((a,b)=>a.table.localeCompare(b.table)),migration}),
    // Even a proven missing column cannot implicitly grant DDL or deploy authority.
    migration_apply_allowed:false,production_deploy_allowed:false,
    sql_mutation_performed:false,blockers,secrets_included:false,
  };
}
export async function collectMcpCatalogRecoveryDecision({pool,env}={}) {
  const readiness=await readMcpCatalogSchemaReadinessSafe({pool,env});
  collectedReadbacks.add(readiness);
  return classifyMcpCatalogRecoveryReadback(readiness);
}
