import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getPool } from "./db.js";
import { normalizeRuntimeBreakGlassIncident } from "./runtimeBreakGlassLifecycle.js";
import { fingerprintRuntimeBreakGlassApprovalScope } from "./runtimeBreakGlassScopeBinding.js";

export const RUNTIME_BREAK_GLASS_READBACK_SURFACE = "runtime_break_glass_file_readback";
export const RUNTIME_BREAK_GLASS_READBACK_CONTRACT = "mad4b.runtime-break-glass.run-bound-readback.v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function stableHashes(value = []) {
  return [...value]
    .map((entry) => ({ path: String(entry?.path || ""), sha256: String(entry?.sha256 || "").toLowerCase() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function sameHashes(left = [], right = []) {
  return JSON.stringify(stableHashes(left)) === JSON.stringify(stableHashes(right));
}

function insideRoot(realRoot, realFile) {
  const relative = path.relative(realRoot, realFile);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function hashRuntimeBreakGlassFile(filePath, { declaredRoot, realRoot } = {}) {
  const lstat = await fs.promises.lstat(filePath);
  if (lstat.isSymbolicLink()) fail("runtime_break_glass_readback_symlink_forbidden", "Runtime break-glass readback refuses symbolic-link file targets.", { path: filePath });
  if (!lstat.isFile()) fail("runtime_break_glass_readback_regular_file_required", "Runtime break-glass readback requires exact regular files.", { path: filePath });

  const resolvedFile = await fs.promises.realpath(filePath);
  if (!insideRoot(realRoot, resolvedFile)) {
    fail("runtime_break_glass_readback_realpath_escape", "Runtime break-glass readback file resolves outside the approved application root.", { path: filePath, declared_root: declaredRoot });
  }

  let handle;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) fail("runtime_break_glass_readback_regular_file_required", "Opened runtime break-glass target is not a regular file.", { path: filePath });
    const hash = createHash("sha256");
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function getConnection(deps = {}) {
  if (deps.connection) return { connection: deps.connection, owned: false };
  const pool = deps.pool || getPool();
  return { connection: await pool.getConnection(), owned: true };
}

export async function recordRuntimeBreakGlassVerificationReadback(
  { runId, breakGlassId, now = new Date() } = {},
  deps = {},
) {
  const normalizedRunId = String(runId || "").trim().toLowerCase();
  const normalizedBreakGlassId = String(breakGlassId || "").trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedRunId)) fail("runtime_break_glass_readback_run_id_invalid", "runId must be a UUID.");
  if (!UUID_PATTERN.test(normalizedBreakGlassId)) fail("runtime_break_glass_readback_incident_id_invalid", "breakGlassId must be a UUID.");
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(nowDate.getTime())) fail("runtime_break_glass_readback_now_invalid", "now must be a valid date-time.");

  const { connection, owned } = await getConnection(deps);
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [incidentRows] = await connection.query(
      `SELECT * FROM runtime_break_glass_incidents WHERE break_glass_id = ? LIMIT 1 FOR UPDATE`,
      [normalizedBreakGlassId],
    );
    const incidentRow = incidentRows?.[0];
    if (!incidentRow) fail("runtime_break_glass_readback_incident_not_found", "Persisted runtime break-glass incident was not found.");
    if (Number(incidentRow.secrets_included || 0) !== 0) fail("runtime_break_glass_readback_incident_secret_flag_invalid", "Persisted runtime break-glass incident violates the no-secrets invariant.");

    const incident = normalizeRuntimeBreakGlassIncident(incidentRow);
    if (incident.break_glass_id !== normalizedBreakGlassId) fail("runtime_break_glass_readback_incident_binding_mismatch", "Persisted break-glass identity does not match the requested incident.");
    if (incident.lifecycle_state !== "LOCAL_PATCH_APPLIED") fail("runtime_break_glass_readback_state_invalid", "Run-bound readback can only be recorded for LOCAL_PATCH_APPLIED incidents.", { lifecycle_state: incident.lifecycle_state });
    if (!incident.runtime_policy_ready) fail("runtime_break_glass_readback_runtime_policy_not_ready", "Runtime mutation policy is not currently ready for this incident.");
    if (new Date(incident.authorization_expires_at).getTime() <= nowDate.getTime()) fail("runtime_break_glass_readback_authorization_expired", "Runtime break-glass authorization expired before verification readback.");

    const expectedScopeSha256 = fingerprintRuntimeBreakGlassApprovalScope(incident);
    if (!SHA256_PATTERN.test(String(incident.approved_scope_sha256 || "")) || incident.approved_scope_sha256 !== expectedScopeSha256) {
      fail("runtime_break_glass_readback_approved_scope_mismatch", "Persisted approved scope does not match the current normalized incident scope.");
    }
    if (incident.post_change_hashes.length !== incident.allowed_paths.length) fail("runtime_break_glass_readback_post_change_hashes_required", "Persisted post-change hashes must cover every approved path before runtime readback.");
    if (incident.post_change_readback_hashes.length !== incident.allowed_paths.length) fail("runtime_break_glass_readback_persisted_readback_required", "Persisted post-change readback must cover every approved path before runtime verification.");
    if (!sameHashes(incident.post_change_hashes, incident.post_change_readback_hashes)) fail("runtime_break_glass_readback_persisted_readback_mismatch", "Persisted post-change readback does not match the intended post-change hashes.");

    const [runRows] = await connection.query(
      `SELECT run_id, environment_key, expected_commit_sha, deployed_commit_sha, workflow_key,
              run_status, production_parity, summary_json, started_at, completed_at
         FROM runtime_verification_runs
        WHERE run_id = ?
        LIMIT 1 FOR UPDATE`,
      [normalizedRunId],
    );
    const run = runRows?.[0];
    if (!run) fail("runtime_break_glass_readback_run_not_found", "Runtime verification run was not found.");
    if (String(run.run_id || "").toLowerCase() !== normalizedRunId) fail("runtime_break_glass_readback_run_binding_mismatch", "Runtime verification run identity drifted.");
    if (String(run.environment_key || "") !== incident.environment_key) fail("runtime_break_glass_readback_environment_mismatch", "Runtime verification environment does not match the incident.");
    if (String(run.expected_commit_sha || "").toLowerCase() !== incident.expected_commit_sha) fail("runtime_break_glass_readback_expected_commit_mismatch", "Runtime verification expected commit does not match the incident.");
    if (String(run.deployed_commit_sha || "").toLowerCase() !== incident.expected_commit_sha) fail("runtime_break_glass_readback_deployed_commit_mismatch", "Runtime verification deployed commit does not match the incident.");
    if (String(run.run_status || "").toLowerCase() !== "verified" || String(run.production_parity || "").toLowerCase() !== "verified") {
      fail("runtime_break_glass_readback_run_not_verified", "Runtime verification run must be verified with production parity before file readback evidence is recorded.");
    }
    const summary = parseJson(run.summary_json, {});
    if (Number(summary?.blocking_gap_count || 0) > 0) fail("runtime_break_glass_readback_run_blocking_gap", "Runtime verification run has blocking gaps.");
    if (!run.completed_at) fail("runtime_break_glass_readback_run_incomplete", "Runtime verification run is incomplete.");

    const patchAt = incident.local_patch_applied_at ? new Date(incident.local_patch_applied_at).getTime() : NaN;
    const startedAt = run.started_at ? new Date(run.started_at).getTime() : NaN;
    if (!Number.isFinite(patchAt) || !Number.isFinite(startedAt)) fail("runtime_break_glass_readback_ordering_evidence_required", "Patch and verification run timestamps are required.");
    const patchSecond = Math.floor(patchAt / 1000);
    const startedSecond = Math.floor(startedAt / 1000);
    if (startedSecond < patchSecond) fail("runtime_break_glass_readback_run_predates_patch", "Runtime verification run predates the local patch.");
    if (startedSecond === patchSecond) fail("runtime_break_glass_readback_run_order_ambiguous", "Runtime verification run and patch share second precision; ordering is ambiguous.");

    const [existingRows] = await connection.query(
      `SELECT chunk_id FROM runtime_verification_evidence_chunks WHERE run_id = ? AND surface_key = ? LIMIT 1`,
      [normalizedRunId, RUNTIME_BREAK_GLASS_READBACK_SURFACE],
    );
    if (existingRows?.length) fail("runtime_break_glass_readback_evidence_already_exists", "Run-bound runtime break-glass readback evidence already exists; create a new verification run.");

    const realpath = deps.realpath || fs.promises.realpath;
    const realRoot = await realpath(incident.target_application_root);
    const hashFile = deps.hashFile || hashRuntimeBreakGlassFile;
    const readbackHashes = [];
    for (const exactPath of incident.allowed_paths) {
      const sha256 = String(await hashFile(exactPath, { declaredRoot: incident.target_application_root, realRoot })).toLowerCase();
      if (!SHA256_PATTERN.test(sha256)) fail("runtime_break_glass_readback_hash_invalid", "Readback producer returned an invalid SHA-256 digest.", { path: exactPath });
      readbackHashes.push({ path: exactPath, sha256 });
    }
    readbackHashes.sort((a, b) => a.path.localeCompare(b.path));

    const payload = {
      contract: RUNTIME_BREAK_GLASS_READBACK_CONTRACT,
      run_id: normalizedRunId,
      break_glass_id: incident.break_glass_id,
      incident_id: incident.incident_id,
      approved_scope_sha256: expectedScopeSha256,
      environment_key: incident.environment_key,
      expected_commit_sha: incident.expected_commit_sha,
      workflow_key: String(run.workflow_key || "runtime_verification_control_plane"),
      readback_hashes: readbackHashes,
      secrets_included: false,
    };
    const payloadJson = JSON.stringify(payload);
    const payloadSha256 = createHash("sha256").update(payloadJson).digest("hex");
    const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
    await connection.query(
      `INSERT INTO runtime_verification_evidence_chunks
         (chunk_id, run_id, surface_key, chunk_index, chunk_type, item_count, byte_size,
          sha256, storage_mode, payload_json, payload_ref)
       VALUES (?, ?, ?, 0, 'summary', ?, ?, ?, 'inline_json', ?, NULL)`,
      [randomUUID(), normalizedRunId, RUNTIME_BREAK_GLASS_READBACK_SURFACE, readbackHashes.length, payloadBytes, payloadSha256, payloadJson],
    );

    await connection.commit();
    transactionStarted = false;
    return {
      ok: sameHashes(readbackHashes, incident.post_change_hashes),
      contract: RUNTIME_BREAK_GLASS_READBACK_CONTRACT,
      run_id: normalizedRunId,
      break_glass_id: incident.break_glass_id,
      incident_id: incident.incident_id,
      approved_scope_sha256: expectedScopeSha256,
      surface_key: RUNTIME_BREAK_GLASS_READBACK_SURFACE,
      readback_hashes: readbackHashes,
      matches_post_change_hashes: sameHashes(readbackHashes, incident.post_change_hashes),
      file_contents_returned: false,
      provider_call_performed: false,
      hostinger_mutation_performed: false,
      secrets_included: false,
    };
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (owned) connection.release();
  }
}
