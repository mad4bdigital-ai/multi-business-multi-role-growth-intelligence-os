import assert from "node:assert/strict";
import {
  __test__,
  githubRepositoryMainMovedWebhookProvision,
  githubRepositoryMainMovedWebhookProvisioningReadinessSmoke,
  githubRepositoryMainMovedWebhookStatus,
} from "./githubRepositoryMainMovedWebhookProvisioning.js";

function reply(status, body = undefined) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === undefined ? "" : JSON.stringify(body); },
  };
}

const target = { owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os" };

{
  const calls = [];
  const result = await githubRepositoryMainMovedWebhookProvision(
    { ...target, mode: "dry_run" },
    {
      resolveCredential: async (_ref, options) => {
        calls.push({ kind: "credential", includeSecret: options.includeSecret });
        return { status: "resolved", secret_present: true, source: "platform_secrets", storage_backend: "db_encrypted", value_sha256: "hash" };
      },
      getInstallationToken: async () => "installation-token",
      fetchImpl: async (url, options = {}) => {
        calls.push({ kind: "fetch", url, method: options.method || "GET" });
        return reply(200, []);
      },
    },
  );
  assert.equal(result.mode, "dry_run");
  assert.equal(result.planned_action, "create");
  assert.equal(result.provider_write, false);
  assert.deepEqual(calls.filter((row) => row.kind === "credential").map((row) => row.includeSecret), [false]);
  assert.equal(calls.some((row) => row.kind === "fetch" && row.method !== "GET"), false);
}

{
  const requests = [];
  const credentialCalls = [];
  const audits = [];
  const pool = {
    async query(sql, params) {
      assert(sql.includes("validation_status = 'validated'"));
      assert.deepEqual(params, ["GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET"]);
      return [{ affectedRows: 1 }];
    },
  };
  const hook = {
    id: 99,
    name: "web",
    active: true,
    events: ["push"],
    config: { url: __test__.DEFAULT_CALLBACK_URL, content_type: "json", insecure_ssl: "0" },
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    requests.push({ url, method, body: options.body || null });
    if (url.endsWith("/hooks?per_page=100") && method === "GET") return reply(200, []);
    if (url.endsWith("/hooks") && method === "POST") return reply(201, hook);
    if (url.endsWith("/hooks/99/pings") && method === "POST") return reply(204);
    if (url.endsWith("/hooks/99/deliveries?per_page=20") && method === "GET") {
      return reply(200, [{ id: 7001, guid: "delivery-guid", event: "ping", delivered_at: new Date().toISOString(), status_code: 200, duration: 0.12, redelivery: false }]);
    }
    if (url.endsWith("/hooks/99") && method === "GET") return reply(200, hook);
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const result = await githubRepositoryMainMovedWebhookProvision(
    { ...target, mode: "apply", confirm: __test__.APPLY_CONFIRMATION },
    {
      resolveCredential: async (_ref, options) => {
        credentialCalls.push(options.includeSecret);
        return {
          status: "resolved",
          secret_present: true,
          source: "platform_secrets",
          storage_backend: "db_encrypted",
          value_sha256: "hash",
          ...(options.includeSecret ? { secret: "super-secret-value" } : {}),
        };
      },
      getInstallationToken: async () => "installation-token",
      fetchImpl,
      pool,
      audit: async (entry) => { audits.push(entry); },
      sleep: async () => {},
      auth: { user_id: "admin-user" },
    },
  );
  assert.deepEqual(credentialCalls, [false, true]);
  assert.equal(result.action, "create");
  assert.equal(result.signature_verified, true);
  assert.equal(result.ping.status_code, 200);
  assert.equal(result.secret_reference.validation_status, "validated");
  assert.equal(JSON.stringify(result).includes("super-secret-value"), false);
  assert.equal(JSON.stringify(audits).includes("super-secret-value"), false);
  const createRequest = requests.find((row) => row.method === "POST" && row.url.endsWith("/hooks"));
  assert(createRequest.body.includes("super-secret-value"), "secret must be sent only inside the GitHub hook request");
}

{
  const duplicate = { id: 1, config: { url: __test__.DEFAULT_CALLBACK_URL } };
  await assert.rejects(
    githubRepositoryMainMovedWebhookStatus(target, {
      resolveCredential: async () => ({ status: "resolved", secret_present: true }),
      getInstallationToken: async () => "token",
      fetchImpl: async () => reply(200, [duplicate, { ...duplicate, id: 2 }]),
    }),
    (error) => error.code === "github_webhook_duplicate_hooks_detected",
  );
}

{
  await assert.rejects(
    githubRepositoryMainMovedWebhookProvision({ ...target, callback_url: "https://example.com/webhook", mode: "dry_run" }),
    (error) => error.code === "github_webhook_callback_not_allowed",
  );
}

{
  const readiness = await githubRepositoryMainMovedWebhookProvisioningReadinessSmoke({}, {
    resolveCredential: async (_ref, options) => {
      assert.equal(options.includeSecret, false);
      return { status: "resolved", secret_present: true };
    },
    resolveAppConfig: () => ({ appId: "app", installationId: "installation", privateKey: "configured" }),
  });
  assert.equal(readiness.status, "pass");
  assert.equal(readiness.provider_call_executed, false);
  assert.equal(readiness.mutations_executed, false);
  assert.equal(readiness.secrets_included, false);
}

console.log("github repository-main-moved webhook provisioning tests passed");
