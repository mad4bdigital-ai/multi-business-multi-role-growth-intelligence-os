import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRegistryPlanStatements, validateStagingRuntimeRegistryPlan } from "../stagingRuntimeRegistrySnapshot.js";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..");
const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const planFile=path.resolve(String(args["plan-file"]||""));
const outputFile=path.resolve(String(args["output-file"]||""));
const actualCommit=String(args["actual-commit"]||"").trim().toLowerCase();
if(!args["plan-file"]||!fs.existsSync(planFile)||fs.statSync(planFile).size>2*1024*1024)throw Object.assign(new Error("A bounded immutable registry reconciliation plan file is required."),{code:"STAGING_REGISTRY_RECONCILIATION_PLAN_FILE_REQUIRED"});
if(!args["output-file"])throw Object.assign(new Error("A materialized SQL output file is required."),{code:"STAGING_REGISTRY_RECONCILIATION_SQL_OUTPUT_REQUIRED"});
if(!/^[a-f0-9]{40}$/u.test(actualCommit))throw Object.assign(new Error("An exact commit is required."),{code:"STAGING_REGISTRY_RECONCILIATION_RUNTIME_COMMIT_REQUIRED"});
const bundleDir=path.join(repoRoot,"autopilot-portable-staging","staging-db-dumps");
const manifest=JSON.parse(fs.readFileSync(path.join(bundleDir,"staging-schema-bundle-manifest.json"),"utf8").replace(/^\uFEFF/u,""));
const gzip=fs.readFileSync(path.join(bundleDir,"runtime.registry-reconciliation.sql.gz"));
const parsed=JSON.parse(fs.readFileSync(planFile,"utf8").replace(/^\uFEFF/u,""));
const plan=parsed?.plan||parsed;
validateStagingRuntimeRegistryPlan({plan,actual_commit:actualCommit,snapshot_gzip:gzip,snapshot_metadata:manifest.canonical_registry_reconciliation_snapshot});
const selected=resolveRegistryPlanStatements({plan,actual_commit:actualCommit,snapshot_gzip:gzip,snapshot_metadata:manifest.canonical_registry_reconciliation_snapshot});
if(selected.length!==plan.missing_count||selected.length<1)throw Object.assign(new Error("Materialized registry statement count disagrees with immutable plan."),{code:"STAGING_REGISTRY_RECONCILIATION_STATEMENT_COUNT_MISMATCH"});
const sql=[
  "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;",
  "START TRANSACTION;",
  ...selected.map((item)=>item.statement),
  "COMMIT;"
].join("\n")+"\n";
if(/(^|\n)\s*(?:UPDATE|DELETE|REPLACE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/iu.test(sql))throw Object.assign(new Error("Materialized registry repair SQL contains a forbidden mutation class."),{code:"STAGING_REGISTRY_RECONCILIATION_MATERIALIZATION_FORBIDDEN"});
fs.mkdirSync(path.dirname(outputFile),{recursive:true});
fs.writeFileSync(outputFile,sql,{encoding:"utf8",flag:"wx",mode:0o600});
process.stdout.write(JSON.stringify({ok:true,output_file:outputFile,plan_sha256:plan.plan_sha256,statement_count:selected.length,sql_bytes:Buffer.byteLength(sql),database_mutation_performed:false,production_mutation_performed:false,provider_mutation_performed:false,secrets_included:false})+"\n");
