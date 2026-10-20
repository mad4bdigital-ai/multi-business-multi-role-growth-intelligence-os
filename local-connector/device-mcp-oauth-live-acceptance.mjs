import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
// Live, externally authorized dual-client acceptance. Read-only MCP discovery and exact-bound devices_list call.
// Explicit --live requires two real OAuth client tokens from the authorized host.
// No secrets, tokens, user names, or JWT claims are logged or persisted.
const ISSUER = "https://dev.mad4b.com";
const RESOURCE = "https://connector.mad4b.com/mcp/device";
const META = "https://connector.mad4b.com/.well-known/oauth-protected-resource/mcp/device";
const AUTH = "https://dev.mad4b.com/.well-known/oauth-authorization-server";

export function validateClientInput({ a, b, aId, bId, deviceId, tenantId }) {
  if (![a,b,aId,bId,deviceId,tenantId].every(v=>typeof v==="string"&&v.length>0) ||
      a===b || aId===bId || !/^[a-z0-9][a-z0-9_-]{1,127}$/i.test(deviceId))
    throw new Error("two_distinct_authorized_clients_required");
  const claims = [a,b].map(token=>{
    const parts=token.split(".");
    if(parts.length!==3)throw new Error("invalid_token_format");
    let obj;
    try {obj=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8")); }
    catch { throw new Error("invalid_token_claims"); }
    if(obj.iss!==ISSUER || obj.aud!==RESOURCE || obj.device_id!==deviceId ||
       obj.tenant_id!==tenantId || obj.environment!=="staging" ||
       !Number.isSafeInteger(obj.exp) || obj.exp<=Math.floor(Date.now()/1000)+30)
      throw new Error("token_scope_or_lifetime_mismatch");
    return obj;
  });
  if((claims[0].azp||claims[0].client_id)!==aId ||
     (claims[1].azp||claims[1].client_id)!==bId)
    throw new Error("oauth_client_binding_mismatch");
  return true;
}
async function request(fetchImpl, url, method="GET", token=null, body=null) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try {
    const result=await fetchImpl(url,{method,redirect:"manual",
      headers:{"Cache-Control":"no-store","Accept":"application/json",
        ...(token?{"Authorization":"Bearer "+token}:{}),
        ...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
    if(!result.ok || result.status>=300)throw new Error("oauth_http_preflight_failed");
    const text=await result.text();
    if(text.length>262144)throw new Error("oauth_response_too_large");
    try{return JSON.parse(text);}
    catch {throw new Error("oauth_response_not_json");}
  } finally {clearTimeout(timeout);}
}
export async function verifyDiscovery(fetchImpl=fetch) {
  const [resource,auth]=await Promise.all([request(fetchImpl,META),request(fetchImpl,AUTH)]);
  if(resource.resource!==RESOURCE ||
     !Array.isArray(resource.authorization_servers) ||
     !resource.authorization_servers.includes(ISSUER) ||
     auth.issuer!==ISSUER ||
     typeof auth.authorization_endpoint!=="string" ||
     !auth.authorization_endpoint.startsWith(ISSUER+"/") ||
     typeof auth.token_endpoint!=="string" ||
     !auth.token_endpoint.startsWith(ISSUER+"/") ||
     !Array.isArray(auth.code_challenge_methods_supported) ||
     !auth.code_challenge_methods_supported.includes("S256"))
    throw new Error("oauth_resource_pkce_discovery_mismatch");
  return {resource_bound:true,issuer_bound:true,pkce_s256:true};
}
export async function verifyTwoClients(options,{fetchImpl=fetch}={}) {
  validateClientInput(options);
  await verifyDiscovery(fetchImpl);
  const verify=async(token)=>{
    const init=await request(fetchImpl,RESOURCE,"POST",token,{
      jsonrpc:"2.0",id:1,method:"initialize",
      params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"mad4b-acceptance",version:"1.0"}}
    });
    if(!init || init.jsonrpc!=="2.0" || !init.result || init.error)
      throw new Error("mcp_init_rejected");
    const tools=await request(fetchImpl,RESOURCE,"POST",token,{
      jsonrpc:"2.0",id:2,method:"tools/list",params:{}
    });
    if(!Array.isArray(tools?.result?.tools) || tools.error)
      throw new Error("mcp_scoped_tool_discovery_rejected");
    const names=tools.result.tools.map(x=>x?.name);
    if(!names.includes("devices_list"))
      throw new Error("mcp_device_status_scope_missing");
    // The resource must actually return the same single authorized device for
    // both independent clients. Discovery alone cannot prove device routing.
    const called=await request(fetchImpl,RESOURCE,"POST",token,{
      jsonrpc:"2.0",id:3,method:"tools/call",
      params:{name:"devices_list",arguments:{}}
    });
    const item=called?.result?.content?.[0];
    let result;
    try {
      if(called?.jsonrpc!=="2.0" || called.error || called.result?.isError!==false ||
         item?.type!=="text" || typeof item.text!=="string")
        throw new Error("invalid rpc response");
      result=JSON.parse(item.text);
    } catch {
      throw new Error("mcp_readonly_device_binding_unverified");
    }
    if(result?.ok!==true || result.secrets_included!==false ||
       !Array.isArray(result.devices) || result.devices.length!==1 ||
       result.devices[0]?.device_id!==options.deviceId ||
       result.devices[0]?.tenant_id!==options.tenantId ||
       result.devices[0]?.environment!=="staging")
      throw new Error("mcp_readonly_device_binding_unverified");
    return names.length;
  };
  const [a,b]=await Promise.all([verify(options.a),verify(options.b)]);
  // Only counts and boolean acceptance evidence are emitted; never token data.
  return {contract:"mad4b.device-mcp.two-real-clients-acceptance.v1",
    success:true,client_count:2,device_binding_verified:true,
    readonly_tools_call_verified:true,
    client_a_tool_count:a,client_b_tool_count:b,
    secrets_included:false,production_mutation:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const live=process.argv.includes("--live");
  (async()=>{
    const discovery=await verifyDiscovery();
    if(!live) {
      console.log(JSON.stringify({contract:"mad4b.device-mcp.oauth-public-preflight.v1",
        ...discovery,live_client_acceptance:false,secrets_included:false}));
      return;
    }
    // Operator-controlled, bounded stdin: do not register OAuth bearer as
    // process environment/config catalog, CLI arguments, repository files, or logs.
    // Invoke only on an authorized Windows client with an ephemeral private pipe.
    if(process.stdin.isTTY)throw new Error("private_stdin_required");
    const raw=readFileSync(0,{encoding:"utf8"});
    if(raw.length>32768)throw new Error("acceptance_input_too_large");
    const input=JSON.parse(raw);
    const result=await verifyTwoClients(input);
    console.log(JSON.stringify(result));
  })().catch(e=>{
    console.error(JSON.stringify({contract:"mad4b.device-mcp.oauth-acceptance.v1",
      success:false,reason:"oauth_acceptance_not_verified",
      secrets_included:false}));
    process.exitCode=1;
  });
}
