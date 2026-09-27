#!/usr/bin/env node
// Read-only diagnostic. This command never applies migrations, grants or provisioning.
import { createHash } from "node:crypto";
import { getPool } from "../db.js";
import { resolveRuntimeEnvironment } from "../runtimeEnvironmentResolver.js";
import { inspectRuntimeIntegrity } from "../runtimeIntegrity.js";
import { inspectDeviceLinkSchema } from "../localManagerSchemaReadiness.js";
import { getRuntimeBootstrapStatus } from "../runtimeBootstrapStatus.js";
import { getLocalManagerWritePool, assertLocalManagerWritePrivilegeReadiness, resolveLocalManagerWriteDbConfig } from "../localManagerWriteAuthority.js";
import { latestLocalManagerWindowsRelease } from "../localManagerReleaseRegistry.js";
import { assertLocalManagerDeviceAuthenticationConfigured } from "../services/localManagerDeviceLinkService.js";
const args = new Map(process.argv.slice(2).map(arg => { const i=arg.indexOf("="); return i<0?[arg,true]:[arg.slice(0,i),arg.slice(i+1)]; }));
const expectedEnvironment=args.get("--expected-environment"), expectedSha=args.get("--expected-sha"), live=args.get("--live")===true;
const report={contract:"mad4b.local-manager-readiness.v1",scope:"local_manager_prerequisites",ready:false,live,checks:{},database_mutation_performed:false,end_to_end_certified:false,secrets_included:false};
let runtimePool,writerPool;
async function check(name,operation) {
  try { report.checks[name]=await operation(); }
  catch(error) { report.checks[name]={ready:false,code:/^[A-Za-z0-9_]{1,100}$/u.test(error?.code||"")?error.code:"readiness_check_failed"}; }
}
try {
  if (!["production","staging"].includes(expectedEnvironment)||!/^[a-f0-9]{40}$/u.test(expectedSha||"")) throw Object.assign(new Error(),{code:"expected_environment_and_exact_sha_required"});
  const runtime=resolveRuntimeEnvironment();
  report.checks.environment={ready:runtime.ok&&runtime.environment_key===expectedEnvironment,environment:runtime.environment_key,branch:runtime.source_branch||null};
  if (!report.checks.environment.ready) throw Object.assign(new Error(),{code:"environment_binding_mismatch"});
  report.checks.integrity=await inspectRuntimeIntegrity({expectedCommitSha:expectedSha});
  report.checks.integrity.ready=report.checks.integrity.verified;
  await check("device_authentication",()=>assertLocalManagerDeviceAuthenticationConfigured());
  await check("writer_configuration",()=>{resolveLocalManagerWriteDbConfig();return {ready:true,runtime_target_bound:true};});
  report.bootstrap_configuration=getRuntimeBootstrapStatus();
  if(live) {
    const fingerprint=createHash("sha256").update(JSON.stringify([expectedEnvironment,String(process.env.DB_HOST||"").trim().toLowerCase(),Number(process.env.DB_PORT)||3306,String(process.env.DB_NAME||"").trim()])).digest("hex");
    if(args.get("--expected-target-sha256")!==fingerprint) throw Object.assign(new Error(),{code:"reviewed_database_target_binding_required"});
    await check("device_link_schema",async()=>{runtimePool=getPool();return inspectDeviceLinkSchema(runtimePool);});
    await check("runtime_identity",async()=>{
      runtimePool ||= getPool();
      const [rows]=await runtimePool.query("SELECT DATABASE() AS db, CURRENT_USER() AS account");
      return {ready:rows.length===1&&rows[0].db===process.env.DB_NAME&&String(rows[0].account).split("@")[0]===process.env.DB_USER};
    });
    await check("writer_privileges",async()=>{writerPool=getLocalManagerWritePool();const result=await assertLocalManagerWritePrivilegeReadiness({pool:writerPool});return {ready:result.ready,generic_runtime_fallback:false};});
    await check("release_registry",async()=>{const release=await latestLocalManagerWindowsRelease({pool:runtimePool||getPool()});return {ready:release.source==="db"&&!release.registry_degraded&&/^[a-f0-9]{64}$/iu.test(release.sha256||""),version:release.version,source:release.source,reason:release.registry_reason};});
  }
  report.ready=live&&Object.values(report.checks).every(result=>result.ready===true);
} catch(error) { report.failure_code=error.code||"readiness_failed"; }
finally { await Promise.allSettled([runtimePool?.end(),writerPool?.end()]); }
console.log(JSON.stringify(report,null,2));
if(!report.ready) process.exitCode=1;
