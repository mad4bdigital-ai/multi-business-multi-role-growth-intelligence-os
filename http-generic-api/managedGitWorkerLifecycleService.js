import { createHash, randomUUID } from "node:crypto";
import {
  createManagedGitEphemeralCheckout,
  getManagedGitEphemeralCheckoutPath,
  releaseManagedGitEphemeralCheckout,
  releaseManagedGitEphemeralCheckoutsForWorker,
} from "./managedGitEphemeralCheckoutExecutor.js";

const WORKSPACE_HANDLE = Symbol("managed_git_worker_workspace_handle");
const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const WORKER_OPERATIONS = new Set(["repo.change.execute", "repo.branch.reconcile", "operation.resume"]);
const ACTIVE_STATUSES = new Set(["allocated", "ready", "running", "cleaning"]);

function fail(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function text(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function digest(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function attachWorkspaceHandle(lifecycle, handle) {
  if (!lifecycle || !handle) return lifecycle;
  Object.defineProperty(lifecycle, WORKSPACE_HANDLE, {
    value: handle,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return lifecycle;
}

function workspaceHandleOf(lifecycle) {
  return lifecycle?.[WORKSPACE_HANDLE] || null;
}

export function getManagedGitWorkerWorkspacePath(lifecycle = {}) {
  if (lifecycle?.required !== true) return null;
  const handle = workspaceHandleOf(lifecycle);
  if (!handle) {
    throw fail(500, "MANAGED_GIT_WORKER_WORKSPACE_HANDLE_REQUIRED", "The managed Git workspace handle is unavailable.");
  }
  return getManagedGitEphemeralCheckoutPath(handle);
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(Math.floor(number), max)) : fallback;
}

function principal(auth = {}) {
  const mode = text(auth.mode || auth.caller_type, 64).toLowerCase();
  if (auth.is_admin === true || ADMIN_MODES.has(mode)) {
    return {
      scope: "admin",
      tenant_id: null,
      user_id: text(auth.user_id || auth.admin_id, 64) || null,
    };
  }
  if (mode === "user_jwt" && auth.tenant_id && auth.user_id) {
    return {
      scope: "tenant",
      tenant_id: text(auth.tenant_id, 64),
      user_id: text(auth.user_id, 64),
    };
  }
  throw fail(403, "MANAGED_GIT_WORKER_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
}

function operationRequiresWorker(operationKey) {
  return WORKER_OPERATIONS.has(text(operationKey, 128));
}

function validGitName(value, allowSlash = false) {
  const candidate = text(value, 255);
  if (!candidate || /[\u0000-\u001f\u007f\s~^:?*[\]\\]/.test(candidate)) return false;
  if (candidate.includes("..") || candidate.includes("@{") || candidate.includes("//")) return false;
  if (candidate.startsWith("/") || candidate.endsWith("/") || candidate.endsWith(".") || candidate.endsWith(".lock")) return false;
  if (!allowSlash && candidate.includes("/")) return false;
  return true;
}

function validSha(value) {
  const candidate = text(value, 64).toLowerCase();
  return /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
}

function providerBody(result) {
  let body = result?.body !== undefined ? result.body : result;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!body || typeof body !== "object") break;
    if (body?.result?.result?.body && typeof body.result.result.body === "object") body = body.result.result.body;
    else if (body?.result?.body && typeof body.result.body === "object") body = body.result.body;
    else if (body?.body && typeof body.body === "object") body = body.body;
    else if (body?.data?.data && typeof body.data.data === "object") body = body.data.data;
    else break;
  }
  return body || {};
}

function branchHeadSha(result) {
  const body = providerBody(result);
  return validSha(
    body?.object?.sha
    || body?.data?.object?.sha
    || body?.sha
    || body?.data?.sha
    || body?.ref?.object?.sha,
  );
}

async function db(pool, sql, params = []) {
  if (!pool || typeof pool.query !== "function") {
    throw fail(500, "MANAGED_GIT_WORKER_POOL_REQUIRED", "Managed Git worker lifecycle requires a database pool.");
  }
  try {
    return await pool.query(sql, params);
  } catch (cause) {
    if (cause?.code === "ER_DUP_ENTRY") throw cause;
    throw fail(
      503,
      "MANAGED_GIT_WORKER_LEDGER_UNAVAILABLE",
      "The managed Git worker ledger is unavailable.",
      { cause_code: cause?.code || null, retryable: true },
    );
  }
}

async function readHead(dispatch, { owner, repo, branch }) {
  if (typeof dispatch !== "function") {
    throw fail(500, "MANAGED_GIT_WORKER_DISPATCH_REQUIRED", "A governed dispatcher is required.");
  }
  let result;
  try {
    result = await dispatch("runtime_endpoint_call", {
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_get_git_ref_head",
      path_params: { owner, repo, branch },
      credential_scope: "platform",
      timeout_seconds: 30,
    });
  } catch (cause) {
    throw fail(
      503,
      "MANAGED_GIT_WORKER_CHECKOUT_UNAVAILABLE",
      "The branch head could not be read for managed checkout.",
      { cause_code: cause?.code || null, retryable: true },
    );
  }
  const status = Number(result?.status || result?.http_status || 200);
  const sha = branchHeadSha(result);
  if (status >= 400 || !sha) {
    throw fail(
      status >= 400 && status < 600 ? status : 503,
      "MANAGED_GIT_WORKER_CHECKOUT_UNAVAILABLE",
      "The branch head could not be resolved for managed checkout.",
      { provider_status: status, retryable: status >= 500 },
    );
  }
  return sha;
}

async function runContext(pool, input = {}) {
  const runId = text(input.run_id || input.runId, 64);
  if (!runId) return null;
  const [rows] = await db(
    pool,
    `SELECT run_id, owner, repo, branch_name
       FROM repository_automation_runs
      WHERE run_id = ?
      LIMIT 1`,
    [runId],
  );
  return rows?.[0] || null;
}

function repositoryContext(input = {}, run = null) {
  const owner = text(input.owner || run?.owner, 191);
  const repo = text(input.repo || run?.repo, 191);
  const branch = text(input.branch || input.head_ref || input.headRef || run?.branch_name, 255);
  if (!validGitName(owner) || !validGitName(repo)) {
    throw fail(400, "MANAGED_GIT_WORKER_REPOSITORY_INVALID", "owner and repo must be valid Git identifiers.");
  }
  if (!validGitName(branch, true)) {
    throw fail(400, "MANAGED_GIT_WORKER_BRANCH_INVALID", "A valid branch is required.");
  }
  return { owner, repo, branch };
}

function publicRow(row = {}) {
  const parse = (value) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return null; }
  };
  return {
    worker_id: row.worker_id,
    run_id: row.run_id || null,
    operation_key: row.operation_key,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch_name,
    checkout_strategy: row.checkout_strategy || "virtual_git_tree",
    status: row.worker_status,
    checkout_head_sha: row.checkout_head_sha || null,
    final_head_sha: row.final_head_sha || null,
    workspace_fingerprint: row.workspace_fingerprint || null,
    lease_expires_at: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    allocated_at: row.allocated_at ? new Date(row.allocated_at).toISOString() : null,
    ready_at: row.ready_at ? new Date(row.ready_at).toISOString() : null,
    running_at: row.running_at ? new Date(row.running_at).toISOString() : null,
    cleanup_started_at: row.cleanup_started_at ? new Date(row.cleanup_started_at).toISOString() : null,
    released_at: row.released_at ? new Date(row.released_at).toISOString() : null,
    workspace_released: Boolean(row.released_at),
    readback: parse(row.readback_json),
    error: parse(row.error_json),
    secrets_included: false,
  };
}

export async function prepareManagedGitWorkerLifecycle({
  pool,
  auth = {},
  input = {},
  operationKey = "",
  dispatch,
  now = new Date(),
  workspaceRoot = process.env.MANAGED_GIT_WORKSPACE_ROOT,
  createWorkspace = createManagedGitEphemeralCheckout,
} = {}) {
  if (!operationRequiresWorker(operationKey)) {
    return { required: false, status: "not_required", operation_key: operationKey || null, input, secrets_included: false };
  }

  const context = repositoryContext(input, await runContext(pool, input));
  const checkoutHeadSha = await readHead(dispatch, context);
  const expectedHeadSha = validSha(input.expected_head_sha || input.expectedHeadSha);
  if (expectedHeadSha && expectedHeadSha !== checkoutHeadSha) {
    throw fail(409, "MANAGED_GIT_WORKER_HEAD_MISMATCH", "The branch head changed before managed checkout.", {
      ...context,
      expected_head_sha: expectedHeadSha,
      actual_head_sha: checkoutHeadSha,
      retryable: false,
    });
  }

  const actor = principal(auth);
  const workerId = randomUUID();
  const operation = text(operationKey, 128);
  const leaseKey = digest(JSON.stringify({ ...actor, ...context, operation_key: operation }));
  const ttlMinutes = boundedInt(input.managed_worker_ttl_minutes || input.managedWorkerTtlMinutes, 30, 5, 120);
  const leaseExpiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const fingerprint = digest(JSON.stringify({
    checkout_strategy: "ephemeral_checkout",
    ...context,
    checkout_head_sha: checkoutHeadSha,
    worker_id: workerId,
  }));

  try {
    await db(
      pool,
      `INSERT INTO operation_managed_git_worker_leases (
         worker_id, lease_key_sha256, active_lease_key, principal_scope, tenant_id, user_id,
         operation_key, owner, repo, branch_name, checkout_strategy,
         checkout_head_sha, workspace_fingerprint, worker_status,
         lease_expires_at, secrets_included
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ephemeral_checkout', ?, ?, 'allocated', ?, 0)`,
      [
        workerId, leaseKey, leaseKey, actor.scope, actor.tenant_id, actor.user_id,
        operation, context.owner, context.repo, context.branch,
        checkoutHeadSha, fingerprint, leaseExpiresAt,
      ],
    );
  } catch (cause) {
    if (cause?.code !== "ER_DUP_ENTRY") throw cause;
    const [rows] = await db(
      pool,
      `SELECT worker_id, worker_status, lease_expires_at
         FROM operation_managed_git_worker_leases
        WHERE active_lease_key = ?
        LIMIT 1`,
      [leaseKey],
    );
    throw fail(409, "MANAGED_GIT_WORKER_LEASE_CONFLICT", "Another managed worker holds the active branch lease.", {
      ...context,
      active_worker_id: rows?.[0]?.worker_id || null,
      active_status: rows?.[0]?.worker_status || null,
      lease_expires_at: rows?.[0]?.lease_expires_at || null,
      retryable: true,
    });
  }

  let workspaceHandle = null;
  try {
    if (typeof createWorkspace !== "function") {
      throw fail(500, "MANAGED_GIT_WORKER_WORKSPACE_EXECUTOR_REQUIRED", "A managed Git workspace executor is required.");
    }
    workspaceHandle = await createWorkspace({
      worker_id: workerId,
      root_dir: workspaceRoot,
    });
  } catch (error) {
    await db(
      pool,
      `UPDATE operation_managed_git_worker_leases
          SET worker_status = 'failed', active_lease_key = NULL, error_json = ?,
              released_at = NOW(), updated_at = NOW()
        WHERE worker_id = ?`,
      [
        JSON.stringify({
          code: error?.code || "MANAGED_GIT_WORKER_WORKSPACE_CREATE_FAILED",
          message: error?.message || "The isolated workspace could not be created.",
          details: error?.details || null,
          secrets_included: false,
        }),
        workerId,
      ],
    );
    throw error;
  }

  try {
    await db(
      pool,
      `UPDATE operation_managed_git_worker_leases
          SET worker_status = 'ready', ready_at = NOW(), updated_at = NOW()
        WHERE worker_id = ? AND worker_status = 'allocated'`,
      [workerId],
    );
  } catch (error) {
    let cleanupError = null;
    try {
      await releaseManagedGitEphemeralCheckout(workspaceHandle);
    } catch (cleanupFailure) {
      cleanupError = {
        code: cleanupFailure?.code || "MANAGED_GIT_WORKER_WORKSPACE_CLEANUP_FAILED",
        message: cleanupFailure?.message || "Compensating workspace cleanup failed.",
        details: cleanupFailure?.details || null,
        secrets_included: false,
      };
    }
    await db(
      pool,
      `UPDATE operation_managed_git_worker_leases
          SET worker_status = 'failed', active_lease_key = NULL, error_json = ?,
              released_at = NOW(), updated_at = NOW()
        WHERE worker_id = ?`,
      [
        JSON.stringify({
          code: "MANAGED_GIT_WORKER_READY_TRANSITION_FAILED",
          message: "The managed Git worker could not enter the ready state.",
          details: {
            cause_code: String(error?.code || "ready_transition_failed"),
            cleanup_error: cleanupError,
          },
          secrets_included: false,
        }),
        workerId,
      ],
    ).catch(() => {});
    throw fail(503, "MANAGED_GIT_WORKER_READY_TRANSITION_FAILED", "The managed Git worker could not enter the ready state.", {
      cause_code: String(error?.code || "ready_transition_failed"),
      cleanup_verified: cleanupError === null,
      workspace_path_exposed: false,
      retryable: true,
    });
  }

  return attachWorkspaceHandle({
    required: true,
    status: "ready",
    operation_key: operation,
    worker_id: workerId,
    checkout_strategy: "ephemeral_checkout",
    checkout_head_sha: checkoutHeadSha,
    workspace_fingerprint: fingerprint,
    workspace_created: workspaceHandle?.workspace_created === true,
    git_repository_initialized: workspaceHandle?.git_repository_initialized === true,
    remote_fetch_performed: false,
    remote_checkout_performed: false,
    credentials_read: false,
    workspace_path_exposed: false,
    lease_expires_at: leaseExpiresAt.toISOString(),
    input: {
      ...input,
      ...context,
      expected_head_sha: checkoutHeadSha,
      managed_worker_id: workerId,
    },
    secrets_included: false,
  }, workspaceHandle);
}

export async function markManagedGitWorkerRunning({ pool, lifecycle = {} } = {}) {
  if (lifecycle?.required !== true || !lifecycle?.worker_id) return lifecycle;
  await db(
    pool,
    `UPDATE operation_managed_git_worker_leases
        SET worker_status = 'running', running_at = NOW(), updated_at = NOW()
      WHERE worker_id = ? AND worker_status = 'ready'`,
    [lifecycle.worker_id],
  );
  return attachWorkspaceHandle(
    { ...lifecycle, status: "running", secrets_included: false },
    workspaceHandleOf(lifecycle),
  );
}

export async function finalizeManagedGitWorkerLifecycle({
  pool,
  lifecycle = {},
  result = {},
  dispatch,
  releaseWorkspace = releaseManagedGitEphemeralCheckout,
} = {}) {
  if (lifecycle?.required !== true || !lifecycle?.worker_id) {
    return {
      required: lifecycle?.required === true,
      status: lifecycle?.status || "not_required",
      worker_id: lifecycle?.worker_id || null,
      secrets_included: false,
    };
  }

  await db(
    pool,
    `UPDATE operation_managed_git_worker_leases
        SET worker_status = 'cleaning', cleanup_started_at = NOW(), updated_at = NOW()
      WHERE worker_id = ? AND worker_status IN ('allocated','ready','running')`,
    [lifecycle.worker_id],
  );

  let finalHeadSha = null;
  let readbackError = null;
  let cleanupResult = null;
  let cleanupError = null;

  try {
    finalHeadSha = await readHead(dispatch, lifecycle.input || {});
  } catch (error) {
    readbackError = {
      code: error?.code || "MANAGED_GIT_WORKER_READBACK_FAILED",
      message: error?.message || "Managed worker final readback failed.",
      details: error?.details || null,
      secrets_included: false,
    };
  }

  try {
    const handle = workspaceHandleOf(lifecycle);
    if (!handle) {
      throw fail(500, "MANAGED_GIT_WORKER_WORKSPACE_HANDLE_REQUIRED", "The managed Git workspace handle is unavailable.");
    }
    if (typeof releaseWorkspace !== "function") {
      throw fail(500, "MANAGED_GIT_WORKER_WORKSPACE_RELEASE_REQUIRED", "A managed Git workspace release function is required.");
    }
    cleanupResult = await releaseWorkspace(handle);
  } catch (error) {
    cleanupError = {
      code: error?.code || "MANAGED_GIT_WORKER_WORKSPACE_CLEANUP_FAILED",
      message: error?.message || "Managed worker workspace cleanup failed.",
      details: error?.details || null,
      secrets_included: false,
    };
  }

  const workspaceReleased = cleanupResult?.workspace_released === true;
  const cleanupVerified = cleanupResult?.cleanup_verified === true;
  const readback = {
    checkout_head_sha: lifecycle.checkout_head_sha || null,
    final_head_sha: finalHeadSha,
    head_changed: Boolean(lifecycle.checkout_head_sha && finalHeadSha && lifecycle.checkout_head_sha !== finalHeadSha),
    operation_status: result?.status || null,
    operation_ok: result?.ok !== false,
    workspace_created: lifecycle.workspace_created === true,
    workspace_released: workspaceReleased,
    cleanup_verified: cleanupVerified,
    workspace_path_exposed: false,
    secrets_included: false,
  };
  const finalError = readbackError || cleanupError
    ? {
        code: "MANAGED_GIT_WORKER_FINALIZATION_FAILED",
        message: "Managed worker finalization requires attention.",
        details: {
          readback_error: readbackError,
          cleanup_error: cleanupError,
        },
        secrets_included: false,
      }
    : null;
  const finalStatus = finalError ? "failed" : "cleaned";
  const runId = text(result?.run_id || result?.operation_id, 64) || null;

  await db(
    pool,
    `UPDATE operation_managed_git_worker_leases
        SET run_id = ?, worker_status = ?, active_lease_key = NULL, final_head_sha = ?,
            readback_json = ?, error_json = ?, released_at = NOW(), updated_at = NOW()
      WHERE worker_id = ?`,
    [
      runId,
      finalStatus,
      finalHeadSha,
      JSON.stringify(readback),
      finalError ? JSON.stringify(finalError) : null,
      lifecycle.worker_id,
    ],
  );

  return {
    required: true,
    status: finalStatus,
    worker_id: lifecycle.worker_id,
    run_id: runId,
    checkout_strategy: lifecycle.checkout_strategy || "ephemeral_checkout",
    checkout_head_sha: lifecycle.checkout_head_sha || null,
    final_head_sha: finalHeadSha,
    workspace_fingerprint: lifecycle.workspace_fingerprint || null,
    workspace_created: lifecycle.workspace_created === true,
    workspace_released: workspaceReleased,
    cleanup_verified: cleanupVerified,
    workspace_path_exposed: false,
    readback,
    error: finalError,
    readback_required: Boolean(finalError),
    secrets_included: false,
  };
}

export async function readManagedGitWorkerLease(input = {}, deps = {}) {
  const workerId = text(input.worker_id || input.workerId, 64);
  if (!workerId) throw fail(400, "MANAGED_GIT_WORKER_ID_REQUIRED", "worker_id is required.");
  const actor = principal(deps.auth || {});
  const params = [workerId];
  let ownership = "";
  if (actor.scope === "tenant") {
    ownership = "AND tenant_id = ? AND user_id = ?";
    params.push(actor.tenant_id, actor.user_id);
  }
  const [rows] = await db(
    deps.pool,
    `SELECT worker_id, run_id, operation_key, owner, repo, branch_name,
            checkout_strategy, worker_status, checkout_head_sha, final_head_sha,
            workspace_fingerprint, lease_expires_at, allocated_at, ready_at,
            running_at, cleanup_started_at, released_at, readback_json, error_json
       FROM operation_managed_git_worker_leases
      WHERE worker_id = ?
        ${ownership}
      LIMIT 1`,
    params,
  );
  if (!rows?.[0]) throw fail(404, "MANAGED_GIT_WORKER_NOT_FOUND", "The managed Git worker lease was not found.");
  return { ok: true, principal_scope: actor.scope, worker: publicRow(rows[0]), secrets_included: false };
}

export async function expireManagedGitWorkerLeases({
  pool,
  limit = 100,
  workspaceRoot = process.env.MANAGED_GIT_WORKSPACE_ROOT,
  releaseExpiredWorkspaces = releaseManagedGitEphemeralCheckoutsForWorker,
} = {}) {
  const safeLimit = boundedInt(limit, 100, 1, 500);
  const [rows] = await db(
    pool,
    `SELECT worker_id
       FROM operation_managed_git_worker_leases
      WHERE lease_expires_at <= NOW()
        AND worker_status IN ('allocated','ready','running','cleaning')
      ORDER BY lease_expires_at ASC
      LIMIT ?`,
    [safeLimit],
  );
  const ids = (rows || []).map((row) => row.worker_id).filter(Boolean);
  let cleanupFailureCount = 0;
  for (const workerId of ids) {
    let cleanup = null;
    let cleanupError = null;
    try {
      if (typeof releaseExpiredWorkspaces !== "function") {
        throw fail(500, "MANAGED_GIT_WORKER_WORKSPACE_RELEASE_REQUIRED", "A managed Git workspace release function is required.");
      }
      cleanup = await releaseExpiredWorkspaces({
        worker_id: workerId,
        root_dir: workspaceRoot,
      });
    } catch (error) {
      cleanupFailureCount += 1;
      cleanupError = {
        code: error?.code || "MANAGED_GIT_WORKER_WORKSPACE_CLEANUP_FAILED",
        message: error?.message || "Expired workspace cleanup failed.",
        details: error?.details || null,
        secrets_included: false,
      };
    }
    await db(
      pool,
      `UPDATE operation_managed_git_worker_leases
          SET worker_status = 'expired', active_lease_key = NULL,
              readback_json = ?, error_json = ?, released_at = NOW(), updated_at = NOW()
        WHERE worker_id = ?
          AND worker_status IN ('allocated','ready','running','cleaning')`,
      [
        JSON.stringify({
          workspace_released: cleanup?.workspace_released === true,
          cleanup_verified: cleanup?.cleanup_verified === true,
          cleanup_count: Number(cleanup?.cleanup_count || 0),
          workspace_path_exposed: false,
          secrets_included: false,
        }),
        JSON.stringify({
          code: cleanupError ? "MANAGED_GIT_WORKER_LEASE_EXPIRED_CLEANUP_FAILED" : "MANAGED_GIT_WORKER_LEASE_EXPIRED",
          message: cleanupError
            ? "The managed worker lease expired and workspace cleanup requires attention."
            : "The managed worker lease expired and its workspace was released.",
          details: cleanupError ? { cleanup_error: cleanupError } : null,
          secrets_included: false,
        }),
        workerId,
      ],
    );
  }
  return {
    ok: cleanupFailureCount === 0,
    expired_count: ids.length,
    cleanup_failure_count: cleanupFailureCount,
    worker_ids: ids,
    workspace_path_exposed: false,
    secrets_included: false,
  };
}

export const _testingManagedGitWorkerLifecycleService = {
  ACTIVE_STATUSES,
  operationRequiresWorker,
  validGitName,
  validSha,
  providerBody,
  branchHeadSha,
  repositoryContext,
  publicRow,
};
