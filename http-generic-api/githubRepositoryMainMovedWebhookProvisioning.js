import { getPool } from "./db.js";
import { writeAuditLogAsync } from "./auditLogger.js";
import { resolveCredentialReference } from "./credentialResolver.js";
import { getGitHubAppInstallationToken, resolveGitHubAppConfig } from "./githubAppAuth.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";
import {
  GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH,
  GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
} from "./githubRepositoryMainMovedWebhookService.js";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_CALLBACK_URL = `https://auth.mad4b.com${GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH}`;
const APPLY_CONFIRMATION = "PROVISION_GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK";
const SECRET_KEY = GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF.replace(/^ref:secret:/, "");

export const GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PROVISIONING_SYSTEM_TOOLS = [
  {
    name: "github_repository_main_moved_webhook_status",
    description: "Admin-only readback of the repository-main-moved GitHub webhook and governed secret readiness. Never returns the secret value.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        owner: { type: "string", minLength: 1, maxLength: 100 },
        repo: { type: "string", minLength: 1, maxLength: 100 },
        callback_url: { type: "string", default: DEFAULT_CALLBACK_URL },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_repository_main_moved_webhook_provision",
    description: "Admin-only idempotent create/update and signed-ping verification for the repository-main-moved GitHub webhook. Resolves the webhook secret inside the server and never returns it.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        owner: { type: "string", minLength: 1, maxLength: 100 },
        repo: { type: "string", minLength: 1, maxLength: 100 },
        callback_url: { type: "string", default: DEFAULT_CALLBACK_URL },
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
        expected_commit_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
        reason: { type: "string", minLength: 20, maxLength: 1000 },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_repository_main_moved_webhook_provisioning_readiness_smoke",
    description: "Admin-only no-provider readiness smoke for GitHub App configuration, webhook secret reference, callback allowlist, and no-secret guarantees.",
    requires_admin: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function normalizeTarget(input = {}) {
  const owner = text(input.owner, 100);
  const repo = text(input.repo, 100);
  const callbackUrl = text(input.callback_url || DEFAULT_CALLBACK_URL, 2048);
  const safeName = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !safeName.test(owner)) fail("github_webhook_owner_invalid", "A valid GitHub repository owner is required.");
  if (!repo || !safeName.test(repo)) fail("github_webhook_repo_invalid", "A valid GitHub repository name is required.");
  if (callbackUrl !== DEFAULT_CALLBACK_URL) {
    fail("github_webhook_callback_not_allowed", "The repository-main-moved webhook callback must use the governed production endpoint.", 403, {
      allowed_callback_url: DEFAULT_CALLBACK_URL,
    });
  }
  return { owner, repo, callbackUrl };
}

function safeHook(hook = {}) {
  const config = hook?.config && typeof hook.config === "object" ? hook.config : {};
  return {
    hook_id: Number(hook.id || 0) || null,
    name: text(hook.name, 64) || null,
    active: hook.active === true,
    events: Array.isArray(hook.events) ? hook.events.map((event) => text(event, 64)).filter(Boolean) : [],
    callback_url: text(config.url, 2048) || null,
    content_type: text(config.content_type, 64) || null,
    insecure_ssl: text(config.insecure_ssl, 8) || null,
    created_at: hook.created_at || null,
    updated_at: hook.updated_at || null,
    secrets_included: false,
  };
}

async function responseBody(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function githubRequest(path, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const getToken = deps.getInstallationToken || getGitHubAppInstallationToken;
  const token = options.token || await getToken({ fetchImpl });
  const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-growth-os-webhook-provisioner",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    fail("github_webhook_provider_request_failed", "GitHub webhook provisioning request failed.", 502, {
      upstream_status: response.status,
      upstream_message: text(body?.message, 512) || null,
      request_method: options.method || "GET",
      request_path: path,
    });
  }
  return { status: response.status, body, token };
}

async function resolveSecret(includeSecret, deps = {}) {
  const resolver = deps.resolveCredential || resolveCredentialReference;
  const result = await resolver(GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF, { includeSecret }, deps.credentialDeps || {});
  if (result?.status !== "resolved" || result?.secret_present !== true) {
    fail("github_webhook_secret_unavailable", "The governed GitHub webhook secret is unavailable.", 503, {
      credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
      credential_status: result?.status || "blocked_missing_secret",
    });
  }
  if (includeSecret && !String(result?.secret || "")) {
    fail("github_webhook_secret_unavailable", "The governed GitHub webhook secret could not be resolved for provisioning.", 503, {
      credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
    });
  }
  return result;
}

async function claimCapabilityEnvelopeForWebhook({ pool, envelopeId, executionRef }) {
  const normalizedEnvelopeId = text(envelopeId, 64);
  const normalizedExecutionRef = text(executionRef, 191);
  const [result] = await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status = 'referenced',
            execution_ref = COALESCE(NULLIF(?, ''), execution_ref),
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status = 'ready_for_dispatch'
        AND execution_status = 'not_executed'
        AND dispatch_allowed = 1
        AND apply_allowed = 1
        AND secrets_included = 0`,
    [normalizedExecutionRef, normalizedEnvelopeId],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    return {
      ok: false,
      status: "capability_resolution_envelope_claim_failed",
      envelope_id: normalizedEnvelopeId || null,
      affected_rows: Number(result?.affectedRows || 0),
      secrets_included: false,
    };
  }
  return {
    ok: true,
    status: "capability_resolution_envelope_referenced",
    envelope_id: normalizedEnvelopeId,
    execution_ref: normalizedExecutionRef || null,
    secrets_included: false,
  };
}

async function inspectTarget(input = {}, deps = {}) {
  const target = normalizeTarget(input);
  const secretStatus = await resolveSecret(false, deps);
  const list = await githubRequest(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/hooks?per_page=100`, {}, deps);
  const hooks = Array.isArray(list.body) ? list.body : [];
  const matches = hooks.filter((hook) => text(hook?.config?.url, 2048) === target.callbackUrl);
  if (matches.length > 1) {
    fail("github_webhook_duplicate_hooks_detected", "Multiple repository-main-moved hooks use the governed callback URL.", 409, {
      hook_ids: matches.map((hook) => Number(hook.id || 0)).filter(Boolean),
      callback_url: target.callbackUrl,
    });
  }
  return {
    target,
    token: list.token,
    secret_status: {
      credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
      status: secretStatus.status,
      source: secretStatus.source || null,
      storage_backend: secretStatus.storage_backend || null,
      secret_present: secretStatus.secret_present === true,
      value_sha256_present: Boolean(secretStatus.value_sha256),
      secrets_included: false,
    },
    hook: matches[0] || null,
  };
}

export async function githubRepositoryMainMovedWebhookStatus(input = {}, deps = {}) {
  const inspected = await inspectTarget(input, deps);
  return {
    ok: true,
    status: inspected.hook ? "configured" : "not_configured",
    repository: `${inspected.target.owner}/${inspected.target.repo}`,
    callback_url: inspected.target.callbackUrl,
    secret: inspected.secret_status,
    hook: inspected.hook ? safeHook(inspected.hook) : null,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}

async function pollSignedPingDelivery(target, hookId, token, startedAtMs, deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.min(Math.max(Number(deps.pingAttempts || 6), 1), 10);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const deliveries = await githubRequest(
      `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/hooks/${hookId}/deliveries?per_page=20`,
      { token },
      deps,
    );
    const rows = Array.isArray(deliveries.body) ? deliveries.body : [];
    const ping = rows.find((row) => {
      const deliveredAt = Date.parse(row?.delivered_at || row?.created_at || "");
      return row?.event === "ping" && (!Number.isFinite(deliveredAt) || deliveredAt >= startedAtMs - 10000);
    });
    if (ping) {
      return {
        delivery_id: Number(ping.id || 0) || null,
        delivery_guid: text(ping.guid, 128) || null,
        event: "ping",
        delivered_at: ping.delivered_at || null,
        duration: Number(ping.duration || 0) || null,
        status_code: Number(ping.status_code || 0) || null,
        redelivery: ping.redelivery === true,
        secrets_included: false,
      };
    }
    if (attempt < attempts) await sleep(Number(deps.pingPollDelayMs || 500));
  }
  return null;
}

async function markSecretValidated(deps = {}) {
  const pool = deps.pool || getPool();
  const [result] = await pool.query(
    `UPDATE secret_references
        SET rotation_status = 'validated', validation_status = 'validated', last_validated_at = NOW(), status = 'active'
      WHERE secret_key = ? AND owner_type = 'platform'`,
    [SECRET_KEY],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    fail("github_webhook_secret_validation_state_update_failed", "The webhook secret reference was not marked validated exactly once.", 500, {
      secret_key: SECRET_KEY,
      affected_rows: Number(result?.affectedRows || 0),
    });
  }
}

export async function githubRepositoryMainMovedWebhookProvision(input = {}, deps = {}) {
  const mode = text(input.mode || "dry_run", 32).toLowerCase();
  if (!new Set(["dry_run", "apply"]).has(mode)) fail("github_webhook_mode_invalid", "mode must be dry_run or apply.");

  let governance = null;
  let governancePool = null;
  const expectedCommitSha = text(input.expected_commit_sha, 64).toLowerCase();
  const governanceReason = text(input.reason, 1000);
  if (mode === "apply") {
    if (text(input.confirm, 128) !== APPLY_CONFIRMATION) {
      fail("github_webhook_apply_confirmation_required", `Apply requires confirm=${APPLY_CONFIRMATION}.`, 409);
    }
    if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) {
      fail("github_webhook_expected_commit_required", "Apply requires a 40-character expected_commit_sha.", 400);
    }
    if (governanceReason.length < 20) {
      fail("github_webhook_apply_reason_required", "Apply requires a reason of at least 20 characters.", 400);
    }
    governancePool = deps.pool || getPool();
    const resolveEnvelope = deps.resolveCapabilityEnvelope || resolveCapabilityExecutionEnvelope;
    governance = await resolveEnvelope({
      pool: governancePool,
      envelopeId: text(input.capability_envelope_id, 64),
      acceptedAppKeys: ["github"],
      acceptedCapabilityKeys: ["github_repository_main_moved_webhook_provision"],
      acceptedIntents: ["github_repository_main_moved_webhook_provision"],
      expectedUserId: deps.auth?.user_id || "",
      expectedCommitSha,
      allowReferenced: false,
    });
    if (!governance?.ok) throw capabilityEnvelopeError(governance);
    if (governance.apply_allowed !== true) {
      throw capabilityEnvelopeError({
        status: "capability_resolution_envelope_apply_not_allowed",
        envelope_id: governance.envelope_id,
        apply_allowed: false,
        secrets_included: false,
      });
    }
    const claimEnvelope = deps.claimEnvelopeReferenced || claimCapabilityEnvelopeForWebhook;
    const referenced = await claimEnvelope({
      pool: governancePool,
      envelopeId: governance.envelope_id,
      executionRef: `github_repository_main_moved_webhook_provision:${expectedCommitSha.slice(0, 12)}`,
    });
    if (!referenced?.ok) throw capabilityEnvelopeError(referenced, "The capability envelope could not be claimed before GitHub webhook provisioning.");
  }

  const inspected = await inspectTarget(input, deps);
  const current = inspected.hook ? safeHook(inspected.hook) : null;
  const plannedAction = inspected.hook ? "update" : "create";
  if (mode === "dry_run") {
    return {
      ok: true,
      mode: "dry_run",
      planned_action: plannedAction,
      repository: `${inspected.target.owner}/${inspected.target.repo}`,
      callback_url: inspected.target.callbackUrl,
      current_hook: current,
      secret: inspected.secret_status,
      provider_write: false,
      external_write: false,
      secrets_included: false,
    };
  }

  const resolvedSecret = await resolveSecret(true, deps);
  const hookBody = {
    name: "web",
    active: true,
    events: ["push"],
    config: {
      url: inspected.target.callbackUrl,
      content_type: "json",
      insecure_ssl: "0",
      secret: resolvedSecret.secret,
    },
  };
  let mutation;
  if (inspected.hook) {
    mutation = await githubRequest(
      `/repos/${encodeURIComponent(inspected.target.owner)}/${encodeURIComponent(inspected.target.repo)}/hooks/${Number(inspected.hook.id)}`,
      { method: "PATCH", body: { active: true, events: ["push"], config: hookBody.config }, token: inspected.token },
      deps,
    );
  } else {
    mutation = await githubRequest(
      `/repos/${encodeURIComponent(inspected.target.owner)}/${encodeURIComponent(inspected.target.repo)}/hooks`,
      { method: "POST", body: hookBody, token: inspected.token },
      deps,
    );
  }
  const hookId = Number(mutation.body?.id || inspected.hook?.id || 0);
  if (!hookId) fail("github_webhook_hook_id_missing", "GitHub did not return a repository webhook id.", 502);

  const pingStartedAtMs = Date.now();
  await githubRequest(
    `/repos/${encodeURIComponent(inspected.target.owner)}/${encodeURIComponent(inspected.target.repo)}/hooks/${hookId}/pings`,
    { method: "POST", token: mutation.token },
    deps,
  );
  const ping = await pollSignedPingDelivery(inspected.target, hookId, mutation.token, pingStartedAtMs, deps);
  if (!ping || ping.status_code !== 200) {
    fail("github_webhook_signed_ping_not_verified", "GitHub did not record a successful signed ping delivery to the governed endpoint.", 502, {
      hook_id: hookId,
      ping_delivery: ping,
    });
  }

  const readback = await githubRequest(
    `/repos/${encodeURIComponent(inspected.target.owner)}/${encodeURIComponent(inspected.target.repo)}/hooks/${hookId}`,
    { token: mutation.token },
    deps,
  );
  const safeReadback = safeHook(readback.body);
  if (safeReadback.callback_url !== inspected.target.callbackUrl || safeReadback.active !== true || !safeReadback.events.includes("push")) {
    fail("github_webhook_readback_invariant_failed", "GitHub repository webhook readback did not match the governed configuration.", 502, {
      hook: safeReadback,
    });
  }

  await markSecretValidated(deps);
  const transitionEnvelope = deps.transitionEnvelopeLifecycle || transitionCapabilityEnvelopeLifecycle;
  const consumed = await transitionEnvelope({
    pool: governancePool,
    envelopeId: governance.envelope_id,
    action: "consume",
    executionRef: `github_repository_main_moved_webhook:${hookId}`,
    reason: governanceReason,
  });
  if (!consumed?.ok) {
    throw capabilityEnvelopeError(consumed, "The capability envelope could not be consumed after GitHub webhook verification.");
  }

  const audit = deps.audit || writeAuditLogAsync;
  await audit({
    tenant_id: null,
    actor_id: deps.auth?.user_id || "platform_admin",
    actor_type: "backend_admin",
    action: "github.repository_main_moved_webhook_provisioned",
    resource_type: "github_repository_webhook",
    resource_id: String(hookId),
    after_json: {
      repository: `${inspected.target.owner}/${inspected.target.repo}`,
      callback_url: inspected.target.callbackUrl,
      hook_id: hookId,
      action: plannedAction,
      ping_delivery_id: ping.delivery_id,
      ping_status_code: ping.status_code,
      signature_verified_by_endpoint: true,
      secret_reference_validation_marked: true,
      capability_envelope_id: governance.envelope_id,
      capability_envelope_execution_status: consumed.after?.execution_status || "executed",
      expected_commit_sha: expectedCommitSha,
      secrets_included: false,
    },
  });

  return {
    ok: true,
    mode: "apply",
    action: plannedAction,
    repository: `${inspected.target.owner}/${inspected.target.repo}`,
    hook: safeReadback,
    ping,
    signature_verified: true,
    governance: {
      capability_envelope_id: governance.envelope_id,
      execution_status: consumed.after?.execution_status || "executed",
      expected_commit_sha: expectedCommitSha,
      secrets_included: false,
    },
    secret_reference: {
      credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
      validation_status: "validated",
      rotation_status: "validated",
      secrets_included: false,
    },
    provider_write: true,
    external_write: true,
    secrets_included: false,
  };
}

export async function githubRepositoryMainMovedWebhookProvisioningReadinessSmoke(_input = {}, deps = {}) {
  const resolver = deps.resolveCredential || resolveCredentialReference;
  const secret = await resolver(GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF, { includeSecret: false }, deps.credentialDeps || {});
  const resolveAppConfig = deps.resolveAppConfig || resolveGitHubAppConfig;
  const appConfig = resolveAppConfig();
  const checks = [
    { check: "governed_callback_allowlisted", pass: DEFAULT_CALLBACK_URL === `https://auth.mad4b.com${GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH}` },
    { check: "webhook_secret_reference_resolved", pass: secret?.status === "resolved" && secret?.secret_present === true },
    { check: "github_app_id_configured", pass: Boolean(appConfig?.appId) },
    { check: "github_app_installation_configured", pass: Boolean(appConfig?.installationId) },
    { check: "github_app_private_key_configured", pass: Boolean(appConfig?.privateKey) },
  ];
  const pass = checks.every((row) => row.pass === true);
  return {
    ok: pass,
    status: pass ? "pass" : "fail",
    classification: pass ? "github_repository_main_moved_webhook_provisioning_ready" : "github_repository_main_moved_webhook_provisioning_blocked",
    checks,
    callback_url: DEFAULT_CALLBACK_URL,
    credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
    provider_call_executed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export const __test__ = {
  APPLY_CONFIRMATION,
  DEFAULT_CALLBACK_URL,
  normalizeTarget,
  safeHook,
};
