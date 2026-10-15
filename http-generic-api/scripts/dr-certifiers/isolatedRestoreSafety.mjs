// Defensive input validation for isolated *test* restores. No Production context.
const sha=/^[a-f0-9]{64}$/i;
const allowedImage=/^mariadb:11\.(?:4|8)(?:\.\d+)?(?:@sha256:[a-f0-9]{64})?$/i;
export function validateIsolatedRestoreInputs({manifest,keyDoc,artifactFilename,image,database}) {
  const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
  if(!allowedImage.test(String(image||""))) fail("mariadb_restore_image_not_allowed");
  if(!/^[a-z][a-z0-9_]{0,62}$/i.test(String(database||""))) fail("invalid_isolated_database_identifier");
  if(manifest?.schema!=="backup-manifest/v1" || manifest?.backup_kind!=="database"
     || manifest?.compression!=="gzip" || manifest?.encryption_scheme!=="aes-256-gcm"
     || manifest?.checksum_algorithm!=="sha256") fail("unsupported_encrypted_backup_manifest");
  if(!sha.test(String(manifest.checksum_value||""))
    || !sha.test(String(manifest.gzip_sha256||""))
    || !sha.test(String(manifest.plaintext_sql_sha256||""))
    || !Number.isSafeInteger(Number(manifest.table_count)) || Number(manifest.table_count)<1) {
    fail("invalid_backup_checksum_or_count");
  }
  if(manifest.artifact_filename!==artifactFilename || !/^[a-z0-9._-]+\.sql\.gz\.aes256gcm$/i.test(artifactFilename)) fail("artifact_filename_does_not_match_manifest");
  if(keyDoc?.schema!=="backup-recovery-key/v1" || keyDoc?.algorithm!=="aes-256-gcm"
    || keyDoc?.export_id!==manifest.export_id || keyDoc?.artifact_sha256!==manifest.checksum_value) {
    fail("recovery_key_not_bound_to_manifest");
  }
  const key=Buffer.from(String(keyDoc.key_b64||""),"base64");
  const iv=Buffer.from(String(keyDoc.iv_b64||""),"base64");
  const tag=Buffer.from(String(keyDoc.auth_tag_b64||""),"base64");
  if(key.length!==32 || iv.length!==12 || tag.length!==16) fail("invalid_aes256gcm_recovery_key_envelope");
  return {key,iv,tag};
}
export function isolatedDockerRunArgs({name,password,image}) {
  if(!/^growthos-db-restore-[a-z0-9-]{10,60}$/.test(String(name||""))) throw new Error("invalid_restore_container");
  if(!allowedImage.test(String(image||""))) throw new Error("invalid_restore_image");
  if(!password || password.length<20) throw new Error("insufficient_ephemeral_database_password");
  return ["run","-d","--name",name,"--network","none","--security-opt","no-new-privileges:true",
    "--pids-limit","256","--memory","2g","--cpus","2","-e",`MARIADB_ROOT_PASSWORD=${password}`,image];
}
