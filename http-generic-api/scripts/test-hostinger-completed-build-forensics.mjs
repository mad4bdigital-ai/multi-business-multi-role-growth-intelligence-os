import assert from "node:assert/strict";
import {
  CONTRACT,
  HOSTINGER_API_BASE_URL,
  analyzeBuildLogs,
  classifyForensics,
  collectForensics,
  redact,
  sanitizeStructured,
  validateConfiguration,
} from "./hostinger-completed-build-forensics.mjs";

const expectedSha = "f5c1ae8840b4d4452f2908bb0f23051880bb6896";
const staleSha = "ca1e1cfe6697d251d2c50db7fa48246f18ab118f";
const buildUuid = "019fc51c-3947-7255-aa4d-f55cb8df7658";
const productionMergedAt = "2026-08-03T00:53:07Z";
const token = "hostinger-super-secret-token";

const configuration = validateConfiguration({
  accountUsername: "u338416126",
  domain: "auth.mad4b.com",
  buildUuid,
  expectedSha,
  productionMergedAt,
  token,
  outputDir: "artifacts/test",
  timeoutMs: 20_000,
});
assert.equal(configuration.expectedBranch, "Production");
assert.equal(configuration.productionMergedAt, "2026-08-03T00:53:07.000Z");
assert.equal(HOSTINGER_API_BASE_URL, "https://developers.hostinger.com");

assert.throws(
  () => validateConfiguration({ ...configuration, domain: "example.com" }),
  /restricted to auth\.mad4b\.com/u,
);
assert.throws(
  () => validateConfiguration({ ...configuration, token: "" }),
  /HOSTINGER_API_TOKEN is required/u,
);
assert.throws(
  () => validateConfiguration({ ...configuration, buildUuid: "bad" }),
  /canonical lowercase UUID/u,
);

const sanitized = sanitizeStructured({
  node: "22",
  api_token: token,
  nested: { password: "unsafe", entry_file: "server.js" },
});
assert.deepEqual(sanitized, {
  node: "22",
  api_token: "[REDACTED]",
  nested: { password: "[REDACTED]", entry_file: "server.js" },
});
assert.equal(JSON.stringify(sanitized).includes(token), false);
assert.equal(redact(`Authorization: Bearer ${token}`).includes(token), false);

const logs = [
  `Checking out commit ${expectedSha}`,
  "source_branch=Production",
  "release .builds/versions/019fc51c-3947-7255-aa4d-f55cb8df7658",
  "Deployment completed successfully",
  "process restarted",
].join("\n");
const logAnalysis = analyzeBuildLogs(logs, {
  uuid: buildUuid,
  options: { node: "22", entry_file: "server.js", api_token: token },
});
assert.deepEqual(logAnalysis.source_shas, [expectedSha]);
assert.ok(logAnalysis.source_branches.includes("Production"));
assert.ok(logAnalysis.release_directories.includes(".builds/versions/019fc51c-3947-7255-aa4d-f55cb8df7658"));
assert.equal(logAnalysis.deploy_completed_hint, true);
assert.equal(logAnalysis.restart_hint, true);
assert.equal(logAnalysis.failure_hint, false);
assert.match(logAnalysis.excerpt_sha256, /^[0-9a-f]{64}$/u);
assert.equal(JSON.stringify(logAnalysis).includes(token), false);

const staleRuntime = {
  health: { ok: true, identity: { sha: null, branch: null, release_directories: [] } },
  version: { ok: true, identity: { sha: staleSha, branch: null, release_directories: [] } },
  deploymentInfo: { ok: true, identity: { sha: staleSha, branch: "main", release_directories: [".builds/versions/old"] } },
  connectorAgentVersion: { ok: true, identity: { sha: staleSha, branch: null, release_directories: [] } },
};
assert.deepEqual(
  classifyForensics({ configuration, logAnalysis, runtime: staleRuntime }),
  {
    outcome: "blocked",
    classification: "completed_expected_build_not_active_restart_or_slot_promotion_required",
    next_action: "verify_active_slot_then_restart_existing_nodejs_server_if_slot_is_current",
  },
);

const currentRuntime = structuredClone(staleRuntime);
currentRuntime.version.identity.sha = expectedSha;
currentRuntime.deploymentInfo.identity.sha = expectedSha;
currentRuntime.deploymentInfo.identity.branch = "Production";
assert.equal(
  classifyForensics({ configuration, logAnalysis, runtime: currentRuntime }).classification,
  "production_runtime_current",
);

const calls = [];
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const fetchImpl = async (url, init = {}) => {
  const href = String(url);
  calls.push({ href, method: init.method, authorization: init.headers?.authorization || null });
  if (href.includes("/nodejs/builds?") || href.endsWith("/nodejs/builds?page=1")) {
    return jsonResponse({
      data: [{
        uuid: buildUuid,
        state: "completed",
        created_at: "2026-08-03T00:53:09Z",
        updated_at: "2026-08-03T00:53:35Z",
        options: { node: "22", entry_file: "server.js", api_token: token },
      }],
    });
  }
  if (href.includes(`/nodejs/builds/${buildUuid}/logs`)) return jsonResponse({ logs });
  if (href.endsWith("/health")) return jsonResponse({ ok: true, service: "http_generic_api_connector" });
  if (href.endsWith("/version")) return jsonResponse({ service: "http_generic_api_connector", buildSha: staleSha });
  if (href.endsWith("/deployment-info")) {
    return jsonResponse({
      deployment: {
        deployed_commit_sha: staleSha,
        manifest: { branch: "main", commit_sha: staleSha },
        release_directory: ".builds/versions/old-release",
      },
    });
  }
  if (href.endsWith("/connector-agent/version")) return jsonResponse({ buildSha: staleSha });
  throw new Error(`Unexpected URL: ${href}`);
};

const report = await collectForensics(configuration, {
  fetchImpl,
  now: () => new Date("2026-08-03T07:00:00Z"),
});
assert.equal(report.contract, CONTRACT);
assert.equal(report.generated_at, "2026-08-03T07:00:00.000Z");
assert.equal(report.build.uuid, buildUuid);
assert.equal(report.build.state, "completed");
assert.equal(report.build.options.api_token, "[REDACTED]");
assert.equal(report.decision.classification, "completed_expected_build_not_active_restart_or_slot_promotion_required");
assert.equal(report.runtime.version.identity.sha, staleSha);
assert.equal(report.runtime.deploymentInfo.identity.branch, "main");
assert.equal(report.requests.methods.join(","), "GET");
assert.equal(report.requests.token_returned, false);
assert.equal(report.side_effects.provider_mutation_performed, false);
assert.equal(report.side_effects.build_created, false);
assert.equal(report.side_effects.deployment_performed, false);
assert.equal(report.side_effects.active_slot_changed, false);
assert.equal(report.side_effects.restart_performed, false);
assert.equal(report.secrets_included, false);
assert.equal(JSON.stringify(report).includes(token), false);
assert.equal(calls.length, 6);
assert.ok(calls.every((call) => call.method === "GET"));
assert.ok(calls.filter((call) => call.href.startsWith(HOSTINGER_API_BASE_URL)).every((call) => call.authorization === `Bearer ${token}`));
assert.ok(calls.filter((call) => call.href.startsWith("https://auth.mad4b.com")).every((call) => call.authorization === null));

console.log("Hostinger completed build forensics contract test passed");
