// Opt-in Docker integration. Uses only two synthetic rows, never the runtime DB.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
const sha=(buf)=>createHash("sha256").update(buf).digest("hex");
if(process.env.RUN_ISOLATED_RESTORE_INTEGRATION!=="1"){
 console.log(JSON.stringify({contract:"mad4b.synthetic-isolated-db-restore.test.v1",status:"not_run",reason:"requires_explicit_opt_in_docker",production_mutation:false}));
} else {
 const probe=spawnSync("docker",["image","inspect","mariadb:11.4"],{windowsHide:true,encoding:"utf8"});
 assert.equal(probe.status,0,"mariadb:11.4 must already be available locally; no pulls or network changes");
 const base=fs.mkdtempSync(path.join(os.tmpdir(),"mad4b-qa-restore-synthetic-"));
 try {
  const sql=Buffer.from("CREATE TABLE qa_recovery_fixture (id INT PRIMARY KEY, label VARCHAR(40) NOT NULL);\nINSERT INTO qa_recovery_fixture (id,label) VALUES (1,'synthetic-a'),(2,'synthetic-b');\n");
  const zip=gzipSync(sql), key=randomBytes(32), iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  const encrypted=Buffer.concat([cipher.update(zip),cipher.final()]);
  const artifactName="synthetic.sql.gz.aes256gcm", exportId="synthetic-isolated-only";
  const artifact=path.join(base,artifactName),manifestPath=path.join(base,"synthetic.manifest.json"),keyPath=path.join(base,"synthetic.key.json");
  fs.writeFileSync(artifact,encrypted,{mode:0o600});
  const manifest={schema:"backup-manifest/v1",backup_kind:"database",export_id:exportId,compression:"gzip",encryption_scheme:"aes-256-gcm",
    checksum_algorithm:"sha256",checksum_value:sha(encrypted),gzip_sha256:sha(zip),plaintext_sql_sha256:sha(sql),
    artifact_filename:artifactName,table_count:1,row_count:2};
  const recovery={schema:"backup-recovery-key/v1",algorithm:"aes-256-gcm",export_id:exportId,
    artifact_sha256:sha(encrypted),key_b64:key.toString("base64"),iv_b64:iv.toString("base64"),auth_tag_b64:cipher.getAuthTag().toString("base64")};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest),{mode:0o600});
  fs.writeFileSync(keyPath,JSON.stringify(recovery),{mode:0o600});
  const certifier=new URL("./scripts/dr-certifiers/db-isolated-restore-certifier.mjs",import.meta.url).pathname.replace(/^\/([A-Z]:\/)/,"$1");
  const args=["--artifact="+artifact,"--manifest="+manifestPath,"--recovery-key="+keyPath,"--restore-root="+base,"--image=mariadb:11.4","--database=qa_restore_synthetic"];
  const run=(params)=>{
    const r=spawnSync(process.execPath,[certifier,...params],{encoding:"utf8",windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
    const txt=String(r.stdout||"");
    let result;try{result=JSON.parse(txt)}catch{throw new Error("certifier_did_not_emit_json_exit_"+r.status)}
    return {exit:r.status,body:result};
  };
  const valid=run(args);
  assert.equal(valid.exit,0,"synthetic isolated restore must succeed");
  assert.equal(valid.body.ok,true);
  assert.equal(valid.body.network_isolated,true);
  assert.equal(valid.body.ports_published,false);
  assert.equal(valid.body.readback.table_count,1);
  assert.equal(valid.body.cleanup.container_removed,true);
  assert.equal(valid.body.cleanup.plaintext_sql_removed,true);
  assert.equal(valid.body.production_touched,false);
  const broken=Buffer.from(encrypted);broken[0]^=0xff;
  // Keep the original filename and manifest binding; this must exercise the
  // actual encrypted-artifact checksum, not a simpler filename mismatch.
  fs.writeFileSync(artifact,broken);
  const rejected=run(args);
  assert.notEqual(rejected.exit,0);
  assert.equal(rejected.body.ok,false);
  assert.equal(rejected.body.artifact.checksum_matches,false);
  assert.match(String(rejected.body.error?.message||""),/encrypted artifact checksum mismatch/);
  assert.equal(rejected.body.full_import_attempted,false);
  assert.equal(rejected.body.cleanup.plaintext_sql_removed,true);
  console.log(JSON.stringify({contract:"mad4b.synthetic-isolated-db-restore.test.v1",status:"passed",
    encrypted_backup_verified:true,isolated_restore_tables:valid.body.readback.table_count,
    network_isolated:true,ports_published:false,container_removed:true,
    corrupted_artifact_rejected:true,plaintext_removed:true,production_mutation:false,secrets_included:false}));
 }finally{fs.rmSync(base,{recursive:true,force:true})}
}
