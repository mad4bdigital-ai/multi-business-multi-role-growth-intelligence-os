import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {splitStatements} from "./scripts/staging-sql-parser.mjs";
const registry=JSON.parse(fs.readFileSync(new URL("./config/canonical-semantic-artifacts.json",import.meta.url),"utf8"));
assert.equal(registry.contract,"mad4b.canonical-semantic-artifacts.v1");assert.equal(registry.production_apply_allowed,false);assert.equal(registry.provider_apply_allowed,false);
const keys=new Set(registry.artifacts.map((item)=>item.artifact_key));assert.equal(keys.size,registry.artifacts.length);
for(const artifact of registry.artifacts){
  assert.match(artifact.artifact_key,/^[a-z][a-z0-9_]+$/u);assert.equal(artifact.target_role,"runtime");assert.equal(artifact.production_apply_allowed,false);assert.equal(artifact.provider_apply_allowed,false);
  assert.equal(artifact.caller_sql_forbidden,true);assert.equal(artifact.caller_target_forbidden,true);
  const file=path.resolve(path.dirname(new URL(import.meta.url).pathname),artifact.source_file);const bytes=fs.readFileSync(file);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),artifact.sha256,`${artifact.artifact_key} hash`);
  assert.equal(splitStatements(bytes.toString("utf8")).length,artifact.statement_count,`${artifact.artifact_key} statement count`);
  for(const dependency of artifact.dependencies||[])assert.ok(keys.has(dependency),`missing dependency ${dependency}`);
}
function visit(key,active=new Set(),done=new Set()){if(done.has(key))return;if(active.has(key))throw new Error(`canonical semantic artifact cycle: ${key}`);active.add(key);const artifact=registry.artifacts.find((item)=>item.artifact_key===key);for(const dependency of artifact.dependencies||[])visit(dependency,active,done);active.delete(key);done.add(key);}
for(const key of keys)visit(key);
console.log("Canonical semantic artifact registry integrity tests passed");
