import assert from "node:assert/strict";
import fs from "node:fs";
import "./test-github-repository-webhook-certification-service.mjs";
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
const bindingKey = "growth_intelligence_platform.github.primary.production";
const bindingSha256 = "b".repeat(64);
const capabilitySha256 = "c".repeat(64);
const expectedCommitSha = "a".repeat(40);
const applyReason = "Provision the governed repository webhook after reviewed readiness evidence.";

function repositoryAuthorityResult(overrides = {}) {
  return {
    authority: {
      binding_id: "repository-binding-id",
      binding_key: bindingKey,
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      brand_target_key: "growth_intelligence_platform",
      app_key: "github",
      provider_key: "github",
      repository_external_id: "1213257854",
      repository_node_id: "R_kgDOSFDYfg",
      canonical_owner: target.owner,
      canonical_name: target.repo,
      environment: "production",
      ...overrides.authority,
    },
    capability: {
      capability_binding_id: "repository-capability-id",
      capability_binding_key: "growth_intelligence_platform.github.repository_main_moved_webhook.production",
      capability_key: __test__.CAPABILITY_KEY,
      operation_intent: __test__.CAPABILITY_KEY,
      effect_class: "external_write",
      ...overrides.capability,
    },
    resource_uri: `repository-binding://${bindingKey}`,
    binding_sha256: bindingSha256,
    capability_sha256: capabilitySha256,
    configuration: {
      callback_url: __test__.DEFAULT_CALLBACK_URL,
      events: ["push"],
      hook_name: "web",
      content_type: "json",
      insecure_ssl: "0",
      active: true,
      ...overrides.configuration,
    },
    configuration_source_map: {
      callback_url: `repository:${bindingKey}`,
      events: "brand:growth_intelligence_platform",
      active: "environment:production",
    },
    credential_ref: "ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET",
    secrets_included: false,
    ...overrides.result,
  };
}

const authorityDeps = {
  pool: {},
  resolveLegacyBindingSelector: async ({ owner, repo }) => {
    assert.equal(owner, target.owner);
    assert.equal(repo, target.repo);
    return { binding_key: bindingKey };
  },
  resolveRepositoryAuthority: async ({ bindingKey: requestedBindingKey, capabilityKey, expectedBindingSha256 = "", expectedCapabilitySha256 = "" }) => {
    assert.equal(requestedBindingKey, bindingKey);
    assert.equal(capabilityKey, __test__.CAPABILITY_KEY);
    if (expectedBindingSha256) assert.equal(expectedBindingSha256, bindingSha256);
    if (expectedCapabilitySha256) assert.equal(expectedCapabilitySha256, capabilitySha256);
    return repositoryAuthorityResult();
  },
};

{
  const calls = [];
  const result = await githubRepositoryMainMovedWebhookProvision(
    { ...target, mode: "dry_run" },
    {
      ...authorityDeps,
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
  let providerCalls = 0;
  let credentialCalls = 0;
  await assert.rejects(
    githubRepositoryMainMovedWebhookProvision(
      {
        ...target,
        mode: "apply",
        confirm: __test__.APPLY_CONFIRMATION,
        expected_commit_sha: expectedCommitSha,
        reason: applyReason,
      },
      {
        resolveCapabilityEnvelope: async ({ envelopeId }) => ({
          ok: false,
          status: envelopeId ? "unexpected_envelope" : "capability_resolution_envelope_required",
          secrets_included: false,
        }),
        resolveCredential: async () => {
          credentialCalls += 1;
          return { status: "resolved", secret_present: true };
        },
        fetchImpl: async () => {
          providerCalls += 1;
          return reply(200, []);
        },
      },
    ),
    (error) => error.code === "capability_resolution_envelope_required",
  );
  assert.equal(providerCalls, 0, "apply without a governance envelope must not call GitHub");
  assert.equal(credentialCalls, 0, "apply without a governance envelope must not resolve the secret");
}

{
  let providerCalls = 0;
  let credentialCalls = 0;
  await assert.rejects(
    githubRepositoryMainMovedWebhookProvision(
      {
        ...target,
        mode: "apply",
        confirm: __test__.APPLY_CONFIRMATION,
        capability_envelope_id: "envelope-race",
        expected_commit_sha: expectedCommitSha,
        binding_sha256: bindingSha256,
        capability_sha256: capabilitySha256,
        reason: applyReason,
      },
      {
        ...authorityDeps,
        auth: { user_id: "admin-user" },
        resolveCapabilityEnvelope: async () => ({
          ok: true,
          envelope_id: "envelope-race",
          apply_allowed: true,
          secrets_included: false,
        }),
        claimEnvelopeReferenced: async () => ({
          ok: false,
          status: "capability_resolution_envelope_claim_failed",
          envelope_id: "envelope-race",
          affected_rows: 0,
          secrets_included: false,
        }),
        resolveCredential: async () => {
          credentialCalls += 1;
          return { status: "resolved", secret_present: true };
        },
        fetchImpl: async () => {
          providerCalls += 1;
          return reply(200, []);
        },
      },
    ),
    (error) => error.code === "capability_resolution_envelope_claim_failed",
  );
  assert.equal(providerCalls, 0, "a lost atomic envelope claim must not call GitHub");
  assert.equal(credentialCalls, 0, "a lost atomic envelope claim must not resolve the secret");
}

{
  const requests = [];
  const credentialCalls = [];
  const audits = [];
  const lifecycle = [];
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
    lifecycle.push(`provider:${method}`);
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
    {
      ...target,
      mode: "apply",
      confirm: __test__.APPLY_CONFIRMATION,
      capability_envelope_id: "envelope-1",
      expected_commit_sha: expectedCommitSha,
      binding_sha256: bindingSha256,
      capability_sha256: capabilitySha256,
      reason: applyReason,
    },
    {
      ...authorityDeps,
      resolveCapabilityEnvelope: async (args) => {
        lifecycle.push("envelope:resolved");
        assert.equal(args.envelopeId, "envelope-1");
        assert.equal(args.expectedCommitSha, expectedCommitSha);
        assert.deepEqual(args.acceptedAppKeys, ["github"]);
        assert.deepEqual(args.acceptedCapabilityKeys, ["github_repository_main_moved_webhook_provision"]);
        assert.deepEqual(args.acceptedIntents, ["github_repository_main_moved_webhook_provision"]);
        assert.equal(args.allowReferenced, false);
        return { ok: true, envelope_id: "envelope-1", apply_allowed: true, secrets_included: false };
      },
      claimEnvelopeReferenced: async (args) => {
        lifecycle.push("envelope:referenced");
        assert.equal(args.envelopeId, "envelope-1");
        assert(args.executionRef.includes(expectedCommitSha.slice(0, 12)));
        return { ok: true, envelope_id: "envelope-1", secrets_included: false };
      },
      recordCertification: async (args) => {
        lifecycle.push("certification:recorded");
        assert.equal(args.authority.binding_id, "repository-binding-id");
        assert.equal(args.capability.capability_binding_id, "repository-capability-id");
        assert.equal(args.governance.envelope_id, "envelope-1");
        assert.equal(args.governance.resource_uri, `repository-binding://${bindingKey}`);
        assert.equal(args.hook.hook_id, 99);
        assert.equal(args.ping.status_code, 200);
        assert.equal(args.expectedCommitSha, expectedCommitSha);
        assert.equal(args.bindingSha256, bindingSha256);
        assert.equal(args.capabilitySha256, capabilitySha256);
        return {
          ok: true,
          evidence_id: "github-webhook-readback:envelope-1",
          certification_id: "github-webhook:repository-capability-id:production",
          certification_type: "provider_external_write_readback",
          certification_status: "same_cycle_readback_certified",
          environment: "production",
          secrets_included: false,
        };
      },
      transitionEnvelopeLifecycle: async (args) => {
        lifecycle.push("envelope:consumed");
        assert.equal(args.envelopeId, "envelope-1");
        assert.equal(args.action, "consume");
        assert.equal(args.reason, applyReason);
        assert(args.executionRef.endsWith(":99"));
        return { ok: true, envelope_id: "envelope-1", after: { execution_status: "executed" }, secrets_included: false };
      },
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
  assert.equal(result.governance.capability_envelope_id, "envelope-1");
  assert.equal(result.governance.execution_status, "executed");
  assert.equal(result.governance.expected_commit_sha, expectedCommitSha);
  assert.equal(result.secret_reference.validation_status, "validated");
  assert.equal(result.certification.evidence_id, "github-webhook-readback:envelope-1");
  assert.equal(result.certification.certification_id, "github-webhook:repository-capability-id:production");
  assert.equal(result.certification.certification_status, "same_cycle_readback_certified");
  assert.equal(JSON.stringify(result).includes("super-secret-value"), false);
  assert.equal(JSON.stringify(result).includes("ref:secret:"), false);
  assert.equal(JSON.stringify(audits).includes("super-secret-value"), false);
  assert.equal(JSON.stringify(audits).includes("ref:secret:"), false);
  assert.equal(audits[0]?.after_json?.capability_envelope_id, "envelope-1");
  assert.equal(audits[0]?.after_json?.expected_commit_sha, expectedCommitSha);
  assert.equal(audits[0]?.after_json?.evidence_id, "github-webhook-readback:envelope-1");
  assert.equal(audits[0]?.after_json?.certification_id, "github-webhook:repository-capability-id:production");
  assert.equal(audits[0]?.after_json?.certification_status, "same_cycle_readback_certified");
  const referencedIndex = lifecycle.indexOf("envelope:referenced");
  const firstProviderIndex = lifecycle.findIndex((row) => row.startsWith("provider:"));
  const certificationIndex = lifecycle.indexOf("certification:recorded");
  const consumedIndex = lifecycle.indexOf("envelope:consumed");
  assert(referencedIndex >= 0 && referencedIndex < firstProviderIndex, "envelope must be referenced before the first provider call");
  assert(certificationIndex > firstProviderIndex, "certification must be recorded after provider readback");
  assert(consumedIndex > certificationIndex, "envelope must be consumed only after certification readback");
  const createRequest = requests.find((row) => row.method === "POST" && row.url.endsWith("/hooks"));
  assert(createRequest.body.includes("super-secret-value"), "secret must be sent only inside the GitHub hook request");
}

{
  let consumed = false;
  let audited = false;
  const pool = {
    async query(sql, params) {
      assert(sql.includes("validation_status = 'validated'"));
      assert.deepEqual(params, ["GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET"]);
      return [{ affectedRows: 1 }];
    },
  };
  const hook = {
    id: 199,
    name: "web",
    active: true,
    events: ["push"],
    config: { url: __test__.DEFAULT_CALLBACK_URL, content_type: "json", insecure_ssl: "0" },
  };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    if (url.endsWith("/hooks?per_page=100") && method === "GET") return reply(200, []);
    if (url.endsWith("/hooks") && method === "POST") return reply(201, hook);
    if (url.endsWith("/hooks/199/pings") && method === "POST") return reply(204);
    if (url.endsWith("/hooks/199/deliveries?per_page=20") && method === "GET") {
      return reply(200, [{ id: 9001, event: "ping", delivered_at: new Date().toISOString(), status_code: 200 }]);
    }
    if (url.endsWith("/hooks/199") && method === "GET") return reply(200, hook);
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  await assert.rejects(
    githubRepositoryMainMovedWebhookProvision(
      {
        ...target,
        mode: "apply",
        confirm: __test__.APPLY_CONFIRMATION,
        capability_envelope_id: "envelope-certification-failure",
        expected_commit_sha: expectedCommitSha,
        binding_sha256: bindingSha256,
        capability_sha256: capabilitySha256,
        reason: applyReason,
      },
      {
        ...authorityDeps,
        pool,
        auth: { user_id: "admin-user" },
        resolveCapabilityEnvelope: async () => ({
          ok: true,
          envelope_id: "envelope-certification-failure",
          apply_allowed: true,
          secrets_included: false,
        }),
        claimEnvelopeReferenced: async () => ({
          ok: true,
          envelope_id: "envelope-certification-failure",
          secrets_included: false,
        }),
        transitionEnvelopeLifecycle: async () => {
          consumed = true;
          return { ok: true, after: { execution_status: "executed" }, secrets_included: false };
        },
        recordCertification: async () => ({
          ok: false,
          status: "github_webhook_certification_readback_failed",
          secrets_included: false,
        }),
        resolveCredential: async (_ref, options) => ({
          status: "resolved",
          secret_present: true,
          ...(options.includeSecret ? { secret: "super-secret-value" } : {}),
        }),
        getInstallationToken: async () => "installation-token",
        fetchImpl,
        audit: async () => { audited = true; },
        sleep: async () => {},
      },
    ),
    (error) => error.code === "github_webhook_certification_failed",
  );
  assert.equal(consumed, false, "failed certification must block envelope consumption");
  assert.equal(audited, false, "failed certification must block success audit");
}

{
  const duplicate = { id: 1, config: { url: __test__.DEFAULT_CALLBACK_URL } };
  await assert.rejects(
    githubRepositoryMainMovedWebhookStatus(target, {
      ...authorityDeps,
      resolveCredential: async () => ({ status: "resolved", secret_present: true }),
      getInstallationToken: async () => "token",
      fetchImpl: async () => reply(200, [duplicate, { ...duplicate, id: 2 }]),
    }),
    (error) => error.code === "github_webhook_duplicate_hooks_detected",
  );
}

{
  await assert.rejects(
    githubRepositoryMainMovedWebhookProvision(
      { ...target, callback_url: "https://example.com/webhook", mode: "dry_run" },
      authorityDeps,
    ),
    (error) => error.code === "github_webhook_callback_assertion_mismatch",
  );
}

{
  const requiredObjects = [
    "repository_authority_bindings",
    "repository_authority_aliases",
    "repository_capability_bindings",
    "repository_capability_policy_layers",
    "v_repository_authority_binding_readiness",
    "v_repository_capability_binding_readiness",
  ];
  const readinessPool = {
    async query(sql, params) {
      if (sql.includes("information_schema.tables")) {
        assert.deepEqual(params, requiredObjects);
        return [requiredObjects.map((table_name) => ({ table_name }))];
      }
      if (sql.includes("v_repository_capability_binding_readiness")) {
        assert.deepEqual(params, [__test__.CAPABILITY_KEY]);
        return [[{ binding_key: bindingKey }]];
      }
      throw new Error(`Unexpected readiness SQL: ${sql}`);
    },
  };
  const readiness = await githubRepositoryMainMovedWebhookProvisioningReadinessSmoke({}, {
    pool: readinessPool,
    resolveRepositoryAuthority: authorityDeps.resolveRepositoryAuthority,
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
  assert.equal(JSON.stringify(readiness).includes("ref:secret:"), false);
}

{
  const policyMigration = fs.readFileSync(
    "./migrations/20260721_github_repository_main_moved_webhook_apply_policy.sql",
    "utf8",
  );
  assert.match(policyMigration, /github_repository_main_moved_webhook_provision_apply_v1/);
  assert.match(policyMigration, /'github',\s*\n\s*'github_repository_main_moved_webhook_provision',\s*\n\s*'github_repository_main_moved_webhook_provision',\s*\n\s*'system_layer'/);
  assert.match(policyMigration, /`allow_external_write`/);
  assert.match(policyMigration, /`requires_readback`/);
  assert.match(policyMigration, /`requires_typed_confirmation`/);
  assert.match(policyMigration, /`requires_same_cycle_dry_run`/);
  assert.match(policyMigration, /github_app\.repository_hooks\.create_or_update_and_ping/);
  assert.match(policyMigration, /signed_ping_status_required', 200/);
  assert.match(policyMigration, /callback_url_fixed', 'https:\/\/auth\.mad4b\.com\/webhooks\/github\/repository-main-moved'/);
  assert.match(policyMigration, /credential_payload_return_allowed', FALSE/);
  assert.match(policyMigration, /inline_secret_input_allowed', FALSE/);
  assert.match(policyMigration, /secrets_included', FALSE/);
  assert.doesNotMatch(policyMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\b/i);
}

{
  const metadataHardeningMigration = fs.readFileSync(
    "./migrations/20260722_github_repository_main_moved_webhook_policy_metadata_hardening.sql",
    "utf8",
  );
  assert.match(metadataHardeningMigration, /github_repository_main_moved_webhook_provision_apply_v1/);
  assert.match(metadataHardeningMigration, /server_side_reference_resolution_allowed/);
  assert.match(metadataHardeningMigration, /inline_sensitive_input_allowed/);
  assert.match(metadataHardeningMigration, /JSON_REMOVE/);
  assert.match(metadataHardeningMigration, /server_side_secret_resolution_allowed/);
  assert.match(metadataHardeningMigration, /inline_secret_input_allowed/);
  assert.doesNotMatch(metadataHardeningMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\b/i);

  const { assertNoSecretBearingFields } = await import("./capabilityEnvelopeSecretPolicy.js");
  assert.doesNotThrow(() => assertNoSecretBearingFields({
    policy: {
      server_side_reference_resolution_allowed: true,
      inline_sensitive_input_allowed: false,
      credential_payload_return_allowed: false,
      secrets_included: false,
    },
  }));
  assert.throws(
    () => assertNoSecretBearingFields({ policy: { server_side_secret_resolution_allowed: true } }),
    (error) => error.code === "capability_envelope_sensitive_field_rejected",
  );
}

console.log("github repository-main-moved webhook provisioning tests passed");
