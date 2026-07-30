import { randomUUID } from "node:crypto";
import { resolveEffectiveCredential } from "./credentialResolver.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";

const CREDENTIAL_STATE = Symbol("managed_git_repository_credential_state");
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 30;
const MAX_SECRET_BYTES = 16 * 1024;

export class ManagedGitRepositoryCredentialBindingError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "ManagedGitRepositoryCredentialBindingError";
    this.code = code;
    this.status = status;
    this.details = {
      ...details,
      retryable: details?.retryable === true,
      credential_secret_exposed: false,
      persistent_credential_file_created: false,
      secrets_included: false,
    };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new ManagedGitRepositoryCredentialBindingError(code, message, status, details);
}

function text(value, field, { max = 191, pattern = SAFE_ID, optional = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized && optional) return null;
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("MANAGED_GIT_CREDENTIAL_INPUT_INVALID", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function repositoryPart(value, field) {
  return text(value, field, { max: 100, pattern: REPOSITORY_PART });
}

function normalizeNow(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("MANAGED_GIT_CREDENTIAL_TIME_INVALID", "now is invalid.", 400, { field: "now" });
  }
  return date;
}

function normalizeTtl(value) {
  const parsed = value === undefined || value === null ? MAX_TTL_SECONDS : Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_TTL_SECONDS || parsed > MAX_TTL_SECONDS) {
    fail("MANAGED_GIT_CREDENTIAL_TTL_INVALID", `ttl_seconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}.`, 400, {
      field: "ttl_seconds",
      minimum: MIN_TTL_SECONDS,
      maximum: MAX_TTL_SECONDS,
    });
  }
  return parsed;
}

function normalizeExpiry(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function secretBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value ?? ""), "utf8");
  if (buffer.length === 0 || buffer.length > MAX_SECRET_BYTES) {
    buffer.fill(0);
    fail("MANAGED_GIT_CREDENTIAL_SECRET_INVALID", "The resolved repository credential is invalid.", 503, {
      retryable: false,
    });
  }
  return buffer;
}

function attachState(handle, state) {
  Object.defineProperty(handle, CREDENTIAL_STATE, {
    value: state,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(handle);
}

function stateOf(binding) {
  const state = binding?.[CREDENTIAL_STATE];
  if (!state || !Buffer.isBuffer(state.secret)) {
    fail("MANAGED_GIT_CREDENTIAL_BINDING_INVALID", "The repository credential binding is invalid.", 400);
  }
  return state;
}

function assertScope(binding, state, { worker_id, owner, repo } = {}) {
  const workerId = text(worker_id, "worker_id");
  const normalizedOwner = repositoryPart(owner, "owner");
  const normalizedRepo = repositoryPart(repo, "repo");
  if (workerId !== state.worker_id || normalizedOwner !== state.owner || normalizedRepo !== state.repo) {
    fail("MANAGED_GIT_CREDENTIAL_SCOPE_MISMATCH", "The repository credential binding does not match this worker or repository.", 403, {
      worker_match: workerId === state.worker_id,
      repository_match: normalizedOwner === state.owner && normalizedRepo === state.repo,
    });
  }
}

function assertUsable(binding, state, now) {
  if (state.released) {
    fail("MANAGED_GIT_CREDENTIAL_BINDING_RELEASED", "The repository credential binding has already been released.", 409);
  }
  if (now.getTime() >= state.expires_at_ms) {
    fail("MANAGED_GIT_CREDENTIAL_BINDING_EXPIRED", "The repository credential binding has expired.", 410, {
      expires_at: binding.expires_at,
    });
  }
}

async function resolveRepositoryCredential({
  pool,
  auth,
  owner,
  repo,
  connection_id,
  credential_action_key,
  credential_target_key,
  credential_role,
  allow_platform_fallback,
  resolve_credential,
  resolve_github_app_token,
}) {
  try {
    const resolved = await resolve_credential({
      pool,
      auth,
      connectionId: connection_id,
      actionKey: credential_action_key,
      targetKey: credential_target_key,
      credentialRole: credential_role,
      providerFamily: "github",
      connectorFamily: "github",
      includeSecret: true,
      allowPlatformFallback: allow_platform_fallback,
    });
    if (resolved?.secret !== undefined && resolved?.secret !== null && resolved?.secret !== "") {
      return {
        secret: resolved.secret,
        source: resolved.credential_source || "credential_binding",
        owner_type: resolved.owner_type || null,
        source_binding_id: resolved.credential_binding_id || null,
        connection_id: resolved.connection_id || connection_id || null,
        installation_id: resolved.installation_id || null,
        provider_expires_at: normalizeExpiry(resolved.expires_at || resolved.expiry || null),
      };
    }
  } catch (error) {
    if (error?.code !== "CREDENTIAL_BINDING_NOT_FOUND" || !allow_platform_fallback) throw error;
  }

  if (!allow_platform_fallback) {
    fail("MANAGED_GIT_REPOSITORY_CREDENTIAL_NOT_FOUND", "No repository credential binding is available.", 503, {
      retryable: false,
    });
  }
  if (typeof resolve_github_app_token !== "function") {
    fail("MANAGED_GIT_GITHUB_APP_RESOLVER_REQUIRED", "A GitHub App credential resolver is required.", 500);
  }
  const fallback = await resolve_github_app_token({ owner, repo });
  if (!fallback?.token) {
    fail("MANAGED_GIT_REPOSITORY_CREDENTIAL_NOT_FOUND", "No repository credential binding is available.", 503, {
      retryable: true,
    });
  }
  return {
    secret: fallback.token,
    source: "github_app_installation_token",
    owner_type: "platform",
    source_binding_id: null,
    connection_id: null,
    installation_id: fallback.installationId || null,
    provider_expires_at: normalizeExpiry(fallback.expiresAt || null),
  };
}

export async function createManagedGitRepositoryCredentialBinding({
  pool,
  auth = {},
  worker_id,
  owner,
  repo,
  connection_id = null,
  credential_action_key = null,
  credential_target_key = null,
  credential_role = null,
  allow_platform_fallback = false,
  ttl_seconds = MAX_TTL_SECONDS,
  now = new Date(),
  resolve_credential = resolveEffectiveCredential,
  resolve_github_app_token = getGitHubAppInstallationToken,
} = {}) {
  const workerId = text(worker_id, "worker_id");
  const normalizedOwner = repositoryPart(owner, "owner");
  const normalizedRepo = repositoryPart(repo, "repo");
  const connectionId = text(connection_id, "connection_id", { optional: true });
  const actionKey = text(credential_action_key, "credential_action_key", { optional: true });
  const targetKey = text(credential_target_key, "credential_target_key", { optional: true });
  const role = text(credential_role, "credential_role", { optional: true });
  if (typeof resolve_credential !== "function") {
    fail("MANAGED_GIT_CREDENTIAL_RESOLVER_REQUIRED", "A repository credential resolver is required.", 500);
  }
  const issuedAt = normalizeNow(now);
  const requestedTtl = normalizeTtl(ttl_seconds);
  const resolved = await resolveRepositoryCredential({
    pool,
    auth,
    owner: normalizedOwner,
    repo: normalizedRepo,
    connection_id: connectionId,
    credential_action_key: actionKey,
    credential_target_key: targetKey,
    credential_role: role,
    allow_platform_fallback: allow_platform_fallback === true,
    resolve_credential,
    resolve_github_app_token,
  });
  const providerExpiry = resolved.provider_expires_at;
  const requestedExpiryMs = issuedAt.getTime() + requestedTtl * 1000;
  const expiresAtMs = providerExpiry
    ? Math.min(requestedExpiryMs, providerExpiry.getTime())
    : requestedExpiryMs;
  if (expiresAtMs <= issuedAt.getTime()) {
    fail("MANAGED_GIT_CREDENTIAL_PROVIDER_EXPIRY_INVALID", "The resolved repository credential is already expired.", 503, {
      retryable: true,
    });
  }
  const secret = secretBuffer(resolved.secret);
  const bindingId = randomUUID();
  const expiresAt = new Date(expiresAtMs);
  const effectiveTtl = Math.max(1, Math.floor((expiresAtMs - issuedAt.getTime()) / 1000));
  return attachState({
    credential_binding_id: bindingId,
    worker_id: workerId,
    owner: normalizedOwner,
    repo: normalizedRepo,
    provider_family: "github",
    credential_role: role || "repository_token",
    credential_source: resolved.source,
    credential_owner_type: resolved.owner_type,
    source_binding_id: resolved.source_binding_id,
    connection_id: resolved.connection_id,
    installation_id: resolved.installation_id,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    ttl_seconds: effectiveTtl,
    credential_payload_read: true,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    provider_calls_performed: resolved.source === "github_app_installation_token",
    released: false,
    secrets_included: false,
  }, {
    secret,
    worker_id: workerId,
    owner: normalizedOwner,
    repo: normalizedRepo,
    expires_at_ms: expiresAtMs,
    released: false,
  });
}

export function readManagedGitRepositoryCredentialBinding(binding, { now = new Date() } = {}) {
  const state = stateOf(binding);
  const current = normalizeNow(now);
  return {
    ...binding,
    active: !state.released && current.getTime() < state.expires_at_ms,
    expired: current.getTime() >= state.expires_at_ms,
    released: state.released,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    secrets_included: false,
  };
}

export async function withManagedGitRepositoryCredential(binding, scope, callback, { now = new Date() } = {}) {
  if (typeof callback !== "function") {
    fail("MANAGED_GIT_CREDENTIAL_CALLBACK_REQUIRED", "A repository credential callback is required.", 500);
  }
  const state = stateOf(binding);
  const current = normalizeNow(now);
  assertScope(binding, state, scope);
  assertUsable(binding, state, current);
  const copy = Buffer.from(state.secret);
  try {
    return await callback(copy, {
      credential_binding_id: binding.credential_binding_id,
      expires_at: binding.expires_at,
      credential_source: binding.credential_source,
      credential_secret_exposed: false,
      persistent_credential_file_created: false,
      secrets_included: false,
    });
  } finally {
    copy.fill(0);
  }
}

export function releaseManagedGitRepositoryCredentialBinding(binding) {
  const state = stateOf(binding);
  const alreadyReleased = state.released;
  if (!alreadyReleased) {
    state.secret.fill(0);
    state.released = true;
  }
  return {
    credential_binding_id: binding.credential_binding_id,
    worker_id: binding.worker_id,
    released: true,
    already_released: alreadyReleased,
    credential_zeroized: true,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    secrets_included: false,
  };
}

export const _testingManagedGitRepositoryCredentialBinding = Object.freeze({
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MAX_SECRET_BYTES,
});
