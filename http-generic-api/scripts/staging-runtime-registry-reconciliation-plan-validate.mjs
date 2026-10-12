import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStagingRuntimeRegistryPlan } from "../stagingRuntimeRegistrySnapshot.js";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..");
const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const planFile=path.resolve(String(args["plan-file"]||""));
const actualCommit=String(args["actual-commit"]||"").trim().toLowerCase();
if(!args["plan-file"]||!fs.existsSync(planFile)||fs.statSync(planFile).size>2*1024*1024)throw Object.assign(new Error("A bounded immutable registry reconciliation plan file is required."),{code:"STAGING_REGISTRY_RECONCILIATION_PLAN_FILE_REQUIRED"});
if(!/^[a-f0-9]{40}$/u.test(actualCommit))throw Object.assign(new Error("An exact commit is required."),{code:"STAGING_REGISTRY_RECONCILIATION_RUNTIME_COMMIT_REQUIRED"});
const bundleDir=path.join(repoRoot,"autopilot-portable-staging","staging-db-dumps");
const manifestFile=path.join(bundleDir,"staging-schema-bundle-manifest.json");
const artifactFile=path.join(bundleDir,"runtime.registry-reconciliation.sql.gz");
if(!fs.existsSync(manifestFile)||!fs.existsSync(artifactFile))throw Object.assign(new Error("Same-cycle registry reconciliation bundle is missing."),{code:"STAGING_REGISTRY_RECONCILIATION_BUNDLE_MISSING"});
const manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8").replace(/^\uFEFF/u,""));
if(manifest?.contract!=="mad4b.staging.schema-bundle-output.v1"||manifest?.source_commit!==actualCommit||manifest?.source_repository!=="mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"||manifest?.production_accessed!==false||manifest?.provider_accessed!==false||manifest?.secrets_included!==false){
  throw Object.assign(new Error("Same-cycle schema bundle manifest is invalid."),{code:"STAGING_REGISTRY_RECONCILIATION_BUNDLE_MANIFEST_INVALID"});
}
const parsed=JSON.parse(fs.readFileSync(planFile,"utf8").replace(/^\uFEFF/u,""));
const plan=parsed?.plan||parsed;
const validation=validateStagingRuntimeRegistryPlan({plan,actual_commit:actualCommit,snapshot_gzip:fs.readFileSync(artifactFile),snapshot_metadata:manifest.canonical_registry_reconciliation_snapshot});
process.stdout.write(JSON.stringify({ok:true,plan,validation:{...validation,snapshot:undefined},bundle_manifest_file:path.relative(repoRoot,manifestFile).replaceAll("\\","/"),artifact_file:path.relative(repoRoot,artifactFile).replaceAll("\\","/"),database_mutation_performed:false,production_mutation_performed:false,provider_mutation_performed:false,secrets_included:false})+"\n");
