#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PRODUCTION_RUNTIME_PARITY_CONTRACT,
  runProductionRuntimeParityEvidence,
  validateConfiguration
} from "./production-runtime-parity-evidence.mjs";

const SHA = "c".repeat(40);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "production-runtime-parity-"));
const endpoint = (name, required = true) => ({
  name,
  url: `https://${name}.mad4b.com/version`,
  required
});
const successfulTls = async () => ({
  authorized: true,
  protocol: "TLSv1.3",
  valid_from: "Aug 1 00:00:00 2026 GMT",
  valid_to: "Oct 30 23:59:59 2026 GMT",
  fingerprint256: "AA:BB",
  subject_cn: "*.mad4b.com",
  issuer_cn: "Test CA"
});
const lookup = async () => [{ address: "203.0.113.10", family: 4 }];

try {
  const configuration = validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    timeoutMs: 5000,
    endpoints: [endpoint("auth"), endpoint("connector"), endpoint("dev", false)]
  });
  assert.equal(configuration.endpoints.length, 3);
  assert.equal(configuration.endpoints[2].required, false);

  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "bad", url: "http://auth.mad4b.com/version", required: true }]
  }), /HTTPS/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "bad", url: "https://user:pass@auth.mad4b.com/version", required: true }]
  }), /credentials/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "bad", url: "https://example.com/version", required: true }]
  }), /mad4b\.com/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "production",
    endpoints: [endpoint("auth")]
  }), /exactly Production/u);

  const passed = await runProductionRuntimeParityEvidence({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [endpoint("auth"), endpoint("connector"), endpoint("dev", false)],
    outputDir: path.join(root, "passed"),
    lookup,
    tlsProbe: successfulTls,
    fetchImpl: async (url) => {
      if (url.includes("dev.mad4b.com")) throw new Error("temporary DNS path");
      return new Response(JSON.stringify({
        service: "http_generic_api_connector",
        deployment: {
          deployed_commit_sha: SHA,
          manifest: { branch: "Production" }
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    env: {
      GITHUB_SHA: "d".repeat(40),
      GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      GITHUB_WORKFLOW: "Production Runtime Parity Evidence",
      GITHUB_RUN_ID: "123"
    },
    now: (() => {
      let current = 0;
      return () => (current += 5);
    })()
  });

  assert.equal(passed.report.contract, PRODUCTION_RUNTIME_PARITY_CONTRACT);
  assert.equal(passed.report.outcome, "passed");
  assert.equal(passed.report.endpoints[0].status, "passed");
  assert.equal(passed.report.endpoints[1].status, "passed");
  assert.equal(passed.report.endpoints[2].status, "optional_failed");
  assert.equal(passed.report.endpoints[0].dns.addresses[0].length, 64);
  assert.notEqual(passed.report.endpoints[0].dns.addresses[0], "203.0.113.10");
  assert.equal(passed.report.side_effects.repository_mutation_performed, false);
  assert.equal(passed.report.side_effects.sql_execution_performed, false);
  assert.equal(passed.report.secrets_included, false);
  assert.ok(fs.existsSync(passed.jsonPath));
  assert.ok(fs.existsSync(passed.markdownPath));

  const failed = await runProductionRuntimeParityEvidence({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [endpoint("auth"), endpoint("connector")],
    outputDir: path.join(root, "failed"),
    lookup,
    tlsProbe: successfulTls,
    fetchImpl: async (url) => new Response(JSON.stringify({
      service: "http_generic_api_connector",
      deployment: {
        deployed_commit_sha: url.includes("connector") ? "e".repeat(40) : SHA,
        manifest: { branch: "Production" }
      },
      access_token: "must-not-be-persisted"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  assert.equal(failed.report.outcome, "failed");
  assert.equal(failed.report.first_failure.endpoint, "connector");
  assert.equal(failed.report.first_failure.code, "deployed_sha_mismatch");
  assert.doesNotMatch(JSON.stringify(failed.report), /must-not-be-persisted/u);
  assert.equal(failed.report.endpoints[1].http.body_sha256.length, 64);

  const tlsFailed = await runProductionRuntimeParityEvidence({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [endpoint("auth")],
    outputDir: path.join(root, "tls-failed"),
    lookup,
    tlsProbe: async () => {
      const error = new Error("certificate expired secret=hidden");
      error.code = "tls_handshake_failed";
      throw error;
    },
    fetchImpl: async () => {
      throw new Error("must not fetch after TLS failure");
    }
  });
  assert.equal(tlsFailed.report.outcome, "failed");
  assert.equal(tlsFailed.report.first_failure.code, "tls_handshake_failed");
  assert.doesNotMatch(JSON.stringify(tlsFailed.report), /secret=hidden/u);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tests: 4,
  gate: "production_runtime_parity_structured_evidence",
  contract: PRODUCTION_RUNTIME_PARITY_CONTRACT,
  secrets_included: false
}));
