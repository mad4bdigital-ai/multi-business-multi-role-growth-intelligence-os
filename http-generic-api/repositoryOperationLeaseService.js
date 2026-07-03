import { createHash, randomUUID } from "node:crypto";

import { getPool } from "./db.js";

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "staging", "release"]);
const DEFAULT_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 3600;
const LEASE_MODE = "exclusive_mutation";

function leaseError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function requiredString(value, field, { min = 1, max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw leaseError(
      "repository_operation_lease_invalid_input",
      `${field} is invalid.`,
      400,
      { field }
    );
  }
  return normalized;
}

function boundedInteger(value, fallback, min, max, field) {
  const numeric = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw leaseError(
      "repository_operation_lease_invalid_input",
      `${field} must be an integer between ${min} and ${max}.`,
      400,
      { field, min, max }
    );
  }
  return numeric;
}

function validateBranchName(value) {
  const branch = requiredString(value, "branch_name", { min: 1, max: 255 });
  const invalid = (
    PROTECTED_BRANCHES.has(branch.toLowerCase())
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.endsWith(".lock")
    || branch.includes("..")
    || branch.includes("@{")
    || /[\x00-\x20~^:?*[\]\\]/.test(branch)
  );
  if (invalid) {
    throw leaseError(
      PROTECTED_BRANCHES.has(branch.toLowerCase())
        ? "repository_operation_lease_protected_branch"
        : "repository_operation_lease_invalid_branch",
      PROTECTED_BRANCHES.has(branch.toLowerCase())
        ? "Repository operation leases cannot target a protected/default branch."
        : "branch_name is not a valid governed Git branch name.",
      PROTECTED_BRANCHES.has(branch.toLowerCase()) ? 403 : 400,
      { branch_name: branch }
    );
  }
  return branch;
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

export function repositoryOperationLeaseResourceKey({
  repository_owner,
  repository_name,
  branch_name,
} = {}) {
  const owner = requiredString(repository_owner, "repository_owner", {
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/,
  });
  const repo = requiredString(repository_name, "repository_name", {
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/,
  });
  const branch = validateBranchName(branch_name);
  return `github://${owner}/${repo}/branch/${branch}`;
}

export function normalizeRepositoryOperationLeaseInput(args = {}) {
  const repository_owner = requiredString(args.repository_owner, "repository_owner", {
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/,
  });
  const repository_name = requiredString(args.repository_name, "repository_name", {
    max: 100,
    pattern: /^[A-Za-z0-9_.-]+$/,
  });
  const branch_name = validateBranchName(args.branch_name);
  const operation_key = requiredString(args.operation_key, "operation_key", {
    max: 128,
    pattern: /^[A-Za-z0-9._:-]+$/,
  });
  const holder_run_id = requiredString(args.holder_run_id, "holder_run_id", {
    max: 64,
    pattern: /^[A-Za-z0-9._:-]+$/,
  });
  const holder_actor_type = requiredString(
    args.holder_actor_type || "platform_orchestrator",
    "holder_actor_type",
    { max: 64, pattern: /^[A-Za-z0-9._:-]+$/ }
  );
  const holder_actor_id = String(args.holder_actor_id || "").trim() || null;
  if (holder_actor_id && (holder_actor_id.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(holder_actor_id))) {
    throw leaseError(
      "repository_operation_lease_invalid_input",
      "holder_actor_id is invalid.",
      400,
      { field: "holder_actor_id" }
    );
  }
  const operation_fingerprint = String(args.operation_fingerprint || "").trim().toLowerCase()
    || sha256({ operation_key, holder_run_id });
  if (!/^[0-9a-f]{64}$/.test(operation_fingerprint)) {
    throw leaseError(
      "repository_operation_lease_invalid_fingerprint",
      "operation_fingerprint must be a SHA-256 hash.",
      400,
      { field: "operation_fingerprint" }
    );
  }
  const ttl_seconds = boundedInteger(
    args.ttl_seconds,
    DEFAULT_TTL_SECONDS,
    MIN_TTL_SECONDS,
    MAX_TTL_SECONDS,
    "ttl_seconds"
  );
  const resource_key = repositoryOperationLeaseResourceKey({
    repository_owner,
    repository_name,
    branch_name,
  });
  const resource_fingerprint = sha256({
    resource_key,
    operation_key,
    operation_fingerprint,
    holder_run_id,
    holder_actor_type,
    holder_actor_id,
  });
  return {
    repository_owner,
    repository_name,
    branch_name,
    resource_key,
    operation_key,
    operation_fingerprint,
    resource_fingerprint,
    holder_run_id,
    holder_actor_type,
    holder_actor_id,
    lease_mode: LEASE_MODE,
    ttl_seconds,
  };
}

function publicLease(row = {}) {
  if (!row || typeof row !== "object") return null;
  return {
    lease_id: row.lease_id || null,
    repository_owner: row.repository_owner || null,
    repository_name: row.repository_name || null,
    branch_name: row.branch_name || null,
    resource_key: row.resource_key || null,
    operation_key: row.operation_key || null,
    operation_fingerprint: row.operation_fingerprint || null,
    resource_fingerprint: row.resource_fingerprint || null,
    holder_run_id: row.holder_run_id || null,
    holder_actor_type: row.holder_actor_type || null,
    holder_actor_id: row.holder_actor_id || null,
    lease_mode: row.lease_mode || null,
    status: row.status || null,
    acquired_at: row.acquired_at || null,
    renewed_at: row.renewed_at || null,
    expires_at: row.expires_at || null,
    released_at: row.released_at || null,
    release_reason: row.release_reason || null,
    secrets_included: false,
  };
}

async function readLeaseById(executor, leaseId, { forUpdate = false } = {}) {
  const [rows] = await executor.query(
    `SELECT lease_id,repository_owner,repository_name,branch_name,resource_key,operation_key,
            operation_fingerprint,resource_fingerprint,holder_run_id,holder_actor_type,holder_actor_id,
            lease_mode,status,acquired_at,renewed_at,expires_at,released_at,release_reason
       FROM repository_operation_leases
      WHERE lease_id=?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [leaseId]
  );
  return rows?.[0] || null;
}

async function markExpiredForResource(connection, resourceKey) {
  await connection.query(
    `UPDATE repository_operation_leases
        SET status='expired',updated_at=CURRENT_TIMESTAMP
      WHERE resource_key=? AND status='active' AND expires_at<=CURRENT_TIMESTAMP`,
    [resourceKey]
  );
}

function duplicateKey(error) {
  return error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062;
}

export async function acquireRepositoryOperationLease(args = {}, deps = {}) {
  const input = normalizeRepositoryOperationLeaseInput(args);
  const pool = deps.pool || getPool();
  const connection = await pool.getConnection();
  let committed = false;
  try {
    await connection.beginTransaction();
    await markExpiredForResource(connection, input.resource_key);
    const [activeRows] = await connection.query(
      `SELECT lease_id,repository_owner,repository_name,branch_name,resource_key,operation_key,
              operation_fingerprint,resource_fingerprint,holder_run_id,holder_actor_type,holder_actor_id,
              lease_mode,status,acquired_at,renewed_at,expires_at,released_at,release_reason
         FROM repository_operation_leases
        WHERE resource_key=? AND status='active'
        LIMIT 1
        FOR UPDATE`,
      [input.resource_key]
    );
    const existing = activeRows?.[0] || null;
    if (existing) {
      const sameHolder = existing.holder_run_id === input.holder_run_id;
      const sameFingerprint = existing.resource_fingerprint === input.resource_fingerprint;
      if (!sameHolder || !sameFingerprint) {
        throw leaseError(
          "repository_operation_lease_conflict",
          "Another repository operation holds an active lease for this branch.",
          409,
          {
            resource_key: input.resource_key,
            active_lease_id: existing.lease_id,
            active_operation_key: existing.operation_key,
            active_holder_run_id: existing.holder_run_id,
            expires_at: existing.expires_at,
          }
        );
      }
      await connection.query(
        `UPDATE repository_operation_leases
            SET renewed_at=CURRENT_TIMESTAMP,
                expires_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
                updated_at=CURRENT_TIMESTAMP
          WHERE lease_id=? AND status='active'`,
        [input.ttl_seconds, existing.lease_id]
      );
      const renewed = await readLeaseById(connection, existing.lease_id);
      await connection.commit();
      committed = true;
      return {
        ok: true,
        classification: "repository_operation_lease_reused",
        reused: true,
        lease: publicLease(renewed),
        secrets_included: false,
      };
    }

    const leaseId = (deps.uuid || randomUUID)();
    try {
      await connection.query(
        `INSERT INTO repository_operation_leases
          (lease_id,repository_owner,repository_name,branch_name,resource_key,operation_key,
           operation_fingerprint,resource_fingerprint,holder_run_id,holder_actor_type,holder_actor_id,
           lease_mode,status,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',
                 DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`,
        [
          leaseId,
          input.repository_owner,
          input.repository_name,
          input.branch_name,
          input.resource_key,
          input.operation_key,
          input.operation_fingerprint,
          input.resource_fingerprint,
          input.holder_run_id,
          input.holder_actor_type,
          input.holder_actor_id,
          input.lease_mode,
          input.ttl_seconds,
        ]
      );
    } catch (error) {
      if (duplicateKey(error)) {
        throw leaseError(
          "repository_operation_lease_conflict",
          "A concurrent repository operation acquired the branch lease.",
          409,
          { resource_key: input.resource_key }
        );
      }
      throw error;
    }
    const created = await readLeaseById(connection, leaseId);
    if (!created || created.status !== "active" || created.resource_fingerprint !== input.resource_fingerprint) {
      throw leaseError(
        "repository_operation_lease_readback_failed",
        "Repository operation lease creation could not be verified.",
        500,
        { lease_id: leaseId, resource_key: input.resource_key }
      );
    }
    await connection.commit();
    committed = true;
    return {
      ok: true,
      classification: "repository_operation_lease_acquired",
      reused: false,
      lease: publicLease(created),
      secrets_included: false,
    };
  } catch (error) {
    if (!committed) {
      try {
        await connection.rollback();
      } catch {
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

function assertLeaseOwnership(row, holderRunId, expectedFingerprint = "") {
  if (!row) {
    throw leaseError(
      "repository_operation_lease_not_found",
      "Repository operation lease was not found.",
      404
    );
  }
  if (row.holder_run_id !== holderRunId) {
    throw leaseError(
      "repository_operation_lease_holder_mismatch",
      "Repository operation lease belongs to another run.",
      409,
      { lease_id: row.lease_id, holder_run_id: row.holder_run_id }
    );
  }
  if (expectedFingerprint && row.resource_fingerprint !== expectedFingerprint) {
    throw leaseError(
      "repository_operation_lease_fingerprint_mismatch",
      "Repository operation lease fingerprint does not match the expected operation.",
      409,
      { lease_id: row.lease_id }
    );
  }
}

export async function assertRepositoryOperationLeaseHolder(args = {}, deps = {}) {
  const leaseId = requiredString(args.lease_id, "lease_id", { max: 64 });
  const holderRunId = requiredString(args.holder_run_id, "holder_run_id", { max: 64 });
  const expectedFingerprint = String(args.resource_fingerprint || "").trim().toLowerCase();
  if (expectedFingerprint && !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw leaseError(
      "repository_operation_lease_invalid_fingerprint",
      "resource_fingerprint must be a SHA-256 hash.",
      400
    );
  }
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT lease_id,repository_owner,repository_name,branch_name,resource_key,operation_key,
            operation_fingerprint,resource_fingerprint,holder_run_id,holder_actor_type,holder_actor_id,
            lease_mode,status,acquired_at,renewed_at,expires_at,released_at,release_reason
       FROM repository_operation_leases
      WHERE lease_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP
      LIMIT 1`,
    [leaseId]
  );
  const active = rows?.[0] || null;
  if (!active) {
    const any = await readLeaseById(pool, leaseId);
    if (any?.status === "active") {
      throw leaseError(
        "repository_operation_lease_expired",
        "Repository operation lease has expired.",
        409,
        { lease_id: leaseId, expires_at: any.expires_at }
      );
    }
    assertLeaseOwnership(any, holderRunId, expectedFingerprint);
    throw leaseError(
      "repository_operation_lease_not_active",
      "Repository operation lease is not active.",
      409,
      { lease_id: leaseId, status: any?.status || null }
    );
  }
  assertLeaseOwnership(active, holderRunId, expectedFingerprint);
  return {
    ok: true,
    classification: "repository_operation_lease_holder_verified",
    lease: publicLease(active),
    secrets_included: false,
  };
}

export async function renewRepositoryOperationLease(args = {}, deps = {}) {
  const leaseId = requiredString(args.lease_id, "lease_id", { max: 64 });
  const holderRunId = requiredString(args.holder_run_id, "holder_run_id", { max: 64 });
  const ttlSeconds = boundedInteger(
    args.ttl_seconds,
    DEFAULT_TTL_SECONDS,
    MIN_TTL_SECONDS,
    MAX_TTL_SECONDS,
    "ttl_seconds"
  );
  const pool = deps.pool || getPool();
  const connection = await pool.getConnection();
  let committed = false;
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE repository_operation_leases
          SET status='expired',updated_at=CURRENT_TIMESTAMP
        WHERE lease_id=? AND status='active' AND expires_at<=CURRENT_TIMESTAMP`,
      [leaseId]
    );
    const row = await readLeaseById(connection, leaseId, { forUpdate: true });
    assertLeaseOwnership(row, holderRunId, String(args.resource_fingerprint || "").trim().toLowerCase());
    if (row.status !== "active") {
      throw leaseError(
        row.status === "expired"
          ? "repository_operation_lease_expired"
          : "repository_operation_lease_not_active",
        "Repository operation lease cannot be renewed because it is not active.",
        409,
        { lease_id: leaseId, status: row.status }
      );
    }
    await connection.query(
      `UPDATE repository_operation_leases
          SET renewed_at=CURRENT_TIMESTAMP,
              expires_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
              updated_at=CURRENT_TIMESTAMP
        WHERE lease_id=? AND status='active'`,
      [ttlSeconds, leaseId]
    );
    const renewed = await readLeaseById(connection, leaseId);
    await connection.commit();
    committed = true;
    return {
      ok: true,
      classification: "repository_operation_lease_renewed",
      lease: publicLease(renewed),
      secrets_included: false,
    };
  } catch (error) {
    if (!committed) {
      try {
        await connection.rollback();
      } catch {
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function releaseRepositoryOperationLease(args = {}, deps = {}) {
  const leaseId = requiredString(args.lease_id, "lease_id", { max: 64 });
  const holderRunId = requiredString(args.holder_run_id, "holder_run_id", { max: 64 });
  const reason = String(args.release_reason || "operation_complete").trim().slice(0, 500);
  const pool = deps.pool || getPool();
  const connection = await pool.getConnection();
  let committed = false;
  try {
    await connection.beginTransaction();
    const row = await readLeaseById(connection, leaseId, { forUpdate: true });
    assertLeaseOwnership(row, holderRunId, String(args.resource_fingerprint || "").trim().toLowerCase());
    if (row.status !== "active") {
      await connection.commit();
      committed = true;
      return {
        ok: true,
        classification: "repository_operation_lease_already_inactive",
        reused: true,
        lease: publicLease(row),
        secrets_included: false,
      };
    }
    await connection.query(
      `UPDATE repository_operation_leases
          SET status='released',released_at=CURRENT_TIMESTAMP,release_reason=?,updated_at=CURRENT_TIMESTAMP
        WHERE lease_id=? AND status='active'`,
      [reason || "operation_complete", leaseId]
    );
    const released = await readLeaseById(connection, leaseId);
    if (!released || released.status !== "released") {
      throw leaseError(
        "repository_operation_lease_release_readback_failed",
        "Repository operation lease release could not be verified.",
        500,
        { lease_id: leaseId }
      );
    }
    await connection.commit();
    committed = true;
    return {
      ok: true,
      classification: "repository_operation_lease_released",
      reused: false,
      lease: publicLease(released),
      secrets_included: false,
    };
  } catch (error) {
    if (!committed) {
      try {
        await connection.rollback();
      } catch {
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function expireStaleRepositoryOperationLeases(args = {}, deps = {}) {
  const limit = boundedInteger(args.limit, 100, 1, 500, "limit");
  const pool = deps.pool || getPool();
  const [result] = await pool.query(
    `UPDATE repository_operation_leases
        SET status='expired',updated_at=CURRENT_TIMESTAMP
      WHERE status='active' AND expires_at<=CURRENT_TIMESTAMP
      ORDER BY expires_at ASC
      LIMIT ${limit}`
  );
  return {
    ok: true,
    classification: "repository_operation_leases_expired",
    expired_count: Number(result?.affectedRows || 0),
    limit,
    secrets_included: false,
  };
}
