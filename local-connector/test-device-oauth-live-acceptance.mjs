import assert from "node:assert/strict";
import test from "node:test";
import { validateClientInput, verifyDiscovery, verifyTwoClients } from "./device-mcp-oauth-live-acceptance.mjs";

const issuer="https://dev.mad4b.com",resource="https://connector.mad4b.com/mcp/device";
const encoded=(c)=>"synthetic."+Buffer.from(JSON.stringify(c)).toString("base64url")+".synthetic";
function clients(){
  const common={iss:issuer,aud:resource,device_id:"device-a",tenant_id:"tenant-a",
    environment:"staging",exp:Math.floor(Date.now()/1000)+500};
  return {a:encoded({...common,azp:"client-a"}),b:encoded({...common,azp:"client-b"}),
    aId:"client-a",bId:"client-b",deviceId:"device-a",tenantId:"tenant-a"};
}
function mocked({wrongDevice=false,omitStatusTool=false,rpcDenied=false}={}){
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const payload=options.body?JSON.parse(options.body):null;
    calls.push({url,method:options.method||"GET",redirect:options.redirect,
      rpcMethod:payload?.method,tool:payload?.params?.name});
    let value;
    if(url.endsWith("/.well-known/oauth-protected-resource/mcp/device")){
      value={resource,authorization_servers:[issuer]};
    } else if(url.endsWith("/.well-known/oauth-authorization-server")){
      value={issuer,authorization_endpoint:issuer+"/oauth/authorize",
        token_endpoint:issuer+"/oauth/token",code_challenge_methods_supported:["S256"]};
    } else if(url===resource){
      if(!options.headers?.Authorization?.startsWith("Bearer synthetic."))
        throw Error("bearer absent");
      const body=payload;
      if(body.method==="initialize")value={jsonrpc:"2.0",id:1,result:{protocolVersion:"2025-03-26"}};
      else if(body.method==="tools/list")value={jsonrpc:"2.0",id:2,result:{tools:
        omitStatusTool?[{name:"devices_health"}]:[{name:"devices_list"},{name:"devices_health"}]}};
      else if(body.method==="tools/call"&&body.params?.name==="devices_list"){
        value={jsonrpc:"2.0",id:3,result:{
          isError:rpcDenied,
          content:[{type:"text",text:JSON.stringify({
            ok:true,devices:[{device_id:wrongDevice?"unrelated-device":"device-a",
              tenant_id:"tenant-a",environment:"staging"}],secrets_included:false
          })}]
        }};
      }
      else throw Error("unexpected method");
    } else throw Error("unexpected origin");
    return {ok:true,status:200,text:async()=>JSON.stringify(value)};
  };
  return {fetchImpl,calls};
}
test("synthetic two-client acceptance verifies pinned metadata, scoped tools and exact single-device tools/call",async()=>{
  const mock=mocked();
  assert.deepEqual(await verifyDiscovery(mock.fetchImpl),
    {resource_bound:true,issuer_bound:true,pkce_s256:true});
  const output=await verifyTwoClients(clients(),{fetchImpl:mock.fetchImpl});
  assert.equal(output.success,true);
  assert.equal(output.client_count,2);
  assert.equal(output.client_a_tool_count,2);
  assert.equal(output.readonly_tools_call_verified,true);
  assert(!JSON.stringify(output).includes("synthetic."));
  assert(mock.calls.every(x=>x.redirect==="manual"));
  assert.equal(mock.calls.filter(x=>x.method==="POST").length,6);
  assert.deepEqual(mock.calls.filter(x=>x.rpcMethod==="tools/call").map(x=>x.tool),
    ["devices_list","devices_list"]);
});
test("live acceptance fails closed on wrong device, missing status grant and MCP errors",async()=>{
  await assert.rejects(verifyTwoClients(clients(),{fetchImpl:mocked({wrongDevice:true}).fetchImpl}),
    /mcp_readonly_device_binding_unverified/);
  await assert.rejects(verifyTwoClients(clients(),{fetchImpl:mocked({omitStatusTool:true}).fetchImpl}),
    /mcp_device_status_scope_missing/);
  await assert.rejects(verifyTwoClients(clients(),{fetchImpl:mocked({rpcDenied:true}).fetchImpl}),
    /mcp_readonly_device_binding_unverified/);
});
test("client consent and scope cannot be substituted",()=>{
  const sample=clients();
  assert.throws(()=>validateClientInput({...sample,b:sample.a}),/two_distinct_authorized_clients_required/);
  assert.throws(()=>validateClientInput({...sample,aId:sample.bId}),/two_distinct_authorized_clients_required/);
  assert.throws(()=>validateClientInput({...sample,deviceId:"device-b"}),/token_scope_or_lifetime_mismatch/);
  assert.throws(()=>validateClientInput({...sample,bId:"client-x"}),/oauth_client_binding_mismatch/);
  assert.throws(()=>validateClientInput({...sample,a:"not-a-jwt"}),/invalid_token_format/);
});
test("invalid PKCE metadata is fail-closed",async()=>{
  const m=mocked();
  const fetchImpl=async(url,options)=>{
    const response=await m.fetchImpl(url,options);
    if(url.endsWith("/.well-known/oauth-authorization-server")){
      const original=JSON.parse(await response.text());
      return {...response,text:async()=>JSON.stringify({...original,code_challenge_methods_supported:["plain"]})};
    }
    return response;
  };
  await assert.rejects(verifyDiscovery(fetchImpl),/oauth_resource_pkce_discovery_mismatch/);
});
