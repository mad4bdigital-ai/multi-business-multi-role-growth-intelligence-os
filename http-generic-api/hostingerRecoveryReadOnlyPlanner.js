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
function records(value) {
  // Do not assume pagination, aliases, or undocumented object shapes are complete.
  const rows = Array.isArray(value) ? value
    : (value && typeof value === "object" && Array.isArray(value.data) ? value.data : null);
  if (!rows || rows.length > 1000) throw refuse("hostinger_inventory_shape_unverified",502);
  if (value && typeof value === "object" && !Array.isArray(value) &&
      (value.links?.next || value.next_page_url || value.meta?.next_page)) {
    throw refuse("hostinger_inventory_pagination_unverified",502);
  }
  return rows.map(row=>{
    if (!row || typeof row !== "object" || typeof row.name !== "string" ||
        !DATABASE.test(row.name)) throw refuse("hostinger_inventory_record_invalid",502);
    return row.name;
  });
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
export function createHostingerReadOnlyTransport({getManagedToken,fetchImpl=fetch}={}) {
  if(typeof getManagedToken!=="function" || typeof fetchImpl!=="function")
    throw refuse("hostinger_managed_provider_binding_missing",503);
  return Object.freeze({
    async databaseInventory(accountUsername) {
      const account=exact(accountUsername,ACCOUNT,"hostinger_account_identifier_invalid");
      const token=await getManagedToken();
      if(typeof token!=="string" || token.length<20 || token.length>2048)
        throw refuse("hostinger_managed_api_token_missing",503);
      const url=`${ORIGIN}/api/hosting/v1/accounts/${encodeURIComponent(account)}/databases`;
      let response;
      try {
        response=await fetchImpl(url,{
          method:"GET",redirect:"manual",cache:"no-store",
          headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},
          signal:AbortSignal.timeout(8000),
        });
      }catch{throw refuse("hostinger_provider_inventory_transport_unavailable",503);}
      if(response.status===401||response.status===403)
        throw refuse("hostinger_provider_inventory_permission_denied",403);
      if(!response.ok)throw refuse("hostinger_provider_inventory_failed",503);
      const list=records(await boundedBody(response));
      if(new Set(list).size!==list.length)
        throw refuse("hostinger_inventory_duplicate_names",502);
      return Object.freeze({database_names:list,provider_http_status:response.status});
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
  const names=observed?.database_names;
  if(!Array.isArray(names)||names.length>1000||names.some(n=>typeof n!=="string"||!DATABASE.test(n)))
    throw refuse("hostinger_inventory_shape_unverified",502);
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
