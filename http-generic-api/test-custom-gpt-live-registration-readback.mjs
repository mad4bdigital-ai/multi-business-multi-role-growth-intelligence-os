import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {fileURLToPath} from "node:url";
import {verifyCustomGptLiveRegistrationReadback} from "./customGptLiveRegistrationReadback.js";

const apiRoot=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(apiRoot,"openapi","generated","custom-gpt-registration-manifest.json"),"utf8"));
const registry=YAML.parse(fs.readFileSync(path.join(apiRoot,"..","canonicals","openapi","custom-gpt-surfaces.yaml"),"utf8"));
const exactHead="a".repeat(40);
const registrations=manifest.registrations.filter(row=>row.environment==="staging"&&String(row.registration_set).startsWith("admin_")).map(row=>{
  const surface=registry.surfaces[row.surface];
  const doc=YAML.parse(fs.readFileSync(path.join(apiRoot,surface.output_file),"utf8"));
  const ids=[];
  for(const item of Object.values(doc.paths||{})) for(const method of ["get","put","post","delete","patch","head","options","trace"]) if(item?.[method]?.operationId) ids.push(String(item[method].operationId));
  const contract=doc["x-mad4b-registration-contract"]||{};
  return {
    surface:row.surface,
    registration_set:row.registration_set,
    live_registration_set:row.live_registration_set,
    action_slot:row.action_slot,
    environment:row.environment,
    server_uri:row.server_uri,
    auth_profile:row.auth_profile,
    operation_ids:ids.sort(),
    operation_count:ids.length,
    surface_operation_manifest_sha256:contract.surface_operation_manifest_sha256||doc["x-custom-gpt-generation"]?.operation_manifest?.sha256||null,
    registration_operation_manifest_sha256:contract.registration_operation_manifest_sha256||contract.operation_manifest_sha256||row.registration_operation_manifest_sha256||row.operation_manifest_sha256,
    source_openapi_sha256:row.source_openapi_sha256,
    source_manifest_sha256:row.source_manifest_sha256,
    schema_sha256:row.schema_sha256,
  };
});
const observed={contract:"mad4b.custom-gpt-live-registration-readback.v1",exact_head_sha:exactHead,registrations,provider_mutation_performed:false,production_mutation_performed:false};
const ready=verifyCustomGptLiveRegistrationReadback({observed,expectedHeadSha:exactHead});
assert.equal(ready.ready,true);
assert.equal(ready.failed_check_count,0);
assert.equal(ready.expected_registration_count,registrations.length);

const drift=structuredClone(observed);
drift.registrations[0].operation_ids=[...drift.registrations[0].operation_ids,"unexpectedOperation"].sort();
drift.registrations[0].operation_count+=1;
const rejected=verifyCustomGptLiveRegistrationReadback({observed:drift,expectedHeadSha:exactHead});
assert.equal(rejected.ready,false);
assert.ok(rejected.failed_check_count>=2);

assert.throws(()=>verifyCustomGptLiveRegistrationReadback({observed:{...observed,exact_head_sha:"b".repeat(40)},expectedHeadSha:exactHead}),/stale for exact head/);
assert.throws(()=>verifyCustomGptLiveRegistrationReadback({observed:{...observed,provider_mutation_performed:true},expectedHeadSha:exactHead}),/not read-only/);
console.log("Custom GPT live registration readback verifier tests passed");
