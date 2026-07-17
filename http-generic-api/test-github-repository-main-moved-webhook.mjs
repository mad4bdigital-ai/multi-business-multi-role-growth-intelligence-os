import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH,
  GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF,
  handleGitHubRepositoryMainMovedWebhook,
  normalizeGitHubRepositoryMainMovedWebhook,
  verifyGitHubRepositoryMainMovedWebhookRequest,
  verifyGitHubWebhookSignature,
} from "./githubRepositoryMainMovedWebhookService.js";
import { createGitHubRepositoryMainMovedWebhookSignatureGuard } from "./routes/repositoryMainMovedTriggerRoutes.js";
import { normalizeRepositoryMainMovedEvent } from "./repositoryMainMovedTriggerService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secret = "unit-test-webhook-secret";
const payload = {
  ref: "refs/heads/main",
  before: "a".repeat(40),
  after: "b".repeat(40),
  forced: false,
  deleted: false,
  repository: { full_name: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" },
  head_commit: { timestamp: "2026-07-17T09:00:00.000Z" },
};
const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
const headers = {
  "x-github-event": "push",
  "x-github-delivery": "delivery-123",
  "x-hub-signature-256": signature,
};

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
    getHeader() {
      return undefined;
    },
  };
}

assert.equal(GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PATH, "/webhooks/github/repository-main-moved");
assert.equal(GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET_REF, "ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET");
assert.equal(verifyGitHubWebhookSignature({ rawBody, signature, secret }), true);
assert.throws(
  () => verifyGitHubWebhookSignature({ rawBody: Buffer.from("tampered"), signature, secret }),
  (error) => error.code === "github_webhook_signature_invalid" && error.status === 401,
);
assert.throws(
  () => verifyGitHubWebhookSignature({ rawBody, signature: "", secret }),
  (error) => error.code === "github_webhook_signature_required" && error.status === 401,
);

const normalized = normalizeGitHubRepositoryMainMovedWebhook({ headers, body: payload });
assert.equal(normalized.event_type, "push");
assert.equal(normalized.delivery_id, "delivery-123");
assert.equal(normalized.trigger_input.repository, payload.repository.full_name);
assert.equal(normalized.trigger_input.branch, "refs/heads/main");
assert.equal(normalized.trigger_input.environment_key, "production");
const governedInput = normalizeRepositoryMainMovedEvent(normalized.trigger_input, {
  env: { RELEASE_TRIGGER_REPOSITORY: payload.repository.full_name },
});
assert.equal(governedInput.branch, "main");
assert.equal(governedInput.after_sha, payload.after);

let triggerCalls = 0;
let capturedInput = null;
let capturedActor = null;
const pushResult = await handleGitHubRepositoryMainMovedWebhook(
  { headers, body: payload, rawBody },
  {
    resolveCredentialReference: async () => ({ status: "resolved", secret }),
    createRepositoryMainMovedTriggerEvent: async (input, actor) => {
      triggerCalls += 1;
      capturedInput = input;
      capturedActor = actor;
      return {
        ok: true,
        deduplicated: false,
        trigger_event: { trigger_event_id: "11111111-1111-4111-8111-111111111111" },
      };
    },
  },
);
assert.equal(triggerCalls, 1);
assert.equal(capturedInput.source_event_id, "delivery-123");
assert.equal(capturedActor.mode, "github_repository_main_moved_webhook");
assert.equal(pushResult.webhook.signature_verified, true);
assert.equal(pushResult.execution_allowed, false);
assert.equal(pushResult.provider_write, false);
assert.equal(pushResult.external_write, false);
assert.equal(pushResult.secrets_included, false);
assert.equal(JSON.stringify(pushResult).includes(secret), false);

const pingPayload = { zen: "Keep it logically awesome.", repository: payload.repository };
const pingRawBody = Buffer.from(JSON.stringify(pingPayload), "utf8");
const pingSignature = `sha256=${createHmac("sha256", secret).update(pingRawBody).digest("hex")}`;
const pingResult = await handleGitHubRepositoryMainMovedWebhook(
  {
    headers: {
      "x-github-event": "ping",
      "x-github-delivery": "delivery-ping",
      "x-hub-signature-256": pingSignature,
    },
    body: pingPayload,
    rawBody: pingRawBody,
  },
  {
    resolveCredentialReference: async () => ({ status: "resolved", secret }),
    createRepositoryMainMovedTriggerEvent: async () => {
      throw new Error("ping must not call the coordinator");
    },
  },
);
assert.equal(pingResult.event_type, "ping");
assert.equal(pingResult.accepted, true);
assert.equal(pingResult.execution_allowed, false);

await assert.rejects(
  handleGitHubRepositoryMainMovedWebhook(
    { headers, body: payload, rawBody },
    { resolveCredentialReference: async () => ({ status: "blocked_missing_secret" }) },
  ),
  (error) => error.code === "github_webhook_secret_unavailable" && error.status === 503,
);

assert.throws(
  () => normalizeGitHubRepositoryMainMovedWebhook({
    headers: { "x-github-event": "issues", "x-github-delivery": "unsupported" },
    body: {},
  }),
  (error) => error.code === "github_webhook_event_not_supported" && error.status === 400,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({
    ...normalized.trigger_input,
    repository: "other/repository",
  }, { env: { RELEASE_TRIGGER_REPOSITORY: payload.repository.full_name } }),
  (error) => error.code === "repository_main_moved_repository_not_allowed" && error.status === 403,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({
    ...normalized.trigger_input,
    branch: "refs/heads/feature",
  }, { env: { RELEASE_TRIGGER_REPOSITORY: payload.repository.full_name } }),
  (error) => error.code === "repository_main_moved_branch_not_supported" && error.status === 400,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({
    ...normalized.trigger_input,
    deleted: true,
  }, { env: { RELEASE_TRIGGER_REPOSITORY: payload.repository.full_name } }),
  (error) => error.code === "repository_main_moved_deleted_ref_blocked" && error.status === 409,
);

const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
assert.match(serverSource, /verify: \(req, _res, buffer\) =>/);
assert.match(serverSource, /\/webhooks\/github\/repository-main-moved/);
assert.match(serverSource, /req\.rawBody = Buffer\.from\(buffer\)/);
const routeSource = fs.readFileSync(path.join(__dirname, "routes", "repositoryMainMovedTriggerRoutes.js"), "utf8");
assert.match(routeSource, /handleGitHubRepositoryMainMovedWebhook/);
assert.match(routeSource, /router\.post\("\/webhooks\/github\/repository-main-moved"/);
const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260717_github_repository_main_moved_webhook_ingress.sql"), "utf8");
assert.match(migration, /GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET/);
assert.match(migration, /github_repository_main_moved_webhook_ingress_v1/);
assert.doesNotMatch(migration, /INSERT INTO platform_secrets/i);
assert.doesNotMatch(migration, /value_ciphertext/i);
const openapi = fs.readFileSync(path.join(__dirname, "openapi", "github-repository-main-moved-webhook.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /operationId: ingestGitHubRepositoryMainMovedWebhook/);
assert.match(openapi, /X-Hub-Signature-256/);

console.log("github repository main moved webhook tests passed");
