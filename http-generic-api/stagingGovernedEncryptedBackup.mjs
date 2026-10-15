// P1 local-connector encrypted-backup core. No direct DB access, policy mutation,
// key creation, QA writes or Production authority. Adapters are independently governed.
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, createCipheriv, randomBytes, verify as cryptoVerify } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export const STAGING_QA_POLICY_KEY = "policy:staging-qa-db:approved";
const SHA40 = /^[0-9a-f]{40}$/i;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TTL_MS = 30 * 60 * 1000;
const MAX_SQL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENCRYPTED_BYTES = 2 * 1024 * 1024 * 1024;

// The signed content uses an allowlisted, fixed-order serialization. No attacker-
// controlled JSON ordering or incidental extra properties can modify authority.
export function approvalPayload(envelope) {
  const keys = ["contract", "run_id", "policy_key", "approval_id", "source_sha",
    "policy_id", "source_database", "source_endpoint_family", "device_id",
    "destination_id", "destination_ref", "key_ref", "issued_at", "expires_at"];
  return Buffer.from(JSON.stringify(Object.fromEntries(keys.map(k => [k, envelope?.[k] ?? null]))));
}
export function manifestPayload(manifest) {
  const copy = { ...manifest };
  delete copy.signature;
  return Buffer.from(JSON.stringify(copy));
}
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function validDate(value) {
  const date = Date.parse(value || "");
  return Number.isFinite(date) ? date : NaN;
}
function notProd(value) {
  return !/(?:^|[^a-z])(production|prod|hostinger)(?:[^a-z]|$)|auth\.mad4b\.com|mcp\.mad4b\.com/i.test(String(value ?? ""));
}
function safeKeyRef(ref) {
  return /^local-custody:[a-z0-9][a-z0-9_-]{2,127}$/i.test(String(ref || ""));
}
export function assessGovernedStagingBackup(input = {}, trust = {}) {
  const blockers = [];
  const add = x => blockers.push(x);
  const p = input.policy || {};
  const a = input.approval || {};
  const s = input.source || {};
  const d = input.destination || {};
  const r = input.runtime || {};
  const e = input.envelope || {};
  const now = Number.isFinite(input.now_ms) ? input.now_ms : Date.now();

  if (r.deployment_environment !== "staging_local_windows_docker" ||
      r.runtime_class !== "local_windows_docker" ||
      r.executor !== "local_connector" || r.local_connector_verified !== true ||
      r.device_id !== e.device_id) add("STAGING_LOCAL_CONNECTOR_IDENTITY_REQUIRED");
  if (!SHA40.test(String(input.expected_source_sha || "")) ||
      r.source_sha !== input.expected_source_sha || e.source_sha !== input.expected_source_sha)
    add("EXACT_STAGING_SOURCE_SHA_REQUIRED");
  if (!IDENTIFIER.test(String(s.database_name || "")) ||
      s.database_name !== e.source_database || s.endpoint_family !== e.source_endpoint_family ||
      !notProd(s.database_name) ||
      !notProd(s.endpoint_family) || s.environment !== "staging")
    add("STAGING_DB_IDENTITY_MISMATCH");
  if (p.policy_key !== STAGING_QA_POLICY_KEY || p.backup_kind !== "database" ||
      p.status !== "active" || p.activation_gate_status !== "active" ||
      p.allowed_executor !== "local_connector" || p.artifact_format !== "sql_dump" ||
      p.encryption_scheme !== "platform_managed" || p.checksum_algorithm !== "sha256" ||
      p.approval_required !== true || Number(p.restore_test_required) !== 1 ||
      p.source_status !== "active" || p.destination_status !== "active")
    add("ACTIVE_GOVERNED_STAGING_POLICY_REQUIRED");
  if (!p.policy_id || p.policy_id !== e.policy_id) add("SIGNED_POLICY_IDENTITY_MISMATCH");
  if (a.approval_id !== e.approval_id || a.policy_id !== p.policy_id ||
      a.approval_type !== "backup_apply" || a.status !== "approved" ||
      !["admin_session","external_ticket"].includes(a.decision_source) ||
      !a.approved_by || !a.decided_at || !a.expires_at ||
      !(validDate(a.decided_at) <= now && validDate(a.expires_at) > now))
    add("TIME_BOUND_OWNER_BACKUP_APPLY_APPROVAL_REQUIRED");
  if (e.contract !== "mad4b.staging-db-backup-apply.v1" ||
      e.policy_key !== STAGING_QA_POLICY_KEY || !UUID.test(String(e.run_id || "")) ||
      e.destination_ref !== d.path_or_ref || e.key_ref !== input.key_ref ||
      !e.approval_id || e.destination_id !== d.location_id ||
      !d.location_id || d.status !== "active" ||
      d.location_type !== "local_device_path" || d.provider !== "local_connector" ||
      !d.allowed_operations?.includes("write_approved_backup_artifacts") ||
      !notProd(d.path_or_ref) || !notProd(d.location_key))
    add("APPROVED_LOCAL_BACKUP_DESTINATION_REQUIRED");
  if (!Number.isFinite(validDate(e.issued_at)) || !Number.isFinite(validDate(e.expires_at)) ||
      validDate(e.issued_at) > now || validDate(e.expires_at) <= now ||
      validDate(e.expires_at) - validDate(e.issued_at) > MAX_TTL_MS ||
      validDate(e.expires_at) > validDate(a.expires_at))
    add("SIGNED_BACKUP_LEASE_EXPIRED_OR_UNBOUNDED");
  if (!trust.owner_public_key_pem || !/^[A-Za-z0-9+/]+={0,2}$/.test(String(input.signature_b64 || ""))) {
    add("OWNER_SIGNATURE_MISSING");
  } else {
    try {
      const key = Buffer.from(input.signature_b64, "base64");
      if (!cryptoVerify(null, approvalPayload(e), trust.owner_public_key_pem, key)) add("OWNER_SIGNATURE_INVALID");
    } catch { add("OWNER_SIGNATURE_INVALID"); }
  }
  if (!safeKeyRef(input.key_ref)) add("RECOVERY_KEY_CUSTODY_REF_INVALID");
  return {
    contract: "mad4b.governed-staging-backup-gate.v1",
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    qa_fixture_write_authorized: false,
    production_promotion_authorized: false,
    production_mutation: false,
    backup_executed: false,
    secrets_included: false
  };
}
function meter(hash, cap) {
  let bytes = 0;
  return {
    stream: new Transform({
      transform(chunk, encoding, cb) {
        bytes += chunk.length;
        if (bytes > cap) return cb(Object.assign(new Error("backup_size_limit_exceeded"), { code:"backup_size_limit_exceeded" }));
        hash.update(chunk);
        cb(null, chunk);
      }
    }),
    count: () => bytes
  };
}
async function assertPrivateDestination(dir) {
  if (!path.isAbsolute(dir)) fail("ABSOLUTE_LOCAL_DESTINATION_REQUIRED");
  const real = await fs.realpath(dir);
  if (path.resolve(real) !== path.resolve(dir)) fail("BACKUP_DESTINATION_SYMLINK_FORBIDDEN");
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    fail("PRIVATE_BACKUP_DIRECTORY_REQUIRED");
  return real;
}
export async function executeGovernedStagingBackup(input, adapters = {}) {
  // The trust key must be supplied by the authenticated local connector, never request input.
  const gate = assessGovernedStagingBackup({...input, now_ms:Date.now()},
    {owner_public_key_pem: adapters.trusted_owner_public_key_pem});
  if (!gate.ok) return gate;
  // Reject a wrong approved target before touching its filesystem or inspecting ACLs.
  // On POSIX this must precede the private-directory check: /tmp itself is public.
  if (path.resolve(adapters.destination_dir || "") !== path.resolve(input.destination.path_or_ref))
    fail("DESTINATION_PATH_NOT_POLICY_BOUND");
  const root = await assertPrivateDestination(adapters.destination_dir || "");
  if (process.platform === "win32" &&
      (typeof adapters.assert_private_acl !== "function" ||
       await adapters.assert_private_acl(root) !== true))
    fail("PRIVATE_WINDOWS_ACL_ATTESTATION_REQUIRED");
  if (typeof adapters.open_dump !== "function" ||
      typeof adapters.read_key !== "function" ||
      typeof adapters.sign_manifest !== "function" ||
      typeof adapters.verify_authority_snapshot !== "function" ||
      !adapters.trusted_owner_public_key_pem)
    fail("TRUSTED_LOCAL_CONNECTOR_ADAPTERS_REQUIRED");
  const ledgerRoot = await assertPrivateDestination(adapters.ledger_dir || "");
  if (path.resolve(ledgerRoot) === path.resolve(root)) fail("SEPARATE_REPLAY_LEDGER_REQUIRED");
  if (process.platform === "win32" &&
      (typeof adapters.assert_private_acl !== "function" ||
       await adapters.assert_private_acl(ledgerRoot) !== true))
    fail("PRIVATE_LEDGER_ACL_ATTESTATION_REQUIRED");
  const freshAuthority = await adapters.verify_authority_snapshot(input);
  if (freshAuthority !== true) fail("LIVE_OWNER_APPROVAL_SNAPSHOT_REQUIRED");
  // Reserve the UUID before any DB read. An immutable exclusive ledger survives errors
  // and process crashes; a failed run requires a new independently signed run UUID.
  const runId = input.envelope.run_id;
  const reservation = path.join(ledgerRoot, "staging-backup-" + runId + ".json");
  let ledgerHandle;
  try {
    ledgerHandle = await fs.open(reservation, "wx", 0o600);
    await ledgerHandle.writeFile(JSON.stringify({contract:"mad4b.staging-backup-nonce.v1",
      run_id:runId, approval_id:input.approval.approval_id,
      source_sha:input.expected_source_sha, reserved_at:new Date().toISOString()})+"\n");
    await ledgerHandle.sync();
  } catch (error) {
    if (error.code === "EEXIST") fail("BACKUP_APPLY_NONCE_REPLAY");
    fail("BACKUP_APPLY_LEDGER_UNAVAILABLE");
  } finally {
    await ledgerHandle?.close();
  }
  const keyMaterial = await adapters.read_key(input.key_ref);
  const key = keyMaterial?.key;
  if (!Buffer.isBuffer(key) || key.length !== 32 ||
      keyMaterial?.ref !== input.key_ref || !safeKeyRef(keyMaterial.ref)) {
    if (Buffer.isBuffer(key)) key.fill(0);
    fail("INDEPENDENT_AES256_KEY_CUSTODY_REQUIRED");
  }
  const folder = path.join(root, "staging-qa-" + runId);
  // wx directory creation + exclusive artifact creation prevent overwrite/replay.
  const artifactName = "staging-qa-" + runId + ".sql.gz.aes256gcm";
  const temporary = path.join(folder, artifactName + ".partial");
  const artifactPath = path.join(folder, artifactName);
  const manifestPath = path.join(folder, "manifest.json");
  const iv = randomBytes(12);
  const plainHash = createHash("sha256"), zipHash = createHash("sha256"), cipherHash = createHash("sha256");
  const plain = meter(plainHash, MAX_SQL_BYTES);
  const compressed = meter(zipHash, MAX_ENCRYPTED_BYTES);
  const encrypted = meter(cipherHash, MAX_ENCRYPTED_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  try {
    await fs.mkdir(folder, { recursive: false, mode: 0o700 });
    const stream = await adapters.open_dump({ database:input.source.database_name, source_sha:input.expected_source_sha, run_id:runId });
    if (!stream || typeof stream.pipe !== "function") fail("TRUSTED_DUMP_STREAM_REQUIRED");
    // No plaintext or gzip dump is written to disk. Ciphertext is the only data file.
    await pipeline(stream, plain.stream, createGzip({level:9}), compressed.stream,
      cipher, encrypted.stream, createWriteStream(temporary,{flags:"wx",mode:0o600}));
    if (!plain.count() || !encrypted.count()) fail("EMPTY_DATABASE_DUMP_FORBIDDEN");
    const artifactSha = cipherHash.digest("hex");
    const onDiskHash = createHash("sha256");
    for await (const chunk of createReadStream(temporary)) onDiskHash.update(chunk);
    if (onDiskHash.digest("hex") !== artifactSha) fail("ARTIFACT_READBACK_SHA256_MISMATCH");
    const manifest = {
      schema:"backup-manifest/v1", backup_kind:"database", policy_key:STAGING_QA_POLICY_KEY,
      export_id:runId, source_sha:input.expected_source_sha,
      database_name:input.source.database_name, created_at:new Date().toISOString(),
      artifact_format:"sql_dump", compression:"gzip", encryption_scheme:"aes-256-gcm",
      checksum_algorithm:"sha256", checksum_value:artifactSha,
      gzip_sha256:zipHash.digest("hex"), plaintext_sql_sha256:plainHash.digest("hex"),
      size_bytes:encrypted.count(), plaintext_size_bytes:plain.count(),
      table_count:adapters.expected_table_count, row_count:adapters.expected_row_count,
      artifact_filename:artifactName, key_ref:input.key_ref,
      iv_b64:iv.toString("base64"), auth_tag_b64:cipher.getAuthTag().toString("base64"),
      approval_id:input.approval.approval_id, device_id:input.runtime.device_id
    };
    if (!Number.isSafeInteger(manifest.table_count) || manifest.table_count < 1 ||
        !Number.isSafeInteger(manifest.row_count) || manifest.row_count < 0)
      fail("TRUSTED_DATABASE_CENSUS_REQUIRED");
    const signature = await adapters.sign_manifest(manifestPayload(manifest));
    if (signature?.algorithm !== "ed25519" || !signature.key_id ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(signature.signature_b64 || ""))
      fail("SIGNED_MANIFEST_REQUIRED");
    if (!adapters.manifest_public_key_pem ||
        !cryptoVerify(null, manifestPayload(manifest), adapters.manifest_public_key_pem,
          Buffer.from(signature.signature_b64, "base64")))
      fail("MANIFEST_SIGNATURE_VERIFICATION_FAILED");
    manifest.signature = signature;
    await fs.writeFile(manifestPath, JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    await fs.rename(temporary, artifactPath);
    return {
      contract:"mad4b.staging-db-backup-execution.v1",ok:true,status:"artifact_created_restore_not_attested",
      run_id:runId,artifact_sha256:artifactSha,manifest_file:manifestPath,
      artifact_file:artifactPath,key_ref:input.key_ref,checksum_verified:true,
      qa_fixture_write_authorized:false,production_promotion_authorized:false,
      production_mutation:false,backup_executed:true,secrets_included:false
    };
  } catch (error) {
    // No residual encrypted fragment or unverified manifest is retained on failure.
    await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});
    fail(["backup_size_limit_exceeded","EMPTY_DATABASE_DUMP_FORBIDDEN","TRUSTED_DATABASE_CENSUS_REQUIRED",
      "SIGNED_MANIFEST_REQUIRED","MANIFEST_SIGNATURE_VERIFICATION_FAILED","ARTIFACT_READBACK_SHA256_MISMATCH","TRUSTED_DUMP_STREAM_REQUIRED"].includes(error.code)
      ? error.code : "GOVERNED_BACKUP_EXECUTION_FAILED");
  } finally {
    key.fill(0);
  }
}
