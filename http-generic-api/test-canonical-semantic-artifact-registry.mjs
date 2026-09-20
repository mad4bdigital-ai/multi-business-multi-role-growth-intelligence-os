import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {splitStatements} from "./scripts/staging-sql-parser.mjs";
const apiRoot=path.dirname(fileURLToPath(import.meta.url));
const registry=JSON.parse(fs.readFileSync(new URL("./config/canonical-semantic-artifacts.json",import.meta.url),"utf8"));
assert.equal(registry.contract,"mad4b.canonical-semantic-artifacts.v1");assert.equal(registry.production_apply_allowed,false);assert.equal(registry.provider_apply_allowed,false);
const keys=new Set(registry.artifacts.map((item)=>item.artifact_key));assert.equal(keys.size,registry.artifacts.length);
for(const artifact of registry.artifacts){
  assert.match(artifact.artifact_key,/^[a-z][a-z0-9_]+$/u);assert.equal(artifact.target_role,"runtime");assert.equal(artifact.production_apply_allowed,false);assert.equal(artifact.provider_apply_allowed,false);
  assert.equal(artifact.caller_sql_forbidden,true);assert.equal(artifact.caller_target_forbidden,true);
  if(artifact.source_kind==="repository_file"){
    const file=path.resolve(apiRoot,artifact.source_file);const bytes=fs.readFileSync(file);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),artifact.sha256,`${artifact.artifact_key} hash`);
    assert.equal(splitStatements(bytes.toString("utf8")).length,artifact.statement_count,`${artifact.artifact_key} statement count`);
  }else if(artifact.source_kind==="disposable_git_migration_projection"){
    assert.equal(artifact.integrity_contract,"same_cycle_generated_sha256_manifest");
    assert.match(artifact.bundle_file,/^[a-z0-9._-]+\.sql\.gz$/u);
    assert.ok(Array.isArray(artifact.tables)&&artifact.tables.length>0);
    assert.equal(new Set(artifact.tables).size,artifact.tables.length);
    assert.equal(artifact.replay_modes.includes("zero_object_rebuild"),true);
    assert.equal("sha256" in artifact,false,"derived artifact hash must come from same-cycle build output");
    assert.equal("statement_count" in artifact,false,"derived artifact statement count must come from same-cycle build output");
  }else{
    assert.fail(`unsupported canonical semantic artifact source_kind: ${artifact.source_kind}`);
  }
  for(const dependency of artifact.dependencies||[])assert.ok(keys.has(dependency),`missing dependency ${dependency}`);
}
function visit(key,active=new Set(),done=new Set()){if(done.has(key))return;if(active.has(key))throw new Error(`canonical semantic artifact cycle: ${key}`);active.add(key);const artifact=registry.artifacts.find((item)=>item.artifact_key===key);for(const dependency of artifact.dependencies||[])visit(dependency,active,done);active.delete(key);done.add(key);}
for(const key of keys)visit(key);
console.log("Canonical semantic artifact registry integrity tests passed");

const snapshot=registry.artifacts.find((item)=>item.artifact_key==="runtime_canonical_registry_snapshot");
assert.ok(snapshot);
for(const required of ["tenant_platform_endpoint_tools","platform_endpoint_tool_exports","activation_connector_pack_registry","activation_delivery_policy_registry"]){
  assert.equal(snapshot.tables.includes(required),true,`snapshot missing ${required}`);
}

const migrationsDir=path.join(apiRoot,"migrations");
const activationRegistries=new Set();
for(const file of fs.readdirSync(migrationsDir).filter((name)=>name.endsWith(".sql"))){
  const sql=fs.readFileSync(path.join(migrationsDir,file),"utf8");
  for(const match of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(activation_[A-Za-z0-9_]+_registry)`?/giu)) activationRegistries.add(match[1]);
}
const declaredActivation=new Set(snapshot.tables.filter((table)=>/^activation_.*_registry$/u.test(table)));
assert.deepEqual([...declaredActivation].sort(),[...activationRegistries].sort(),"every Git-created activation registry must be explicitly declared in the canonical semantic snapshot");
