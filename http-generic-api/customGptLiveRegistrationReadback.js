import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import YAML from "yaml";

const apiRoot=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(apiRoot,"..");
const manifestPath=path.join(apiRoot,"openapi","generated","custom-gpt-registration-manifest.json");
const surfaceRegistryPath=path.join(repoRoot,"canonicals","openapi","custom-gpt-surfaces.yaml");
const SHA64=/^[a-f0-9]{64}$/u;
const SHA40=/^[a-f0-9]{40}$/u;

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value&&typeof value==="object") return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"));}
function collectOperationIds(doc){
  const ids=[];
  for(const item of Object.values(doc?.paths||{})){
    for(const method of ["get","put","post","delete","patch","head","options","trace"]){
      const id=item?.[method]?.operationId;
      if(id) ids.push(String(id));
    }
  }
  return ids.sort();
}
function registrationSemanticFingerprint(entry){
  return sha256(JSON.stringify(stable({
    live_registration_set:entry.live_registration_set,
    action_slot:entry.action_slot,
    environment:entry.environment,
    server_uri:entry.server_uri,
    auth_profile:entry.auth_profile,
    operation_ids:[...(entry.operation_ids||[])].sort(),
    registration_operation_manifest_sha256:entry.registration_operation_manifest_sha256||entry.operation_manifest_sha256||null,
    source_openapi_sha256:entry.source_openapi_sha256||null,
    source_manifest_sha256:entry.source_manifest_sha256||null,
  })));
}
function expectedRows(){
  const manifest=readJson(manifestPath);
  if(manifest.contract!=="mad4b.custom-gpt-registration-manifest.v1") throw new Error("Expected registration manifest contract is invalid.");
  const registry=YAML.parse(fs.readFileSync(surfaceRegistryPath,"utf8"));
  return manifest.registrations
    .filter(row=>row.environment==="staging" && String(row.registration_set||"").startsWith("admin_"))
    .map(row=>{
      const surface=registry.surfaces?.[row.surface];
      if(!surface?.output_file) throw new Error(`Expected surface output missing: ${row.surface}`);
      const schemaPath=path.join(apiRoot,surface.output_file);
      const doc=YAML.parse(fs.readFileSync(schemaPath,"utf8"));
      const contract=doc["x-mad4b-registration-contract"]||{};
      const operationIds=collectOperationIds(doc);
      const registrationHash=contract.registration_operation_manifest_sha256||contract.operation_manifest_sha256||row.registration_operation_manifest_sha256||row.operation_manifest_sha256;
      const surfaceHash=contract.surface_operation_manifest_sha256||doc["x-custom-gpt-generation"]?.operation_manifest?.sha256||row.surface_operation_manifest_sha256||null;
      if(!SHA64.test(String(registrationHash||""))) throw new Error(`Expected registration operation hash missing: ${row.surface}`);
      return {
        surface:row.surface,
        registration_set:row.registration_set,
        live_registration_set:row.live_registration_set,
        action_slot:row.action_slot,
        environment:row.environment,
        server_uri:row.server_uri,
        auth_profile:row.auth_profile,
        operation_ids:operationIds,
        operation_count:operationIds.length,
        surface_operation_manifest_sha256:surfaceHash,
        registration_operation_manifest_sha256:registrationHash,
        source_openapi_sha256:row.source_openapi_sha256,
        source_manifest_sha256:row.source_manifest_sha256,
        schema_sha256:row.schema_sha256,
      };
    });
}
function normalizeObserved(row){
  return {
    surface:String(row.surface||""),
    registration_set:String(row.registration_set||""),
    live_registration_set:String(row.live_registration_set||row.registration_set||""),
    action_slot:String(row.action_slot||""),
    environment:String(row.environment||""),
    server_uri:String(row.server_uri||""),
    auth_profile:String(row.auth_profile||""),
    operation_ids:[...(row.operation_ids||[])].map(String).sort(),
    operation_count:Number(row.operation_count??(row.operation_ids||[]).length),
    surface_operation_manifest_sha256:row.surface_operation_manifest_sha256||null,
    registration_operation_manifest_sha256:row.registration_operation_manifest_sha256||row.operation_manifest_sha256||null,
    source_openapi_sha256:row.source_openapi_sha256||null,
    source_manifest_sha256:row.source_manifest_sha256||null,
    schema_sha256:row.schema_sha256||null,
  };
}

export function verifyCustomGptLiveRegistrationReadback({observed,expectedHeadSha}={}){
  if(!observed||observed.contract!=="mad4b.custom-gpt-live-registration-readback.v1") throw new Error("Observed live registration readback contract is invalid.");
  if(!SHA40.test(String(expectedHeadSha||""))) throw new Error("expectedHeadSha must be an exact lowercase 40-character SHA.");
  if(String(observed.exact_head_sha||"")!==expectedHeadSha) throw new Error("Observed live registration evidence is stale for exact head.");
  if(observed.provider_mutation_performed!==false||observed.production_mutation_performed!==false) throw new Error("Observed registration evidence is not read-only.");
  const expected=expectedRows();
  const observedRows=(observed.registrations||[]).map(normalizeObserved);
  const bySet=new Map(observedRows.map(row=>[row.registration_set,row]));
  const checks=[];
  for(const exp of expected){
    const obs=bySet.get(exp.registration_set);
    const fields=["live_registration_set","action_slot","environment","server_uri","auth_profile"];
    for(const field of fields) checks.push({registration_set:exp.registration_set,field,ok:Boolean(obs)&&obs[field]===exp[field],expected:exp[field],observed:obs?.[field]??null});
    checks.push({registration_set:exp.registration_set,field:"operation_ids",ok:Boolean(obs)&&JSON.stringify(obs.operation_ids)===JSON.stringify(exp.operation_ids),expected:exp.operation_ids,observed:obs?.operation_ids??null});
    checks.push({registration_set:exp.registration_set,field:"operation_count",ok:Boolean(obs)&&obs.operation_count===exp.operation_count,expected:exp.operation_count,observed:obs?.operation_count??null});
    if(obs?.registration_operation_manifest_sha256){
      checks.push({registration_set:exp.registration_set,field:"registration_operation_manifest_sha256",ok:obs.registration_operation_manifest_sha256===exp.registration_operation_manifest_sha256,expected:exp.registration_operation_manifest_sha256,observed:obs.registration_operation_manifest_sha256});
    }
    if(obs?.surface_operation_manifest_sha256&&exp.surface_operation_manifest_sha256){
      checks.push({registration_set:exp.registration_set,field:"surface_operation_manifest_sha256",ok:obs.surface_operation_manifest_sha256===exp.surface_operation_manifest_sha256,expected:exp.surface_operation_manifest_sha256,observed:obs.surface_operation_manifest_sha256});
    }
    checks.push({registration_set:exp.registration_set,field:"semantic_fingerprint",ok:Boolean(obs)&&registrationSemanticFingerprint(obs)===registrationSemanticFingerprint(exp),expected:registrationSemanticFingerprint(exp),observed:obs?registrationSemanticFingerprint(obs):null});
  }
  const unexpected=observedRows.filter(row=>!expected.some(exp=>exp.registration_set===row.registration_set));
  const failed=checks.filter(check=>!check.ok);
  return {
    contract:"mad4b.custom-gpt-live-registration-parity-evidence.v1",
    exact_head_sha:expectedHeadSha,
    ready:failed.length===0&&unexpected.length===0&&expected.length===observedRows.length,
    expected_registration_count:expected.length,
    observed_registration_count:observedRows.length,
    failed_check_count:failed.length,
    unexpected_registration_sets:unexpected.map(row=>row.registration_set).sort(),
    checks,
    safety:{provider_mutation_performed:false,production_mutation_performed:false,database_mutation_performed:false,secrets_included:false},
  };
}

export function loadObservedFile(file){return readJson(path.resolve(file));}
