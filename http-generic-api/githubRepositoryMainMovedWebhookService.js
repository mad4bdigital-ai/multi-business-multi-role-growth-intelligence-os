import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveCredentialReference } from "./credentialResolver.js";
import { createRepositoryMainMovedTriggerEvent } from "./repositoryMainMovedTriggerService.js";

export const GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH = "/webhooks/github/repository-main-moved";
export const GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF = "ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET";

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function header(headers = {}, name) {
  if (typeof headers.get === "function") return text(headers.get(name), 1024);
  const lower = String(name).toLowerCase();
  return text(headers[lower] ?? headers[name] ?? "", 1024);
}

function rawBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  fail("github_webhook_raw_body_required", "The signed GitHub webhook raw body is required.", 400);
}

export function verifyGitHubWebhookSignature({ rawBody, signature, secret } = {}) {
  const body = rawBuffer(rawBody);
  const provided = text(signature, 80).toLowerCase();
  const resolvedSecret = String(secret ?? "");
  if (!/^sha256=[0-9a-f]{64}$/.test(provided)) {
    fail("github_webhook_signature_required", "A valid X-Hub-Signature-256 header is required.", 401);
  }
  if (!resolvedSecret) {
    fail("github_webhook_secret_unavailable", "GitHub webhook verification is not provisioned.", 503);
  }
  const expected = `sha256=${createHmac("sha256", resolvedSecret).update(body).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    fail("github_webhook_signature_invalid", "The GitHub webhook signature is invalid.", 401);
  }
  return true;
}

export function normalizeGitHubRepositoryMainMovedWebhook({ headers = {}, body = {} } = {}) {
  const eventType = header(headers, "x-github-event").toLowerCase();
  const deliveryId = header(headers, "x-github-delivery");
  if (!deliveryId) {
    fail("github_webhook_delivery_id_required", "X-GitHub-Delivery is required.", 400);
  }
  if (eventType === "ping") {
    return {
      event_type: "ping",
      delivery_id: deliveryId,
      repository: text(body?.repository?.full_name, 255).toLowerCase() || null,
    };
  }
  if (eventType !== "push") {
    fail("github_webhook_event_not_supported", "Only GitHub ping and push webhook events are supported.", 400, {
      event_type: eventType || null,
    });
  }
  return {
    event_type: "push",
    delivery_id: deliveryId,
    trigger_input: {
      source_event_id: deliveryId,
      repository: text(body?.repository?.full_name, 255).toLowerCase(),
      branch: text(body?.ref, 255),
      before_sha: text(body?.before, 40),
      after_sha: text(body?.after, 40),
      forced: body?.forced === true,
      deleted: body?.deleted === true,
      environment_key: "production",
      occurred_at: body?.head_commit?.timestamp || new Date().toISOString(),
    },
  };
}

async function resolveWebhookSecret(deps = {}) {
  const resolver = deps.resolveCredentialReference || resolveCredentialReference;
  const result = await resolver(
    GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
    { includeSecret: true },
    deps.credentialDeps || {},
  );
  if (result?.status !== "resolved" || !String(result?.secret || "")) {
    fail("github_webhook_secret_unavailable", "GitHub webhook verification is not provisioned.", 503, {
      credential_status: result?.status || "blocked_missing_secret",
      credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
    });
  }
  return result.secret;
}

export async function verifyGitHubRepositoryMainMovedWebhookRequest(request = {}, deps = {}) {
  const secret = await resolveWebhookSecret(deps);
  verifyGitHubWebhookSignature({
    rawBody: request.rawBody,
    signature: header(request.headers, "x-hub-signature-256"),
    secret,
  });
  return {
    signature_verified: true,
    credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
    secrets_included: false,
  };
}

export async function handleGitHubRepositoryMainMovedWebhook(request = {}, deps = {}) {
  if (request.signature_verified !== true) {
    await verifyGitHubRepositoryMainMovedWebhookRequest(request, deps);
  }
  const normalized = normalizeGitHubRepositoryMainMovedWebhook(request);
  if (normalized.event_type === "ping") {
    return {
      ok: true,
      accepted: true,
      event_type: "ping",
      delivery_id: normalized.delivery_id,
      repository: normalized.repository,
      execution_allowed: false,
      provider_write: false,
      external_write: false,
      secrets_included: false,
    };
  }
  const createTrigger = deps.createRepositoryMainMovedTriggerEvent || createRepositoryMainMovedTriggerEvent;
  const result = await createTrigger(
    normalized.trigger_input,
    {
      user_id: null,
      email: null,
      mode: "github_repository_main_moved_webhook",
    },
    deps.triggerDeps || {},
  );
  return {
    ...result,
    webhook: {
      event_type: "push",
      delivery_id: normalized.delivery_id,
      signature_verified: true,
      credential_ref: GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
      secrets_included: false,
    },
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}
