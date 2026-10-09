import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRecoveryCapabilityRegistry} from "./recoveryOrchestrator.js";
import {buildRecoveryOrchestratorRoutes,RECOVERY_ORCHESTRATOR_DISCOVERY_PATH}
  from "./routes/recoveryOrchestratorRoutes.js";

function routeFrom(registry) {
  const auth=(req,res,next)=>{if(req?.auth?.is_admin)return next();
    return res.status(403).json({ok:false});};
  const router=buildRecoveryOrchestratorRoutes({
    requireBackendApiKey:auth,requireAdminPrincipal:auth,
    recoveryOrchestratorRegistry:registry,
  });
  const layer=router.stack.find(x=>x.route?.path===RECOVERY_ORCHESTRATOR_DISCOVERY_PATH);
  assert(layer);
  assert.deepEqual(layer.route.methods,{get:true});
  return layer.route.stack.at(-1).handle;
}
function response(){
  return {code:null,body:null,status(n){this.code=n;return this;},
    json(value){this.body=value;return this;}};
}
test("a read-only server-owned capability catalog is mounted with admin authentication",()=>{
  const routes=readFileSync(new URL("./routes/index.js",import.meta.url),"utf8");
  assert.match(routes,/buildRecoveryOrchestratorRoutes\(\{ \.\.\.deps, requireAdminPrincipal \}\)/);
  const handler=routeFrom(createRecoveryCapabilityRegistry());
  const res=response();
  handler({auth:{is_admin:true}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.contract,"mad4b.recovery-orchestrator-capability-discovery.v1");
  assert.deepEqual(res.body.capabilities,[]);
  assert.equal(res.body.mutation_endpoint_registered,false);
  assert.equal(res.body.production_mutation_authorized,false);
  assert.equal(res.body.execution_authorized,false);
});
test("server-injected adapter descriptors expose neither function code nor execution secrets",()=>{
  const registry=createRecoveryCapabilityRegistry([{
    id:"hostinger.website",provider_id:"hostinger",resource_kind:"website",
    environments:["staging"],
    operations:[{key:"inspect_schema",risk:"read_only",requires_independent_readback:true}],
    inspect:async()=>({read_only:true,mutation_performed:false,secrets_included:false,
      state_fingerprint:"f".repeat(64)}),
  }]);
  const handler=routeFrom(registry),res=response();
  handler({auth:{is_admin:true}},res);
  assert.equal(res.body.capabilities[0].provider_id,"hostinger");
  assert.equal(res.body.capabilities[0].default_execution_enabled,false);
  assert.equal(res.body.capabilities[0].credential_intake,"server_managed_only");
  assert.equal(JSON.stringify(res.body).includes("inspect:async"),false);
});
test("absent registry fails safely and the router exposes GET only",()=>{
  const routes=buildRecoveryOrchestratorRoutes({
    requireBackendApiKey:(req,res,next)=>next(),
    requireAdminPrincipal:(req,res,next)=>next()
  });
  assert.equal(routes.stack.length,1);
  assert.equal(routes.stack[0].route.path,RECOVERY_ORCHESTRATOR_DISCOVERY_PATH);
  assert.deepEqual(routes.stack[0].route.methods,{get:true});
  const resp=response();routes.stack[0].route.stack.at(-1).handle({},resp);
  assert.deepEqual(resp.body.capabilities,[]);
});
