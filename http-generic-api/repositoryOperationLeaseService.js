import crypto from "node:crypto";
import { getPool } from "./db.js";

function value(input, max = 512) {
  const normalized = String(input ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}
function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}
function nowFrom(deps = {}) {
  return deps.now instanceof Date ? deps.now : new Date(deps.now?.() ?? Date.now());
}
export function repositoryLeaseResourceHash({ owner, repo, branch } = {}) {
  const key = [value(owner, 191), value(repo, 191), value(branch, 255)];
  if (key.some((part) => !part)) throw fail("repository_lease_resource_required", "owner, repo, and branch are required.", 400);
  return crypto.createHash("sha256").update(`${key[0]}/${key[1]}#${key[2]}`).digest("hex");
}
async function expire(pool, resourceHash, now) {
  await pool.query(
    `UPDATE repository_operation_leases
        SET status='expired', active_resource_sha256=NULL, released_at=COALESCE(released_at, ?),
            release_reason=COALESCE(release_reason, 'lease_ttl_expired'), updated_at=?
      WHERE active_resource_sha256=? AND status='active' AND expires_at<=?`,
    [now, now, resourceHash, now],
  );
}
async function active(pool, resourceHash) {
  const [rows] = await pool.query(
    `SELECT lease_id, resource_uri, repository_owner, repository_name, branch_name, operation_key,
            holder_run_id, holder_actor_type, holder_actor_id, lease_mode, status,
            resource_fingerprint, acquired_at, renewed_at, expires_at
       FROM repository_operation_leases
      WHERE active_resource_sha256=? AND status='active' LIMIT 1`,
    [resourceHash],
  );
  return rows?.[0] || null;
}
function publicLease(row) {
  return row ? { ...row, holder_actor_id: row.holder_actor_id || null, secrets_included: false } : null;
}
export async function acquireRepositoryOperationLease(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const owner = value(input.owner, 191);
  const repo = value(input.repo, 191);
  const branch = value(input.branch, 255);
  const operationKey = value(input.operation_key, 128);
  const holderRunId = value(input.holder_run_id, 64);
  const fingerprint = value(input.resource_fingerprint, 64);
  if (!operationKey || !holderRunId || !fingerprint) {
    throw fail("repository_lease_context_required", "operation_key, holder_run_id, and resource_fingerprint are required.", 400);
  }
  if (value(input.lease_mode || "exclusive_mutation", 32) !== "exclusive_mutation") {
    throw fail("repository_lease_mode_invalid", "Only exclusive_mutation branch leases are supported.", 400);
  }
  const ttl = Math.min(7200, Math.max(30, Number.parseInt(input.ttl_seconds || 900, 10) || 900));
  const now = nowFrom(deps);
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const resourceHash = repositoryLeaseResourceHash({ owner, repo, branch });
  await expire(pool, resourceHash, now);
  const leaseId = value(input.lease_id, 36) || (deps.randomUUID || crypto.randomUUID)();
  try {
    await pool.query(
      `INSERT INTO repository_operation_leases
        (lease_id, resource_uri, repository_owner, repository_name, branch_name, operation_key,
         holder_run_id, holder_actor_type, holder_actor_id, lease_mode, status, resource_fingerprint,
         active_resource_sha256, acquired_at, renewed_at, expires_at, metadata_json,
         secrets_included, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'exclusive_mutation', 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        leaseId,
        value(input.resource_uri, 512) || `github://${owner}/${repo}/refs/heads/${branch}`,
        owner, repo, branch, operationKey, holderRunId,
        value(input.holder_actor_type, 32) || "admin", value(input.holder_actor_id, 128),
        fingerprint, resourceHash, now, now, expiresAt,
        JSON.stringify(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
        now, now,
      ],
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
    const existing = await active(pool, resourceHash);
    if (existing?.holder_run_id === holderRunId
      && existing.operation_key === operationKey
      && existing.resource_fingerprint === fingerprint) {
      return { ok: true, reused: true, lease: publicLease(existing), secrets_included: false };
    }
    throw fail("repository_branch_lease_conflict", "The branch is leased by another governed operation.", 409, {
      holder_run_id: existing?.holder_run_id || null,
      operation_key: existing?.operation_key || null,
      expires_at: existing?.expires_at || null,
    });
  }
  return { ok: true, reused: false, lease: publicLease(await active(pool, resourceHash)), secrets_included: false };
}
export async function assertRepositoryOperationLease(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const hash = repositoryLeaseResourceHash(input);
  await expire(pool, hash, nowFrom(deps));
  const lease = await active(pool, hash);
  if (!lease) throw fail("repository_branch_lease_missing", "No active branch lease was found.");
  if (lease.holder_run_id !== value(input.holder_run_id, 64)) {
    throw fail("repository_branch_lease_holder_mismatch", "The branch lease belongs to another operation.");
  }
  if (input.resource_fingerprint && lease.resource_fingerprint !== value(input.resource_fingerprint, 64)) {
    throw fail("repository_branch_lease_fingerprint_mismatch", "The repository state changed after lease acquisition.");
  }
  return { ok: true, lease: publicLease(lease), secrets_included: false };
}
export async function renewRepositoryOperationLease(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const now = nowFrom(deps);
  const ttl = Math.min(7200, Math.max(30, Number.parseInt(input.ttl_seconds || 900, 10) || 900));
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const [result] = await pool.query(
    `UPDATE repository_operation_leases SET renewed_at=?, expires_at=?, updated_at=?
      WHERE lease_id=? AND holder_run_id=? AND status='active' AND expires_at>?`,
    [now, expiresAt, now, value(input.lease_id, 36), value(input.holder_run_id, 64), now],
  );
  if (Number(result?.affectedRows || 0) !== 1) throw fail("repository_lease_renew_failed", "The lease is missing, expired, or owned by another operation.");
  return { ok: true, expires_at: expiresAt, secrets_included: false };
}
export async function releaseRepositoryOperationLease(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const now = nowFrom(deps);
  const [result] = await pool.query(
    `UPDATE repository_operation_leases
        SET status='released', active_resource_sha256=NULL, released_at=?, release_reason=?, updated_at=?
      WHERE lease_id=? AND holder_run_id=? AND status='active'`,
    [now, value(input.release_reason, 500) || "operation_completed", now,
      value(input.lease_id, 36), value(input.holder_run_id, 64)],
  );
  return { ok: true, released: Number(result?.affectedRows || 0) === 1, secrets_included: false };
}
