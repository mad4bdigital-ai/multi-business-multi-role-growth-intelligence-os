import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { validateIsolatedRestoreInputs, isolatedDockerRunArgs } from "./scripts/dr-certifiers/isolatedRestoreSafety.mjs";
const digest="e".repeat(64);
const manifest={schema:"backup-manifest/v1",backup_kind:"database",compression:"gzip",encryption_scheme:"aes-256-gcm",
  checksum_algorithm:"sha256",checksum_value:digest,gzip_sha256:digest,plaintext_sql_sha256:digest,
  export_id:"synthetic-fixture",artifact_filename:"synthetic.sql.gz.aes256gcm",table_count:1,row_count:2};
const keyDoc={schema:"backup-recovery-key/v1",algorithm:"aes-256-gcm",export_id:manifest.export_id,
  artifact_sha256:digest,key_b64:randomBytes(32).toString("base64"),
  iv_b64:randomBytes(12).toString("base64"),auth_tag_b64:randomBytes(16).toString("base64")};
const inputs={manifest,keyDoc,artifactFilename:manifest.artifact_filename,image:"mariadb:11.4",database:"qa_restore_isolated"};
assert.equal(validateIsolatedRestoreInputs(inputs).key.length,32);
const args=isolatedDockerRunArgs({name:"growthos-db-restore-qa-1234567890",password:"long-ephemeral-password-123",image:"mariadb:11.4"});
assert(args.includes("--network")&&args.includes("none"));
assert(args.includes("no-new-privileges:true"));
assert(!args.includes("-p")&&!args.includes("--privileged"));
for(const patch of [
  {database:""},
  {database:"prod;DROP DATABASE users"},
  {image:"alpine:latest"},
  {image:"mariadb:latest"},
  {artifactFilename:"different.sql.gz.aes256gcm"},
  {manifest:{...manifest,encryption_scheme:"none"}},
  {manifest:{...manifest,checksum_value:"not-sha"}},
  {manifest:{...manifest,table_count:0}},
  {keyDoc:{...keyDoc,export_id:"wrong"}},
  {keyDoc:{...keyDoc,key_b64:randomBytes(16).toString("base64")}},
  {keyDoc:{...keyDoc,artifact_sha256:"0".repeat(64)}},
]) {
  assert.throws(()=>validateIsolatedRestoreInputs({...inputs,...patch}));
}
console.log(JSON.stringify({contract:"mad4b.isolated-db-restore-safety.test.v1",success:true,cases:12,network_none:true,production_mutation:false}));
