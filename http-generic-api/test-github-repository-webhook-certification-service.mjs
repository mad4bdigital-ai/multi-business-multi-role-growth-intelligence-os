import assert from "node:assert/strict";
import {
  __test__,
  recordGithubRepositoryWebhookCertification,
} from "./githubRepositoryWebhookCertificationService.js";

function verifiedInput() {
  return {
    authority: {
      binding_id: "binding-id",
      binding_key: "brand.github.primary.production",
      repository_node_id: "NODE_123",
      repository_external_id: "123",
      canonical_owner: "owner",
      canonical_name: "repo",
      environment: "production",
    },
    capability: {
      capability_binding_id: "capability-id",
      capability_binding_key: "brand.github.webhook.production",
      capability_key: "github_repository_main_moved_webhook_provision",
    },
    governance: {
      envelope_id: "envelope-id",
      resource_uri: "repository-binding://brand.github.primary.production",
    },
    hook: {
      id: 77,
      callback_url: "https://auth.mad4b.com/webhooks/github/repository-main-moved",
      events: ["push"],
      active: true,
      content_type: "json",
      insecure_ssl: "0",
    },
    ping: {
      delivery_id: "delivery-1",
      event: "ping",
      status_code: 200,
    },
    expectedCommitSha: "a".repeat(40),
    bindingSha256: "b".repeat(64),
    capabilitySha256: "c".repeat(64),
  };
}

function transactionalPool({ breakReadback = false } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  let released = false;
  const connection = {
    async beginTransaction() { calls.push({ kind: "begin" }); },
    async commit() { committed = true; calls.push({ kind: "commit" }); },
    async rollback() { rolledBack = true; calls.push({ kind: "rollback" }); },
    release() { released = true; calls.push({ kind: "release" }); },
    async query(sql, params) {
      calls.push({ kind: "query", sql, params });
      if (sql.includes("INSERT INTO platform_evidence_events")) return [{ affectedRows: 1 }];
      if (sql.includes("INSERT INTO platform_capability_certifications")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM platform_evidence_events")) {
        return [[{
          evidence_id: "github-webhook-readback:envelope-id",
          evidence_status: breakReadback ? "failed" : "passed",
          payload_hash: calls.find((row) => row.sql?.includes("INSERT INTO platform_evidence_events"))?.params?.[10],
          secrets_included: 0,
        }]];
      }
      if (sql.includes("FROM platform_capability_certifications")) {
        return [[{
          certification_id: "github-webhook:capability-id:production",
          certification_status: __test__.CERTIFICATION_STATUS,
          evidence_id: "github-webhook-readback:envelope-id",
          subject_type: "repository_capability_binding",
          subject_key: "capability-id",
          environment: "production",
          secrets_included: 0,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {
    pool: { async getConnection() { return connection; } },
    calls,
    state: () => ({ committed, rolledBack, released }),
  };
}

{
  const mock = transactionalPool();
  const result = await recordGithubRepositoryWebhookCertification(verifiedInput(), { pool: mock.pool });
  assert.equal(result.ok, true);
  assert.equal(result.evidence_id, "github-webhook-readback:envelope-id");
  assert.equal(result.certification_id, "github-webhook:capability-id:production");
  assert.equal(result.certification_type, "provider_external_write_readback");
  assert.equal(result.certification_status, "same_cycle_readback_certified");
  assert.equal(result.runtime_dispatch_changed, false);
  assert.equal(result.runtime_apply_changed, false);
  assert.equal(result.secrets_included, false);
  assert.equal(mock.state().committed, true);
  assert.equal(mock.state().rolledBack, false);
  assert.equal(mock.state().released, true);
  const parameterValues = mock.calls
    .filter((row) => row.kind === "query")
    .flatMap((row) => Array.isArray(row.params) ? row.params : []);
  const serializedParameters = JSON.stringify(parameterValues);
  assert.equal(serializedParameters.includes("super-secret-value"), false, "evidence writes must not include secret material");
  assert.equal(serializedParameters.includes("ref:secret:"), false, "evidence writes must not include credential references");

  const parsedPayloads = parameterValues
    .filter((value) => typeof value === "string" && value.trim().startsWith("{"))
    .map((value) => JSON.parse(value));
  const visitedKeys = [];
  const visitedStrings = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        visitedKeys.push(key);
        visit(nested);
      }
      return;
    }
    if (typeof value === "string") visitedStrings.push(value);
  };
  parsedPayloads.forEach(visit);
  assert.equal(visitedKeys.includes("credential_ref"), false, "evidence payloads must not expose a credential_ref field");
  assert.equal(visitedStrings.some((value) => value.startsWith("ref:secret:")), false, "evidence payload values must not expose credential references");
}

{
  const mock = transactionalPool({ breakReadback: true });
  await assert.rejects(
    recordGithubRepositoryWebhookCertification(verifiedInput(), { pool: mock.pool }),
    (error) => error.code === "github_webhook_certification_readback_failed",
  );
  assert.equal(mock.state().committed, false);
  assert.equal(mock.state().rolledBack, true);
  assert.equal(mock.state().released, true);
}

{
  await assert.rejects(
    recordGithubRepositoryWebhookCertification({ ...verifiedInput(), bindingSha256: "bad" }, { pool: transactionalPool().pool }),
    (error) => error.code === "github_webhook_certification_fingerprint_invalid",
  );
}

console.log("GitHub repository webhook certification service tests passed");
