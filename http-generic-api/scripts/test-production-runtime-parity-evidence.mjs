#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const lookup = async () => [{ address: "104.21.10.20", family: 4 }];

try {
  const configuration = validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    timeoutMs: 5000,
    endpoints: [endpoint("auth"), endpoint("connector"), endpoint("dev", false)]
  });
  assert.equal(configuration.endpoints.length, 3);
  assert.equal(configuration.endpoints[2].required, false);

  const repositoryRoot = process.env.REPOSITORY_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const workflowPath = path.join(repositoryRoot, ".github/workflows/production-runtime-parity-evidence.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const reporterSource = fs.readFileSync(fileURLToPath(new URL("./production-runtime-parity-evidence.mjs", import.meta.url)), "utf8");
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/u);
  assert.match(workflow, /\[\[ "\$\{GITHUB_REF\}" == "refs\/heads\/main" \]\]/u);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /refs\/remotes\/origin\/Production/u);
  assert.match(workflow, /requiredNames\.has\("auth"\)/u);
  assert.match(workflow, /requiredNames\.has\("connector"\)/u);
  assert.match(workflow, /\[\[ "\$\{production_sha\}" == "\$\{EXPECTED_SHA\}" \]\]/u);
  assert.doesNotMatch(workflow, /^  (?:push|schedule|pull_request_target|issue_comment|deployment):/mu);
  assert.match(reporterSource, /"dns_timeout"/u);
  assert.match(reporterSource, /"http_timeout"/u);
  assert.match(reporterSource, /body = await readBoundedBody\(response\)/u);

  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "auth", url: "http://auth.mad4b.com/version", required: true }]
  }), /HTTPS/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "auth", url: "https://user:pass@auth.mad4b.com/version", required: true }]
  }), /credentials/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "auth", url: "https://example.com/version", required: true }]
  }), /auth\.mad4b\.com/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "auth", url: "https://arbitrary.mad4b.com/version", required: true }]
  }), /auth\.mad4b\.com/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "auth", url: "https://auth.mad4b.com:8443/version", required: true }]
  }), /port 443/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "connector", url: "https://auth.mad4b.com/version", required: true }]
  }), /connector\.mad4b\.com/u);
  assert.throws(() => validateConfiguration({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [{ name: "other", url: "https://dev.mad4b.com/version", required: true }]
  }), /not an approved Production endpoint/u);

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
  assert.notEqual(passed.report.endpoints[0].dns.addresses[0], "104.21.10.20");
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

  const untrustedIdentityFailed = await runProductionRuntimeParityEvidence({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [endpoint("auth")],
    outputDir: path.join(root, "untrusted-identity-failed"),
    lookup,
    tlsProbe: successfulTls,
    fetchImpl: async () => new Response(JSON.stringify({
      service: "client_secret=swordfish",
      deployment: {
        deployed_commit_sha: "access_token=top-secret",
        manifest: { branch: "Bearer visible-token" }
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  assert.equal(untrustedIdentityFailed.report.outcome, "failed");
  assert.equal(untrustedIdentityFailed.report.first_failure.code, "service_identity_mismatch");
  assert.deepEqual(untrustedIdentityFailed.report.endpoints[0].runtime, {
    service: null,
    deployed_commit_sha: null,
    deployment_branch: null
  });
  assert.doesNotMatch(JSON.stringify(untrustedIdentityFailed.report), /swordfish|top-secret|visible-token/u);

  const privateDnsFailed = await runProductionRuntimeParityEvidence({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [endpoint("auth")],
    outputDir: path.join(root, "private-dns-failed"),
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    tlsProbe: async () => {
      throw new Error("TLS must not run for a forbidden DNS address");
    },
    fetchImpl: async () => {
      throw new Error("HTTP must not run for a forbidden DNS address");
    }
  });
  assert.equal(privateDnsFailed.report.outcome, "failed");
  assert.equal(privateDnsFailed.report.first_failure.code, "dns_address_forbidden");

  const excessiveDnsFailed = await runProductionRuntimeParityEvidence({
    expectedSha: SHA,
    expectedBranch: "Production",
    endpoints: [endpoint("auth")],
    outputDir: path.join(root, "excessive-dns-failed"),
    lookup: async () => Array.from({ length: 17 }, (_, index) => ({
      address: `104.21.10.${index + 1}`,
      family: 4
    })),
    tlsProbe: async () => {
      throw new Error("TLS must not run when DNS address cardinality exceeds the cap");
    },
    fetchImpl: async () => {
      throw new Error("HTTP must not run when DNS address cardinality exceeds the cap");
    }
  });
  assert.equal(excessiveDnsFailed.report.outcome, "failed");
  assert.equal(excessiveDnsFailed.report.first_failure.code, "dns_address_count_exceeded");

  for (const address of ["192.0.2.10", "198.51.100.10", "203.0.113.10", "2001:db8::10"]) {
    const documentationDnsFailed = await runProductionRuntimeParityEvidence({
      expectedSha: SHA,
      expectedBranch: "Production",
      endpoints: [endpoint("auth")],
      outputDir: path.join(root, `documentation-dns-${address.replaceAll(":", "-")}`),
      lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      tlsProbe: async () => {
        throw new Error("TLS must not run for a documentation DNS address");
      },
      fetchImpl: async () => {
        throw new Error("HTTP must not run for a documentation DNS address");
      }
    });
    assert.equal(documentationDnsFailed.report.outcome, "failed");
    assert.equal(documentationDnsFailed.report.first_failure.code, "dns_address_forbidden");
  }

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
  tests: 9,
  gate: "production_runtime_parity_structured_evidence",
  contract: PRODUCTION_RUNTIME_PARITY_CONTRACT,
  secrets_included: false
}));
