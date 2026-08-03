#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONNECTOR_RECOVERY_EVIDENCE_CONTRACT,
  runConnectorRecoveryEvidence,
  validateConfiguration
} from "./connector-recovery-evidence.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "connector-recovery-evidence-"));
const publicLookup = async () => [{ address: "104.21.10.20", family: 4 }];
const successfulTls = async () => ({
  authorized: true,
  protocol: "TLSv1.3",
  valid_from: "Aug 1 00:00:00 2026 GMT",
  valid_to: "Oct 30 23:59:59 2026 GMT",
  fingerprint256: "AA:BB",
  subject_cn: "*.mad4b.com",
  issuer_cn: "Test CA"
});
const healthResponse = (overrides = {}) => new Response(JSON.stringify({
  ok: true,
  service: "local-connector",
  hostname: "DESKTOP-TEST",
  platform: "win32",
  uptime: 123.5,
  ...overrides
}), { status: 200, headers: { "content-type": "application/json" } });

try {
  const configuration = validateConfiguration();
  assert.equal(configuration.connectorUrl, "https://connector.mad4b.com/health");
  assert.equal(configuration.endpoint.host, "connector.mad4b.com");

  for (const url of [
    "http://connector.mad4b.com/health",
    "https://user:pass@connector.mad4b.com/health",
    "https://connector.mad4b.com:8443/health",
    "https://connector.mad4b.com/version",
    "https://connector.mad4b.com/health?token=secret",
    "https://auth.mad4b.com/health"
  ]) {
    assert.throws(() => validateConfiguration({ connectorUrl: url }));
  }

  const repositoryRoot = process.env.REPOSITORY_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/connector-recovery-evidence.yml"), "utf8");
  const serverSource = fs.readFileSync(path.join(repositoryRoot, "local-connector/server.mjs"), "utf8");
  const openapi = fs.readFileSync(path.join(repositoryRoot, "canonicals/openapi/local-connector.openapi.yaml"), "utf8");
  const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "http-generic-api/config/deployment-branch-policy.json"), "utf8"));

  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/u);
  assert.match(workflow, /\[\[ "\$\{GITHUB_REF\}" == "refs\/heads\/main" \]\]/u);
  assert.match(workflow, /https:\/\/connector\.mad4b\.com\/health/u);
  assert.doesNotMatch(workflow, /secrets\.|CONNECTOR_SECRET|authorization|x-api-key|x-connector-secret/iu);
  assert.doesNotMatch(workflow, /^  (?:push|schedule|pull_request_target|issue_comment|deployment):/mu);

  assert.match(serverSource, /function healthBody\(\)/u);
  assert.match(serverSource, /service: 'local-connector'/u);
  assert.match(serverSource, /platform: process\.platform/u);
  assert.match(serverSource, /uptime: process\.uptime\(\)/u);
  assert.match(openapi, /\/health:/u);
  assert.match(openapi, /security: \[\]/u);
  assert.equal(policy.connector_recovery.hostname, "connector.mad4b.com");
  assert.equal(policy.connector_recovery.deployment_provider, "cloudflare_tunnel_local_windows_service");
  assert.equal(policy.connector_recovery.hostinger_auto_deploy, false);

  const passed = await runConnectorRecoveryEvidence({
    outputDir: path.join(root, "passed"),
    lookup: publicLookup,
    tlsProbe: successfulTls,
    fetchImpl: async () => healthResponse(),
    env: {
      GITHUB_SHA: "a".repeat(40),
      GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      GITHUB_WORKFLOW: "Connector Recovery Evidence",
      GITHUB_RUN_ID: "123"
    },
    now: (() => {
      let current = 0;
      return () => (current += 5);
    })()
  });
  assert.equal(passed.report.contract, CONNECTOR_RECOVERY_EVIDENCE_CONTRACT);
  assert.equal(passed.report.outcome, "passed");
  assert.equal(passed.report.endpoint.runtime.service, "local-connector");
  assert.equal(passed.report.endpoint.runtime.platform, "win32");
  assert.equal(passed.report.endpoint.runtime.hostname_present, true);
  assert.equal(passed.report.endpoint.runtime.hostname_sha256.length, 64);
  assert.notEqual(passed.report.endpoint.runtime.hostname_sha256, "DESKTOP-TEST");
  assert.equal(passed.report.endpoint.runtime.uptime_seconds, 123.5);
  assert.equal(passed.report.secrets_included, false);
  assert.equal(passed.report.side_effects.credential_access_performed, false);
  assert.ok(fs.existsSync(passed.jsonPath));
  assert.ok(fs.existsSync(passed.markdownPath));

  const http530 = await runConnectorRecoveryEvidence({
    outputDir: path.join(root, "http530"),
    lookup: publicLookup,
    tlsProbe: successfulTls,
    fetchImpl: async () => new Response("edge failure", { status: 530, headers: { "content-type": "text/html" } })
  });
  assert.equal(http530.report.outcome, "failed");
  assert.equal(http530.report.first_failure.code, "http_status_mismatch");

  for (const [name, overrides, code] of [
    ["service", { service: "http_generic_api_connector" }, "service_identity_mismatch"],
    ["platform", { platform: "linux" }, "platform_identity_mismatch"],
    ["hostname", { hostname: "" }, "hostname_missing"],
    ["uptime", { uptime: -1 }, "uptime_invalid"],
    ["ok", { ok: false }, "connector_health_not_ok"]
  ]) {
    const result = await runConnectorRecoveryEvidence({
      outputDir: path.join(root, name),
      lookup: publicLookup,
      tlsProbe: successfulTls,
      fetchImpl: async () => healthResponse(overrides)
    });
    assert.equal(result.report.outcome, "failed");
    assert.equal(result.report.first_failure.code, code);
  }

  const privateDns = await runConnectorRecoveryEvidence({
    outputDir: path.join(root, "private-dns"),
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    tlsProbe: async () => { throw new Error("TLS must not run"); },
    fetchImpl: async () => { throw new Error("HTTP must not run"); }
  });
  assert.equal(privateDns.report.first_failure.code, "dns_address_forbidden");

  const secretPayload = await runConnectorRecoveryEvidence({
    outputDir: path.join(root, "secret-payload"),
    lookup: publicLookup,
    tlsProbe: successfulTls,
    fetchImpl: async () => healthResponse({
      service: "authorization=Bearer visible-token",
      hostname: "password=swordfish"
    })
  });
  const serialized = JSON.stringify(secretPayload.report);
  assert.equal(secretPayload.report.outcome, "failed");
  assert.doesNotMatch(serialized, /visible-token|swordfish/u);
  assert.equal(secretPayload.report.endpoint.runtime.hostname_sha256?.length, 64);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tests: 9,
  gate: "connector_recovery_evidence",
  contract: CONNECTOR_RECOVERY_EVIDENCE_CONTRACT,
  secrets_included: false
}));
