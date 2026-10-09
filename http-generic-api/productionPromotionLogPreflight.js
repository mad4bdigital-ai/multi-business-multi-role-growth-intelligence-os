// Read-only diagnostic gate for logs captured BEFORE a governed Production promotion.
// Never accepts this log as independent deployment, schema, grant or release authority.
// Only emits fixed codes and aggregate counts, never raw log lines, tokens or DB principals.
export const CONTRACT="mad4b.hostinger.production-promotion-log-preflight.v1";
const MAX_LOG_BYTES=4*1024*1024;
const MAX_LINES=12000;
const knownEvents=new Set([
  "runtime_bootstrap_status","mcp_catalog_schema_startup_preflight",
  "dynamic_audit_write_authority_unavailable","dynamic_audit_scheduler_start",
  "openapi_endpoint_inventory_sync_start_failed","openapi_endpoint_inventory_sync_start",
  "runtime_parity_startup_reconcile"
]);
function parseEvent(line) {
  const index=line.indexOf('{"event":');
  if(index<0 || line.length-index>65536)return null;
  try{
    const result=JSON.parse(line.slice(index));
    return knownEvents.has(result.event)?result:null;
  }catch{return null;}
}
export function assessProductionPromotionLog(log,{queueRequired=false,expectedSourceSha=null,
  expectedProductionBranch="Production"}={}) {
  if(typeof log!=="string"||Buffer.byteLength(log,"utf8")>MAX_LOG_BYTES)
    throw Object.assign(new Error("production_log_input_invalid_or_too_large"),
      {code:"production_log_input_invalid_or_too_large"});
  const lines=log.split(/\r?\n/);
  if(lines.length>MAX_LINES)
    throw Object.assign(new Error("production_log_line_limit_exceeded"),
      {code:"production_log_line_limit_exceeded"});
  const events={};
  const flags=new Set();
  const catalogTables=new Set();
  for(const line of lines) {
    const event=parseEvent(line);
    if(event){
      events[event.event]=(events[event.event]||0)+1;
      if(event.event==="runtime_bootstrap_status"){
        if(event.status==="bootstrap_not_configured" || event.hook?.configured===false)
          flags.add("BOOTSTRAP_HOOK_NOT_CONFIGURED");
        if(event.source_binding?.exact_sha_configured===false ||
           event.source_binding?.target_binding_configured===false)
          flags.add("BOOTSTRAP_EXACT_RELEASE_OR_TARGET_UNBOUND");
        if(event.bootstrap_credentials?.configured===false)
          flags.add("BOOTSTRAP_CREDENTIAL_AUTHORITY_NOT_CONFIGURED");
        if(event.source_binding?.branch!==expectedProductionBranch)
          flags.add("WRONG_PRODUCTION_SOURCE_BRANCH");
      }
      if(event.event==="mcp_catalog_schema_startup_preflight"){
        if(event.environment==="unknown")flags.add("RUNTIME_ENVIRONMENT_IDENTITY_UNKNOWN");
        if(event.ready!==true || event.readiness?.ok!==true) {
          flags.add("MCP_CATALOG_SCHEMA_NOT_READY");
          if(event.startup_blocked===false)
            flags.add("MCP_SCHEMA_UNREADY_STARTUP_FAIL_OPEN");
        }
        for(const table of event.readiness?.tables||[]){
          if(table?.required_field==="mcp_catalog_level" && table?.available===false &&
             ["admin_platform_endpoint_tools","tenant_platform_endpoint_tools"].includes(table.table))
            catalogTables.add(table.table);
        }
        if(event.readiness?.identity?.ok!==true ||
           event.readiness?.identity?.database_matches!==true ||
           event.readiness?.identity?.principal_matches!==true)
          flags.add("RUNTIME_DATABASE_PRINCIPAL_IDENTITY_UNVERIFIED");
      }
      if(event.event==="dynamic_audit_write_authority_unavailable"||
         (event.event==="dynamic_audit_scheduler_start"&&event.started===false))
        flags.add("DYNAMIC_AUDIT_SCHEDULER_WRITE_UNAVAILABLE");
      if(event.event==="openapi_endpoint_inventory_sync_start_failed"||
         (event.event==="openapi_endpoint_inventory_sync_start"&&event.started===false))
        flags.add("OPENAPI_INVENTORY_WRITE_UNAVAILABLE");
      if(event.event==="runtime_parity_startup_reconcile"&&
         (event.ok!==true || event.status==="degraded"))
        flags.add("RUNTIME_PARITY_RECONCILIATION_DEGRADED");
    }
    if(line.includes("ER_TABLEACCESS_DENIED_ERROR") ||
       (line.includes("command denied")&&line.includes(" for table")))
      flags.add("RUNTIME_SQL_WRITE_PRIVILEGES_DENIED");
    if(line.includes("response_chunk_schema_incomplete")||
       line.includes("response_chunk_persistence_unavailable"))
      flags.add("DURABLE_TOOL_RESPONSE_CHUNK_STORE_UNAVAILABLE");
    if(line.includes("EXECUTION_AUTHORITY_MANIFEST_GUARD:") &&
       line.includes('"enforced":false'))
      flags.add("EXECUTION_AUTHORITY_MANIFEST_ENFORCEMENT_DISABLED");
    if(line.includes("execution_log append failed"))
      flags.add("EXECUTION_JOURNAL_WRITE_UNAVAILABLE");
    if(line.includes("json_assets append failed"))
      flags.add("JSON_ASSET_WRITE_UNAVAILABLE");
    if(line.includes("tenant_gpt_oauth_token_exchange_v2_diagnostic_failed"))
      flags.add("TENANT_OAUTH_RUNTIME_DIAGNOSTIC_FAILED");
    if(line.includes("QUEUE_DISABLED:")||line.includes("QUEUE_WORKER_DISABLED:"))
      flags.add("QUEUE_WORKER_DISABLED");
  }
  const blockers=[];
  if(lines.length===0||Object.keys(events).length===0)
    blockers.push("NO_AUTHENTICATED_RUNTIME_STARTUP_EVIDENCE");
  if(!events.runtime_bootstrap_status)blockers.push("NO_RUNTIME_BOOTSTRAP_EVIDENCE");
  if(!events.mcp_catalog_schema_startup_preflight)
    blockers.push("NO_MCP_SCHEMA_STARTUP_EVIDENCE");
  for(const flag of [...flags].sort()) {
    if(flag!=="QUEUE_WORKER_DISABLED" || queueRequired===true)blockers.push(flag);
  }
  if(catalogTables.size!==0)
    blockers.push("MCP_CATALOG_REQUIRED_COLUMN_MISSING_ON_"+catalogTables.size+"_TABLES");
  // The absence of errors in supplied log lines is not a signed successful
  // readback and must not lift Production mutation permissions.
  blockers.push("INDEPENDENT_PRODUCTION_PRIVILEGE_SCHEMA_AND_ROLLBACK_EVIDENCE_REQUIRED");
  if(typeof expectedSourceSha!=="string" || !/^[0-9a-f]{40}$/.test(expectedSourceSha))
    blockers.push("EXACT_RELEASE_SOURCE_SHA_UNSPECIFIED");
  const queueRequiredButDown=queueRequired===true&&flags.has("QUEUE_WORKER_DISABLED");
  return Object.freeze({
    contract:CONTRACT,
    evaluation:"pre_promotion_log_observation_only",
    deployment_target:"Production",
    assessed_line_count:lines.length,
    recognized_event_counts:events,
    missing_mcp_column_tables:[...catalogTables].sort(),
    operational_blockers:[...new Set(blockers)].sort(),
    advisories:!queueRequired&&flags.has("QUEUE_WORKER_DISABLED")
      ?["QUEUE_DISABLED_REQUIREMENTS_DEPENDENT"]:[],
    queue_required:queueRequired,
    queue_required_but_disabled:queueRequiredButDown,
    source_head_sha_valid:typeof expectedSourceSha==="string"&&/^[0-9a-f]{40}$/.test(expectedSourceSha),
    risks_found:flags.size,
    pre_promotion_state:"NO_GO",
    promotion_authorized:false,
    production_mutation_authorized:false,
    provider_db_create_authorized:false,
    migration_apply_authorized:false,
    rollback_certified:false,
    same_cycle_signed_readback_verified:false,
    log_contains_independent_authority:false,
    source_evidence_type:"operator_supplied_log",
    secrets_included:false
  });
}
