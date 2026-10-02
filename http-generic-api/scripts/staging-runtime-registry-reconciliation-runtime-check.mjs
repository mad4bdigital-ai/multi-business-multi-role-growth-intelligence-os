import fs from "node:fs";
import { getPool } from "../db.js";
import {
  inspectStagingRuntimeRegistrySnapshot,
  planStagingRuntimeRegistryReconciliation,
  validateStagingRuntimeRegistryPlan
} from "../stagingRuntimeRegistrySnapshot.js";

const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const action=String(args.action||"");
const actualCommit=String(args["actual-commit"]||"").trim().toLowerCase();
const artifactFile="/tmp/mad4b-staging-registry-reconciliation/runtime.registry-reconciliation.sql.gz";
const manifestFile="/tmp/mad4b-staging-registry-reconciliation/staging-schema-bundle-manifest.json";
if(!["plan","precondition","readback","reconcile-readback"].includes(action))throw Object.assign(new Error("Unsupported Staging registry reconciliation runtime action."),{code:"STAGING_REGISTRY_RECONCILIATION_RUNTIME_ACTION_INVALID"});
if(!/^[a-f0-9]{40}$/u.test(actualCommit))throw Object.assign(new Error("An exact Runtime commit is required."),{code:"STAGING_REGISTRY_RECONCILIATION_RUNTIME_COMMIT_REQUIRED"});
const deploymentManifest=JSON.parse(fs.readFileSync("/app/deployment-manifest.json","utf8"));
const deployedCommit=String(deploymentManifest?.commit_sha||"").trim().toLowerCase();
const envCommit=String(process.env.DEPLOY_COMMIT||"").trim().toLowerCase();
if(deploymentManifest?.repository!=="mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"||deploymentManifest?.secrets_included!==false||deployedCommit!==actualCommit||envCommit!==actualCommit){
  throw Object.assign(new Error("Runtime deployment provenance does not match the requested registry reconciliation commit."),{code:"STAGING_REGISTRY_RECONCILIATION_RUNTIME_PROVENANCE_MISMATCH"});
}
if(process.env.NODE_ENV!=="staging"||String(process.env.DEPLOYMENT_ENVIRONMENT||"")!=="staging_local_windows_docker"){
  throw Object.assign(new Error("Registry reconciliation runtime check is restricted to local Staging."),{code:"STAGING_REGISTRY_RECONCILIATION_RUNTIME_TARGET_FORBIDDEN"});
}
const manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8"));
if(manifest?.contract!=="mad4b.staging.schema-bundle-output.v1"||manifest?.source_commit!==actualCommit||manifest?.source_repository!=="mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"||manifest?.production_accessed!==false||manifest?.provider_accessed!==false||manifest?.secrets_included!==false){
  throw Object.assign(new Error("Same-cycle schema bundle manifest is invalid for registry reconciliation."),{code:"STAGING_REGISTRY_RECONCILIATION_BUNDLE_MANIFEST_INVALID"});
}
const metadata=manifest.canonical_registry_reconciliation_snapshot;
const gzip=fs.readFileSync(artifactFile);
const executor=getPool();
async function readPlan(){
  let input="";
  for await(const chunk of process.stdin){
    input+=chunk;
    if(input.length>2*1024*1024)throw Object.assign(new Error("Registry reconciliation plan input exceeds bounded size."),{code:"STAGING_REGISTRY_RECONCILIATION_PLAN_TOO_LARGE"});
  }
  const parsed=JSON.parse(input.replace(/^\uFEFF/u,"").trim());
  return parsed?.plan||parsed;
}
try{
  if(action==="plan"){
    const plan=await planStagingRuntimeRegistryReconciliation({executor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:actualCommit,actual_commit:actualCommit});
    process.stdout.write(JSON.stringify({ok:true,action,plan,runtime_provenance:{repository:deploymentManifest.repository,commit_sha:deployedCommit,branch:deploymentManifest.branch||null,secrets_included:false},database_mutation_performed:false,production_mutation_performed:false,provider_mutation_performed:false,secrets_included:false})+"\n");
  }else{
    const plan=await readPlan();
    validateStagingRuntimeRegistryPlan({plan,actual_commit:actualCommit,snapshot_gzip:gzip,snapshot_metadata:metadata});
    const inspection=await inspectStagingRuntimeRegistrySnapshot({executor,snapshot_gzip:gzip,snapshot_metadata:metadata,expected_commit:actualCommit});
    if(action==="precondition"){
      const unchanged=inspection.status==="missing_rows"&&inspection.conflict_count===0&&inspection.precondition_fingerprint===plan.precondition_fingerprint
        &&JSON.stringify([...inspection.missing_statement_sha256].sort())===JSON.stringify([...(plan.missing_statement_sha256||[])].sort());
      if(!unchanged)throw Object.assign(new Error("Live Runtime registry precondition changed after planning."),{code:"STAGING_REGISTRY_RECONCILIATION_PRECONDITION_CHANGED",details:{status:inspection.status,missing_count:inspection.missing_count,conflict_count:inspection.conflict_count}});
      process.stdout.write(JSON.stringify({contract:"mad4b.staging-runtime-registry-reconciliation-precondition.v1",status:"verified_missing_rows",plan_sha256:plan.plan_sha256,missing_count:inspection.missing_count,conflict_count:0,precondition_fingerprint:inspection.precondition_fingerprint,mutation_performed:false,secrets_included:false})+"\n");
    }else if(action==="readback"){
      if(inspection.status!=="already_satisfied"||inspection.missing_count!==0||inspection.conflict_count!==0)throw Object.assign(new Error("Runtime registry postcondition is not satisfied."),{code:"STAGING_REGISTRY_RECONCILIATION_POSTCONDITION_UNVERIFIED",details:{status:inspection.status,missing_count:inspection.missing_count,conflict_count:inspection.conflict_count,extra_count:inspection.extra_count}});
      process.stdout.write(JSON.stringify({contract:"mad4b.staging-runtime-registry-reconciliation-readback.v1",status:"already_satisfied",plan_sha256:plan.plan_sha256,exact_count:inspection.exact_count,extra_count:inspection.extra_count,readback_verified:true,mutation_performed:false,secrets_included:false})+"\n");
    }else{
      const unchanged=inspection.status==="missing_rows"&&inspection.conflict_count===0&&inspection.precondition_fingerprint===plan.precondition_fingerprint
        &&JSON.stringify([...inspection.missing_statement_sha256].sort())===JSON.stringify([...(plan.missing_statement_sha256||[])].sort());
      const satisfied=inspection.status==="already_satisfied"&&inspection.missing_count===0&&inspection.conflict_count===0;
      process.stdout.write(JSON.stringify({contract:"mad4b.staging-runtime-registry-reconciliation-reconcile-readback.v1",status:satisfied?"reconciled_succeeded":unchanged?"reconciled_no_mutation":"reconciliation_required",plan_sha256:plan.plan_sha256,missing_count:inspection.missing_count,conflict_count:inspection.conflict_count,extra_count:inspection.extra_count,precondition_unchanged:unchanged,postcondition_satisfied:satisfied,reconciliation_evidence_hash:inspection.precondition_fingerprint,mutation_performed:false,secrets_included:false})+"\n");
    }
  }
}finally{
  await executor.end?.();
}
