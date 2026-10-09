import test from "node:test";
import assert from "node:assert/strict";
import {assessProductionPromotionLog,CONTRACT} from "./productionPromotionLogPreflight.js";

const event=(kind,more={})=>JSON.stringify({event:kind,...more});
const productionEvidence=[
  "QUEUE_DISABLED: REDIS_URL not set and QUEUE_WORKER_ENABLED is not TRUE",
  event("runtime_bootstrap_status",{
    status:"bootstrap_not_configured",
    hook:{required:true,configured:false},
    source_binding:{branch:"Production",exact_sha_configured:false,target_binding_configured:false},
    bootstrap_credentials:{configured:false}
  }),
  event("mcp_catalog_schema_startup_preflight",{
    environment:"unknown",ready:false,startup_blocked:false,
    readiness:{ok:false,identity:{ok:true,database_matches:true,principal_matches:true},
      tables:["admin_platform_endpoint_tools","tenant_platform_endpoint_tools"].map(table=>({
        table,required_field:"mcp_catalog_level",available:false,migration_apply_required:true
      }))
    }
  }),
  event("dynamic_audit_write_authority_unavailable",{
    code:"dynamic_audit_write_authority_unavailable",original_error_code:"ER_TABLEACCESS_DENIED_ERROR"
  }),
  event("dynamic_audit_scheduler_start",{started:false}),
  event("openapi_endpoint_inventory_sync_start_failed",{
    code:"openapi_inventory_write_authority_unavailable",table:"actions"
  }),
  event("runtime_parity_startup_reconcile",{ok:false,status:"degraded",error_code:"ER_TABLEACCESS_DENIED_ERROR"}),
  "[sinkOrchestration] SQL execution_log append failed - fail-open: INSERT command denied for table",
  "[sinkOrchestration] SQL json_assets append failed - fail-open: INSERT command denied for table",
  "[gpt-tools] durable response chunk persistence degraded {\"code\":\"response_chunk_persistence_unavailable\",\"cause_code\":\"response_chunk_schema_incomplete\"}",
  "tenant_gpt_oauth_token_exchange_v2_diagnostic_failed {\"code\":\"ER_TABLEACCESS_DENIED_ERROR\"}",
  'EXECUTION_AUTHORITY_MANIFEST_GUARD: {"enforced":false,"guard_status":"not_enforced","reason":"execution_authority_manifest_enforcement_disabled"}'
].join("\n");
const sha="a".repeat(40);

test("actual sanitized production symptoms block promotion irrespective of healthy HTTP 200",()=>{
  const report=assessProductionPromotionLog(productionEvidence+"\nPROVIDER_RESPONSE_STATUS: 200",{expectedSourceSha:sha});
  assert.equal(report.contract,CONTRACT);
  assert.equal(report.pre_promotion_state,"NO_GO");
  assert.equal(report.promotion_authorized,false);
  assert.equal(report.production_mutation_authorized,false);
  assert.equal(report.rollback_certified,false);
  for(const required of [
    "BOOTSTRAP_HOOK_NOT_CONFIGURED","BOOTSTRAP_EXACT_RELEASE_OR_TARGET_UNBOUND",
    "MCP_CATALOG_SCHEMA_NOT_READY","MCP_CATALOG_REQUIRED_COLUMN_MISSING_ON_2_TABLES",
    "DYNAMIC_AUDIT_SCHEDULER_WRITE_UNAVAILABLE","RUNTIME_SQL_WRITE_PRIVILEGES_DENIED",
    "OPENAPI_INVENTORY_WRITE_UNAVAILABLE","RUNTIME_PARITY_RECONCILIATION_DEGRADED",
    "DURABLE_TOOL_RESPONSE_CHUNK_STORE_UNAVAILABLE","EXECUTION_JOURNAL_WRITE_UNAVAILABLE",
    "JSON_ASSET_WRITE_UNAVAILABLE","TENANT_OAUTH_RUNTIME_DIAGNOSTIC_FAILED",
    "RUNTIME_ENVIRONMENT_IDENTITY_UNKNOWN",
    "MCP_SCHEMA_UNREADY_STARTUP_FAIL_OPEN",
    "EXECUTION_AUTHORITY_MANIFEST_ENFORCEMENT_DISABLED"
  ])assert(report.operational_blockers.includes(required),required);
  assert(report.advisories.includes("QUEUE_DISABLED_REQUIREMENTS_DEPENDENT"));
  assert(!report.operational_blockers.includes("QUEUE_WORKER_DISABLED"));
});

test("queue is conditional but required worker disable becomes a blocker",()=>{
  const optional=assessProductionPromotionLog(productionEvidence,{expectedSourceSha:sha,queueRequired:false});
  const required=assessProductionPromotionLog(productionEvidence,{expectedSourceSha:sha,queueRequired:true});
  assert.equal(required.queue_required_but_disabled,true);
  assert(required.operational_blockers.includes("QUEUE_WORKER_DISABLED"));
  assert(!optional.operational_blockers.includes("QUEUE_WORKER_DISABLED"));
});

test("empty, forged event, missing source SHA and wrong branch never authorize release",()=>{
  const nullReport=assessProductionPromotionLog("",{});
  assert(nullReport.operational_blockers.includes("NO_AUTHENTICATED_RUNTIME_STARTUP_EVIDENCE"));
  assert(nullReport.operational_blockers.includes("EXACT_RELEASE_SOURCE_SHA_UNSPECIFIED"));
  const spoof=assessProductionPromotionLog(
    event("runtime_bootstrap_status",{source_binding:{branch:"main",exact_sha_configured:true,
      target_binding_configured:true},hook:{configured:true},
      bootstrap_credentials:{configured:true}}),{expectedSourceSha:sha});
  assert(spoof.operational_blockers.includes("WRONG_PRODUCTION_SOURCE_BRANCH"));
  assert(spoof.operational_blockers.includes("NO_MCP_SCHEMA_STARTUP_EVIDENCE"));
  assert.equal(spoof.promotion_authorized,false);
});

test("even all apparently healthy anonymous log events never supply independent authority",()=>{
  const fakeLog=[
    event("runtime_bootstrap_status",{status:"ready",hook:{configured:true},
      source_binding:{branch:"Production",exact_sha_configured:true,target_binding_configured:true},
      bootstrap_credentials:{configured:true}}),
    event("mcp_catalog_schema_startup_preflight",{environment:"production",ready:true,
      readiness:{ok:true,identity:{ok:true,database_matches:true,principal_matches:true},tables:[]}})
  ].join("\n");
  const report=assessProductionPromotionLog(fakeLog,{expectedSourceSha:sha});
  assert.equal(report.promotion_authorized,false);
  assert(report.operational_blockers.includes("INDEPENDENT_PRODUCTION_PRIVILEGE_SCHEMA_AND_ROLLBACK_EVIDENCE_REQUIRED"));
});

test("oversized and high-line-count operator logs are rejected before parsing",()=>{
  assert.throws(()=>assessProductionPromotionLog("x".repeat(4*1024*1024+1)),x=>
    x.code==="production_log_input_invalid_or_too_large");
  assert.throws(()=>assessProductionPromotionLog("x\n".repeat(12001)),x=>
    x.code==="production_log_line_limit_exceeded");
});

test("report never exports user identity, API header, secrets or raw log lines",()=>{
  const canary="canary-UNPRINTABLE-credential-and-db-identifier";
  const log=productionEvidence+ "\nAPP_SECRET="+canary+"\nDB_USER="+canary;
  const result=assessProductionPromotionLog(log,{expectedSourceSha:sha});
  assert(!JSON.stringify(result).includes(canary));
  assert.equal(result.secrets_included,false);
  assert.equal(result.source_evidence_type,"operator_supplied_log");
});

test("startup errors repeated across restarts do not become evidence of successful migrations",()=>{
  const many=Array(20).fill(productionEvidence).join("\n");
  const report=assessProductionPromotionLog(many,{expectedSourceSha:sha});
  assert.equal(report.recognized_event_counts.runtime_bootstrap_status,20);
  assert.equal(report.migration_apply_authorized,false);
  assert.equal(report.provider_db_create_authorized,false);
  assert.equal(report.same_cycle_signed_readback_verified,false);
});
