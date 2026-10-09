// Server-only Hostinger database inventory and non-executable Recovery preview.
// This module NEVER performs Hostinger writes, certifies CREATE privilege,
// imports masked secrets, or promotes the legacy SSH command catalog.
import { createHash } from "node:crypto";

const ORIGIN = "https://developers.hostinger.com";
const ACCOUNT = /^u[0-9]{4,16}$/;
const DATABASE = /^[a-zA-Z0-9_]{1,64}$/;
const DOMAIN = /^(?=.{3,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
const MAX_BYTES = 262_144;

function refuse(code, status=409) {
  const error = new Error(code);
  error.code=code; error.status=status;
  return error;
}
function exact(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw refuse(code,400);
  return value;
}
// Hostinger documents page/per_page pagination; no next-link URL is trusted.
const PAGE_SIZE=100, MAX_PAGES=5, MAX_DATABASES=500;
function parsePage(value,page) {
  const rows=Array.isArray(value?.data)?value.data:null;
  const meta=value?.meta;
  if(!rows||!meta||typeof meta!=="object")
    throw refuse("hostinger_inventory_pagination_metadata_missing",502);
  const {current_page,per_page,total}=meta;
  if(!Number.isSafeInteger(current_page)||current_page!==page||
     !Number.isSafeInteger(per_page)||per_page!==PAGE_SIZE||
     !Number.isSafeInteger(total)||total<0||total>MAX_DATABASES||
     Math.ceil(total/PAGE_SIZE)>MAX_PAGES||
     rows.length!==Math.max(0,Math.min(PAGE_SIZE,total-(page-1)*PAGE_SIZE)))
    throw refuse("hostinger_inventory_pagination_unverified",502);
  if(value.links?.next||value.next_page_url||meta.next_page)
    throw refuse("hostinger_inventory_untrusted_continuation",502);
  const names=rows.map(row=>{
    if(!row||typeof row!=="object"||typeof row.name!=="string"||
       !DATABASE.test(row.name))
      throw refuse("hostinger_inventory_record_invalid",502);
    return row.name;
  });
  return {total,names};
}
async function boundedBody(response) {
  const size=Number(response.headers?.get?.("content-length")||0);
  if (size > MAX_BYTES) throw refuse("hostinger_inventory_response_unbounded",502);
  if (!response.body) throw refuse("hostinger_inventory_body_missing",502);
  const chunks=[];let total=0;
  for await (const bytes of response.body) {
    total+=bytes.byteLength;
    if(total>MAX_BYTES) throw refuse("hostinger_inventory_response_unbounded",502);
    chunks.push(Buffer.from(bytes));
  }
  try {return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch {throw refuse("hostinger_inventory_json_invalid",502);}
}

// Only the server-side credential vault may supply getManagedToken. Never
// accept tokens, arbitrary URLs, or HTTP methods from end-user requests.
export function createHostingerReadOnlyTransport({
  boundAccountUsername,getManagedToken,fetchImpl=fetch
}={}) {
  if(typeof getManagedToken!=="function" || typeof fetchImpl!=="function")
    throw refuse("hostinger_managed_provider_binding_missing",503);
  const boundAccount=exact(boundAccountUsername,ACCOUNT,"hostinger_bound_account_required");
  return Object.freeze({
    async databaseInventory(accountUsername) {
      const account=exact(accountUsername,ACCOUNT,"hostinger_account_identifier_invalid");
      if(account!==boundAccount)throw refuse("hostinger_managed_credential_account_mismatch",403);
      const token=await getManagedToken();
      if(typeof token!=="string" || token.length<20 || token.length>2048)
        throw refuse("hostinger_managed_api_token_missing",503);
      const readPage=async page=>{
        const url=`${ORIGIN}/api/hosting/v1/accounts/${encodeURIComponent(account)}/databases?page=${page}&per_page=${PAGE_SIZE}`;
        let response;
        try {
          response=await fetchImpl(url,{
            method:"GET",redirect:"manual",cache:"no-store",
            headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json"},
            signal:AbortSignal.timeout(8000),
          });
        }catch {throw refuse("hostinger_provider_inventory_transport_unavailable",503);}
        if(response.status===401||response.status===403)
          throw refuse("hostinger_provider_inventory_permission_denied",403);
        if(response.status===429)throw refuse("hostinger_provider_inventory_rate_limited",429);
        if(response.status!==200)throw refuse("hostinger_provider_inventory_failed",503);
        return parsePage(await boundedBody(response),page);
      };
      const readSnapshot=async()=>{
        const first=await readPage(1);
        const pages=Math.max(1,Math.ceil(first.total/PAGE_SIZE));
        const all=[...first.names];
        for(let page=2;page<=pages;page++){
          const next=await readPage(page);
          if(next.total!==first.total)
            throw refuse("hostinger_inventory_concurrent_page_drift",409);
          all.push(...next.names);
        }
        if(all.length!==first.total||new Set(all).size!==all.length||
           all.some(n=>!n.startsWith(`${account}_`)))
          throw refuse("hostinger_inventory_incomplete_or_cross_account",502);
        return Object.freeze({names:all,total:first.total,pages});
      };
      const snapshot=await readSnapshot();
      if(snapshot.pages>1){
        // Pagination is not a transactional snapshot. Re-read all pages and
        // fail closed if concurrent additions/removals changed the scan.
        // This cannot guarantee a DB did not race immediately afterwards:
        // a separate write executor must revalidate under a governed lease.
        const second=await readSnapshot();
        const digest=names=>createHash("sha256").update(
          JSON.stringify([...names].sort())).digest("hex");
        if(snapshot.total!==second.total||digest(snapshot.names)!==digest(second.names))
          throw refuse("hostinger_inventory_concurrent_page_drift",409);
      }
      return Object.freeze({
        database_names:snapshot.names,provider_http_status:200,
        page_count:snapshot.pages,inventory_snapshot_stable:snapshot.pages>1,
        complete_paginated_scan:true
      });
    }
  });
}

export async function previewHostingerRecoveryDatabase({
  accountUsername,websiteDomain,recoveryDatabaseName,provider
}={}) {
  const account=exact(accountUsername,ACCOUNT,"hostinger_account_identifier_invalid");
  const domain=exact(websiteDomain,DOMAIN,"hostinger_website_domain_invalid").toLowerCase();
  const database=exact(recoveryDatabaseName,DATABASE,"hostinger_recovery_database_name_invalid");
  if(!database.startsWith(`${account}_`))
    throw refuse("hostinger_recovery_database_account_prefix_required",400);
  if(!provider || typeof provider.databaseInventory!=="function")
    throw refuse("hostinger_provider_inventory_executor_missing",503);
  const observed=await provider.databaseInventory(account);
  if(observed?.provider_http_status!==200)
    throw refuse("hostinger_inventory_http_readback_unverified",503);
  const names=observed?.database_names;
  if(!Array.isArray(names)||names.length>1000||names.some(n=>
      typeof n!=="string"||!DATABASE.test(n)||!n.startsWith(`${account}_`)))
    throw refuse("hostinger_inventory_shape_or_account_scope_unverified",502);
  if(new Set(names).size!==names.length)
    throw refuse("hostinger_inventory_duplicate_names",502);
  const exists=names.includes(database);
  const inventoryDigest=createHash("sha256").update(JSON.stringify([...names].sort())).digest("hex");
  const planIdentity=createHash("sha256").update(JSON.stringify({
    account,domain,database,inventoryDigest,operation:"database_create_preview_only",version:1
  })).digest("hex");
  return Object.freeze({
    contract:"mad4b.hostinger-recovery-readonly-preview.v1",
    account_username:account,website_domain:domain,recovery_database_name:database,
    inventory_sha256:inventoryDigest,plan_sha256:planIdentity,
    provider_inventory_response_accepted:observed.provider_http_status===200,
    // Independent provider account certification must come from a separate issuer.
    inventory_readback_proven:false,
    target_database_exists:exists,
    suggested_operation:exists?"verify_existing_database_ownership":"request_governed_database_create_plan",
    // Supplied website domain has NOT been looked up against Hostinger's website inventory.
    website_identity_verified:false,
    provider_create_entitlement_proven:false,
    managed_credential_intake_proven:false,
    owner_approval_proven:false,
    certified_executor_registered:false,
    plan_allowed:false,execution_allowed:false,mutation_performed:false,
    secrets_included:false,
    blockers:exists
      ? ["database_already_exists_owner_and_schema_readback_required","independent_provider_account_proof_and_certified_executor_missing"]
      : ["independent_provider_account_proof_and_certified_executor_missing","separate_exact_head_owner_approval_required"],
  });
}
