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
} from "./githubRepositoryMainMovedWebhookService.js";
import { resolveRepositoryCapabilityAuthority } from "./repositoryAuthorityContextResolver.js";
import { recordGithubRepositoryWebhookCertification } from "./githubRepositoryWebhookCertificationService.js";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_CALLBACK_URL = `https://auth.mad4b.com${GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH}`;
const APPLY_CONFIRMATION = "PROVISION_GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK";
const CAPABILITY_KEY = "github_repository_main_moved_webhook_provision";

export const GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PROVISIONING_SYSTEM_TOOLS = [
  {
    name: "github_repository_main_moved_webhook_status",
    description: "Admin-only readback of one repository-main-moved GitHub webhook resolved from governed repository authority and capability bindings. binding_key is preferred; owner/repo are backward-compatible selectors only and never become execution authority. Never returns credential references or secret values.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        binding_key: { type: "string", minLength: 1, maxLength: 191 },
        owner: { type: "string", minLength: 1, maxLength: 100, description: "Backward-compatible selector only." },
        repo: { type: "string", minLength: 1, maxLength: 100, description: "Backward-compatible selector only." },
        callback_url: { type: "string", description: "Optional compatibility assertion; must equal the inherited governed callback." },
      },
      anyOf: [
        { required: ["binding_key"] },
        { required: ["owner", "repo"] }
      ],
    },
  },
  {
    name: "github_repository_main_moved_webhook_provision",
    description: "Admin-only idempotent dry-run/apply for a repository-main-moved GitHub webhook inherited from SQL repository authority and capability bindings. Apply requires commit-bound authority and capability fingerprints, an approved single-use envelope, signed ping status 200, and provider readback. The secret is resolved inside the server and never returned.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        binding_key: { type: "string", minLength: 1, maxLength: 191 },
        owner: { type: "string", minLength: 1, maxLength: 100, description: "Backward-compatible selector only." },
        repo: { type: "string", minLength: 1, maxLength: 100, description: "Backward-compatible selector only." },
        callback_url: { type: "string", description: "Optional compatibility assertion; must equal the inherited governed callback." },
        binding_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        capability_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
        expected_commit_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
        reason: { type: "string", minLength: 20, maxLength: 1000 },
      },
      anyOf: [
        { required: ["binding_key"] },
        { required: ["owner", "repo"] }
      ],
    },
  },
  {
    name: "github_repository_main_moved_webhook_provisioning_readiness_smoke",
    description: "Admin-only no-provider readiness smoke for Repository Authority V2, repository capability readiness, GitHub App configuration, governed callback constraints, and no-secret guarantees.",
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

function validateLegacyRepositorySelector(input = {}) {
  const owner = text(input.owner, 100);
  const repo = text(input.repo, 100);
  const safeName = /^[A-Za-z0-9_.-]+$/;
  if ((owner && !repo) || (!owner && repo)) {
    fail("github_webhook_legacy_selector_incomplete", "owner and repo must be supplied together when using the backward-compatible selector.");
  }
  if (owner && !safeName.test(owner)) fail("github_webhook_owner_invalid", "A valid GitHub repository owner selector is required.");
  if (repo && !safeName.test(repo)) fail("github_webhook_repo_invalid", "A valid GitHub repository name selector is required.");
  return { owner, repo };
}

async function resolveBindingKey(input = {}, deps = {}) {
  const bindingKey = text(input.binding_key, 191);
  const legacy = validateLegacyRepositorySelector(input);
  if (bindingKey) return { bindingKey, legacy };
  if (!legacy.owner || !legacy.repo) {
    fail("repository_authority_binding_selector_required", "A binding_key or owner/repo selector is required.");
  }
  const resolver = deps.resolveLegacyBindingSelector;
  if (typeof resolver === "function") {
    const result = await resolver({ owner: legacy.owner, repo: legacy.repo });
    const resolvedKey = text(result?.binding_key || result, 191);
    if (!resolvedKey) fail("repository_authority_binding_not_found", "No active repository authority binding matched the owner/repo selector.", 404);
    return { bindingKey: resolvedKey, legacy };
  }
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT binding_key
       FROM v_repository_authority_binding_readiness
      WHERE provider_key = 'github'
        AND canonical_owner = ?
        AND canonical_name = ?
        AND lifecycle_status = 'active'
      LIMIT 2`,
    [legacy.owner, legacy.repo],
  );
  const matches = Array.isArray(rows) ? rows : [];
  if (matches.length !== 1) {
    fail(
      matches.length ? "repository_authority_binding_ambiguous" : "repository_authority_binding_not_found",
      matches.length ? "The owner/repo selector matched multiple active repository authority bindings." : "No active repository authority binding matched the owner/repo selector.",
      matches.length ? 409 : 404,
      { owner: legacy.owner, repo: legacy.repo, binding_count: matches.length },
    );
  }
  return { bindingKey: text(matches[0].binding_key, 191), legacy };
}

function safeConfigurationEvents(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((event) => text(event, 64)).filter(Boolean))];
}

async function resolveProvisioningAuthority(input = {}, deps = {}, { requireFingerprints = false } = {}) {
  const expectedBindingSha256 = text(input.binding_sha256, 64).toLowerCase();
  const expectedCapabilitySha256 = text(input.capability_sha256, 64).toLowerCase();
  for (const [value, code, label] of [
    [expectedBindingSha256, "github_webhook_binding_sha256_invalid", "binding_sha256"],
    [expectedCapabilitySha256, "github_webhook_capability_sha256_invalid", "capability_sha256"],
  ]) {
    if (value && !/^[0-9a-f]{64}$/.test(value)) fail(code, `${label} must be a 64-character hexadecimal SHA-256 fingerprint.`);
  }
  if (requireFingerprints && (!expectedBindingSha256 || !expectedCapabilitySha256)) {
    fail("github_webhook_planning_fingerprints_required", "Apply requires binding_sha256 and capability_sha256 from the reviewed dry-run.", 400);
  }

  const selector = await resolveBindingKey(input, deps);
  const pool = deps.pool || getPool();
  const resolver = deps.resolveRepositoryAuthority || resolveRepositoryCapabilityAuthority;
  const resolved = await resolver({
    bindingKey: selector.bindingKey,
    capabilityKey: CAPABILITY_KEY,
    expectedBindingSha256,
    expectedCapabilitySha256,
    pool,
  });
  const authority = resolved?.authority || {};
  const capability = resolved?.capability || {};
  const configuration = resolved?.configuration && typeof resolved.configuration === "object"
    ? resolved.configuration
    : {};
  const owner = text(authority.canonical_owner, 100);
  const repo = text(authority.canonical_name, 100);
  const safeName = /^[A-Za-z0-9_.-]+$/;
  if (authority.provider_key !== "github" || authority.app_key !== "github") {
    fail("github_webhook_repository_provider_invalid", "The repository authority binding must resolve to the governed GitHub application.", 409);
  }
  if (!owner || !safeName.test(owner) || !repo || !safeName.test(repo)) {
    fail("github_webhook_repository_identity_invalid", "The repository authority binding contains an invalid GitHub repository identity.", 409);
  }
  if (selector.legacy.owner && (selector.legacy.owner !== owner || selector.legacy.repo !== repo)) {
    fail("github_webhook_legacy_selector_mismatch", "The owner/repo selector no longer matches the canonical repository authority binding.", 409, {
      binding_key: selector.bindingKey,
      canonical_repository: `${owner}/${repo}`,
    });
  }
  if (capability.capability_key !== CAPABILITY_KEY || capability.operation_intent !== CAPABILITY_KEY) {
    fail("github_webhook_capability_binding_invalid", "The repository capability binding does not authorize repository-main-moved webhook provisioning.", 409);
  }
  if (capability.effect_class !== "external_write") {
    fail("github_webhook_capability_effect_invalid", "The repository capability binding must declare external_write.", 409);
  }

  const callbackUrl = text(configuration.callback_url, 2048);
  if (callbackUrl !== DEFAULT_CALLBACK_URL) {
    fail("github_webhook_callback_not_allowed", "The inherited repository capability callback must use the governed production endpoint.", 403, {
      allowed_callback_url: DEFAULT_CALLBACK_URL,
    });
  }
  const assertedCallback = text(input.callback_url, 2048);
  if (assertedCallback && assertedCallback !== callbackUrl) {
    fail("github_webhook_callback_assertion_mismatch", "The callback_url assertion does not match the inherited repository capability configuration.", 409);
  }
  const events = safeConfigurationEvents(configuration.events);
  if (events.length !== 1 || events[0] !== "push") {
    fail("github_webhook_events_not_governed", "The repository-main-moved capability must inherit exactly the push event.", 409, { events });
  }
  const hookName = text(configuration.hook_name || "web", 64);
  const contentType = text(configuration.content_type || "json", 64);
  const insecureSsl = text(configuration.insecure_ssl || "0", 8);
  const active = configuration.active !== false;
  if (hookName !== "web" || contentType !== "json" || insecureSsl !== "0" || active !== true) {
    fail("github_webhook_configuration_not_governed", "The inherited webhook configuration violates the governed repository-main-moved contract.", 409);
  }
  const credentialRef = text(resolved?.credential_ref, 255);
  if (!credentialRef.startsWith("ref:secret:")) {
    fail("github_webhook_secret_reference_invalid", "The repository capability binding must reference a governed server-side secret.", 409);
  }

  return {
    pool,
    authority,
    capability,
    credentialRef,
    target: { owner, repo, callbackUrl, events, hookName, contentType, insecureSsl, active },
    evidence: {
      binding_key: authority.binding_key,
      resource_uri: resolved.resource_uri,
      binding_sha256: resolved.binding_sha256,
      capability_binding_key: capability.capability_binding_key,
      capability_sha256: resolved.capability_sha256,
      tenant_id: authority.tenant_id || null,
      workspace_id: authority.workspace_id || null,
      brand_key: authority.brand_target_key || null,
      repository_node_id: authority.repository_node_id || null,
      repository_external_id: authority.repository_external_id || null,
      repository: `${owner}/${repo}`,
      environment: authority.environment || null,
      configuration_source_map: resolved.configuration_source_map || {},
      secrets_included: false,
    },
  };
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

async function resolveSecret(credentialRef, includeSecret, deps = {}) {
  const normalizedRef = text(credentialRef, 255);
  if (!normalizedRef.startsWith("ref:secret:")) {
    fail("github_webhook_secret_reference_invalid", "The repository capability secret reference is invalid.", 409);
  }
  const resolver = deps.resolveCredential || resolveCredentialReference;
  const result = await resolver(normalizedRef, { includeSecret }, deps.credentialDeps || {});
  if (result?.status !== "resolved" || result?.secret_present !== true) {
    fail("github_webhook_secret_unavailable", "The governed GitHub webhook secret is unavailable.", 503, {
      credential_status: result?.status || "blocked_missing_secret",
    });
  }
  if (includeSecret && !String(result?.secret || "")) {
    fail("github_webhook_secret_unavailable", "The governed GitHub webhook secret could not be resolved for provisioning.", 503);
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

async function inspectTarget(authorityContext, deps = {}) {
  const target = authorityContext.target;
  const secretStatus = await resolveSecret(authorityContext.credentialRef, false, deps);
  const list = await githubRequest(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/hooks?per_page=100`, {}, deps);
  const hooks = Array.isArray(list.body) ? list.body : [];
  const matches = hooks.filter((hook) => text(hook?.config?.url, 2048) === target.callbackUrl);
  if (matches.length > 1) {
    fail("github_webhook_duplicate_hooks_detected", "Multiple repository-main-moved hooks use the inherited governed callback URL.", 409, {
      hook_ids: matches.map((hook) => Number(hook.id || 0)).filter(Boolean),
      binding_key: authorityContext.evidence.binding_key,
      callback_url: target.callbackUrl,
    });
  }
  return {
    ...authorityContext,
    token: list.token,
    secret_status: {
      status: secretStatus.status,
      source: secretStatus.source || null,
      storage_backend: secretStatus.storage_backend || null,
      secret_present: secretStatus.secret_present === true,
      value_sha256_present: Boolean(secretStatus.value_sha256),
      credential_reference_present: true,
      secrets_included: false,
    },
    hook: matches[0] || null,
  };
}

export async function githubRepositoryMainMovedWebhookStatus(input = {}, deps = {}) {
  const authorityContext = await resolveProvisioningAuthority(input, deps);
  const inspected = await inspectTarget(authorityContext, deps);
  return {
    ok: true,
    status: inspected.hook ? "configured" : "not_configured",
    binding: inspected.evidence,
    repository: `${inspected.target.owner}/${inspected.target.repo}`,
    callback_url: inspected.target.callbackUrl,
    inherited_events: inspected.target.events,
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

async function markSecretValidated(credentialRef, deps = {}) {
  const secretKey = text(credentialRef, 255).replace(/^ref:secret:/, "");
  if (!secretKey || secretKey === credentialRef) {
    fail("github_webhook_secret_reference_invalid", "The repository capability secret reference is invalid.", 409);
  }
  const pool = deps.pool || getPool();
  const [result] = await pool.query(
    `UPDATE secret_references
        SET rotation_status = 'validated', validation_status = 'validated', last_validated_at = NOW(), status = 'active'
      WHERE secret_key = ? AND owner_type = 'platform'`,
    [secretKey],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    fail("github_webhook_secret_validation_state_update_failed", "The webhook secret reference was not marked validated exactly once.", 500, {
      affected_rows: Number(result?.affectedRows || 0),
    });
  }
}

export async function githubRepositoryMainMovedWebhookProvision(input = {}, deps = {}) {
  const mode = text(input.mode || "dry_run", 32).toLowerCase();
  if (!new Set(["dry_run", "apply"]).has(mode)) fail("github_webhook_mode_invalid", "mode must be dry_run or apply.");

  const expectedCommitSha = text(input.expected_commit_sha, 64).toLowerCase();
  const governanceReason = text(input.reason, 1000);
  const capabilityEnvelopeId = text(input.capability_envelope_id, 64);
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
    if (!capabilityEnvelopeId) {
      fail("capability_resolution_envelope_required", "Apply requires a capability_envelope_id before repository authority, secret, or GitHub access.", 403);
    }
    if (!/^[0-9a-f]{64}$/.test(text(input.binding_sha256, 64).toLowerCase()) || !/^[0-9a-f]{64}$/.test(text(input.capability_sha256, 64).toLowerCase())) {
      fail("github_webhook_planning_fingerprints_required", "Apply requires valid binding_sha256 and capability_sha256 values from the reviewed dry-run.", 400);
    }
  }

  const authorityContext = await resolveProvisioningAuthority(input, deps, { requireFingerprints: mode === "apply" });
  let governance = null;
  const governancePool = authorityContext.pool;
  if (mode === "apply") {
    const resolveEnvelope = deps.resolveCapabilityEnvelope || resolveCapabilityExecutionEnvelope;
    governance = await resolveEnvelope({
      pool: governancePool,
      envelopeId: capabilityEnvelopeId,
      acceptedAppKeys: ["github"],
      acceptedCapabilityKeys: [CAPABILITY_KEY],
      acceptedIntents: [CAPABILITY_KEY],
      expectedTenantId: authorityContext.authority.tenant_id || "",
      expectedUserId: deps.auth?.user_id || "",
      expectedWorkspaceId: authorityContext.authority.workspace_id || "",
      expectedBrandKey: authorityContext.authority.brand_target_key || "",
      expectedResourceUri: authorityContext.evidence.resource_uri,
      expectedCommitSha,
      expectedBindingSha256: authorityContext.evidence.binding_sha256,
      expectedCapabilitySha256: authorityContext.evidence.capability_sha256,
      requireCommitHint: true,
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
      executionRef: `github_webhook:${authorityContext.authority.binding_key}:${expectedCommitSha.slice(0, 12)}`,
    });
    if (!referenced?.ok) throw capabilityEnvelopeError(referenced, "The capability envelope could not be claimed before GitHub webhook provisioning.");
  }

  const inspected = await inspectTarget(authorityContext, deps);
  const current = inspected.hook ? safeHook(inspected.hook) : null;
  const plannedAction = inspected.hook ? "update" : "create";
  if (mode === "dry_run") {
    return {
      ok: true,
      mode: "dry_run",
      planned_action: plannedAction,
      binding: inspected.evidence,
      repository: `${inspected.target.owner}/${inspected.target.repo}`,
      callback_url: inspected.target.callbackUrl,
      inherited_events: inspected.target.events,
      current_hook: current,
      secret: inspected.secret_status,
      apply_requirements: {
        binding_key: inspected.evidence.binding_key,
        resource_uri: inspected.evidence.resource_uri,
        binding_sha256: inspected.evidence.binding_sha256,
        capability_sha256: inspected.evidence.capability_sha256,
        confirmation: APPLY_CONFIRMATION,
        commit_sha_required: true,
        single_use_capability_envelope_required: true,
        secrets_included: false,
      },
      provider_write: false,
      external_write: false,
      secrets_included: false,
    };
  }

  const resolvedSecret = await resolveSecret(inspected.credentialRef, true, deps);
  const hookBody = {
    name: inspected.target.hookName,
    active: inspected.target.active,
    events: inspected.target.events,
    config: {
      url: inspected.target.callbackUrl,
      content_type: inspected.target.contentType,
      insecure_ssl: inspected.target.insecureSsl,
      secret: resolvedSecret.secret,
    },
  };
  let mutation;
  if (inspected.hook) {
    mutation = await githubRequest(
      `/repos/${encodeURIComponent(inspected.target.owner)}/${encodeURIComponent(inspected.target.repo)}/hooks/${Number(inspected.hook.id)}`,
      { method: "PATCH", body: { active: hookBody.active, events: hookBody.events, config: hookBody.config }, token: inspected.token },
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
  const expectedEvents = [...inspected.target.events].sort();
  const observedEvents = [...safeReadback.events].sort();
  if (
    safeReadback.callback_url !== inspected.target.callbackUrl
    || safeReadback.active !== inspected.target.active
    || JSON.stringify(observedEvents) !== JSON.stringify(expectedEvents)
    || safeReadback.content_type !== inspected.target.contentType
    || safeReadback.insecure_ssl !== inspected.target.insecureSsl
  ) {
    fail("github_webhook_readback_invariant_failed", "GitHub repository webhook readback did not match the inherited capability configuration.", 502, {
      hook: safeReadback,
      binding_key: inspected.evidence.binding_key,
    });
  }

  await markSecretValidated(inspected.credentialRef, deps);
  const certifyWebhook = deps.recordCertification || recordGithubRepositoryWebhookCertification;
  const certification = await certifyWebhook({
    pool: governancePool,
    authority: inspected.authority,
    capability: inspected.capability,
    governance: {
      ...governance,
      resource_uri: inspected.evidence.resource_uri,
    },
    hook: safeReadback,
    ping,
    expectedCommitSha,
    bindingSha256: inspected.evidence.binding_sha256,
    capabilitySha256: inspected.evidence.capability_sha256,
  }, { pool: governancePool });
  if (!certification?.ok) {
    fail("github_webhook_certification_failed", "Verified webhook evidence and certification were not persisted.", 500);
  }
  const transitionEnvelope = deps.transitionEnvelopeLifecycle || transitionCapabilityEnvelopeLifecycle;
  const consumed = await transitionEnvelope({
    pool: governancePool,
    envelopeId: governance.envelope_id,
    action: "consume",
    executionRef: `github_repository_main_moved_webhook:${inspected.evidence.binding_key}:${hookId}`,
    reason: governanceReason,
  });
  if (!consumed?.ok) {
    throw capabilityEnvelopeError(consumed, "The capability envelope could not be consumed after GitHub webhook verification.");
  }

  const audit = deps.audit || writeAuditLogAsync;
  await audit({
    tenant_id: inspected.authority.tenant_id || null,
    actor_id: deps.auth?.user_id || "platform_admin",
    actor_type: "backend_admin",
    action: "github.repository_main_moved_webhook_provisioned",
    resource_type: "repository_capability_binding",
    resource_id: inspected.capability.capability_binding_id || inspected.evidence.binding_key,
    after_json: {
      ...inspected.evidence,
      callback_url: inspected.target.callbackUrl,
      inherited_events: inspected.target.events,
      hook_id: hookId,
      action: plannedAction,
      ping_delivery_id: ping.delivery_id,
      ping_status_code: ping.status_code,
      signature_verified_by_endpoint: true,
      secret_reference_validation_marked: true,
      capability_envelope_id: governance.envelope_id,
      capability_envelope_execution_status: consumed.after?.execution_status || "executed",
      expected_commit_sha: expectedCommitSha,
      evidence_id: certification.evidence_id,
      certification_id: certification.certification_id,
      certification_type: certification.certification_type,
      certification_status: certification.certification_status,
      certification_environment: certification.environment,
      secrets_included: false,
    },
  });

  return {
    ok: true,
    mode: "apply",
    action: plannedAction,
    binding: inspected.evidence,
    repository: `${inspected.target.owner}/${inspected.target.repo}`,
    hook: safeReadback,
    ping,
    signature_verified: true,
    governance: {
      capability_envelope_id: governance.envelope_id,
      execution_status: consumed.after?.execution_status || "executed",
      resource_uri: inspected.evidence.resource_uri,
      expected_commit_sha: expectedCommitSha,
      binding_sha256: inspected.evidence.binding_sha256,
      capability_sha256: inspected.evidence.capability_sha256,
      secrets_included: false,
    },
    secret_reference: {
      credential_reference_present: true,
      validation_status: "validated",
      rotation_status: "validated",
      secrets_included: false,
    },
    certification,
    provider_write: true,
    external_write: true,
    secrets_included: false,
  };
}

export async function githubRepositoryMainMovedWebhookProvisioningReadinessSmoke(_input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const requiredObjects = [
    "repository_authority_bindings",
    "repository_authority_aliases",
    "repository_capability_bindings",
    "repository_capability_policy_layers",
    "v_repository_authority_binding_readiness",
    "v_repository_capability_binding_readiness",
  ];
  let schemaObjects = [];
  let capabilityRows = [];
  let authorityContext = null;
  let secret = null;
  let readinessError = null;
  try {
    const [objectRows] = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (${requiredObjects.map(() => "?").join(",")})`,
      requiredObjects,
    );
    schemaObjects = Array.isArray(objectRows) ? objectRows : [];
    if (schemaObjects.length === requiredObjects.length) {
      const [rows] = await pool.query(
        `SELECT binding_key
           FROM v_repository_capability_binding_readiness
          WHERE capability_key = ?
            AND lifecycle_status = 'active'
            AND readiness_status = 'ready'
            AND is_primary = 1
          ORDER BY capability_binding_key
          LIMIT 2`,
        [CAPABILITY_KEY],
      );
      capabilityRows = Array.isArray(rows) ? rows : [];
      if (capabilityRows.length === 1) {
        const authorityResolver = deps.resolveRepositoryAuthority || resolveRepositoryCapabilityAuthority;
        authorityContext = await authorityResolver({
          bindingKey: text(capabilityRows[0].binding_key, 191),
          capabilityKey: CAPABILITY_KEY,
          pool,
        });
        const secretResolver = deps.resolveCredential || resolveCredentialReference;
        secret = await secretResolver(authorityContext.credential_ref, { includeSecret: false }, deps.credentialDeps || {});
      }
    }
  } catch (error) {
    readinessError = text(error?.code || error?.message || "repository_capability_readiness_error", 191);
  }

  const configuration = authorityContext?.configuration && typeof authorityContext.configuration === "object"
    ? authorityContext.configuration
    : {};
  const events = safeConfigurationEvents(configuration.events);
  const present = new Set(schemaObjects.map((row) => row.table_name));
  const resolveAppConfig = deps.resolveAppConfig || resolveGitHubAppConfig;
  const appConfig = resolveAppConfig();
  const checks = [
    { check: "repository_v2_schema_present", pass: requiredObjects.every((name) => present.has(name)), missing: requiredObjects.filter((name) => !present.has(name)) },
    { check: "one_primary_ready_capability_binding", pass: capabilityRows.length === 1, binding_count: capabilityRows.length },
    { check: "governed_callback_inherited", pass: text(configuration.callback_url, 2048) === DEFAULT_CALLBACK_URL },
    { check: "governed_push_event_inherited", pass: events.length === 1 && events[0] === "push" },
    { check: "webhook_secret_reference_resolved", pass: secret?.status === "resolved" && secret?.secret_present === true },
    { check: "github_app_id_configured", pass: Boolean(appConfig?.appId) },
    { check: "github_app_installation_configured", pass: Boolean(appConfig?.installationId) },
    { check: "github_app_private_key_configured", pass: Boolean(appConfig?.privateKey) },
    { check: "provider_call_not_executed", pass: true },
    { check: "mutation_not_executed", pass: true },
    { check: "credential_reference_not_exposed", pass: true },
  ];
  const pass = !readinessError && checks.every((row) => row.pass === true);
  return {
    ok: pass,
    status: pass ? "pass" : "fail",
    classification: pass ? "github_repository_main_moved_webhook_provisioning_ready" : "github_repository_main_moved_webhook_provisioning_blocked",
    checks,
    readiness_error: readinessError,
    binding: authorityContext ? {
      binding_key: authorityContext.authority?.binding_key || null,
      resource_uri: authorityContext.resource_uri || null,
      binding_sha256: authorityContext.binding_sha256 || null,
      capability_sha256: authorityContext.capability_sha256 || null,
      secrets_included: false,
    } : null,
    callback_url: DEFAULT_CALLBACK_URL,
    provider_call_executed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export const __test__ = {
  APPLY_CONFIRMATION,
  CAPABILITY_KEY,
  DEFAULT_CALLBACK_URL,
  validateLegacyRepositorySelector,
  resolveBindingKey,
  resolveProvisioningAuthority,
  safeHook,
};
