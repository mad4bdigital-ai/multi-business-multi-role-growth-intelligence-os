#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT = "mad4b.hostinger-nodejs-production-restart.v1";
export const HOSTINGER_API_BASE_URL = "https://developers.hostinger.com";
const DEFAULT_DOMAIN = "auth.mad4b.com";
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "hostinger-nodejs-production-restart");
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_ATTEMPTS = 12;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

class RestartError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "RestartError";
    this.code = code;
    this.status = status;
  }
}

export function redact(value, maxLength = 4_000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]")
    .replace(/\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?token|api[_-]?key|password|cookie|secret|private[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu, "$1$2[REDACTED]")
    .slice(0, maxLength);
}

function redactKnownSecret(value, secret, maxLength = 4_000) {
  const text = String(value ?? "");
  return redact(secret ? text.split(String(secret)).join("[REDACTED]") : text, maxLength);
}

function safeFailure(error, fallbackCode = "hostinger_restart_error") {
  const candidate = String(error?.code ?? "");
  return {
    code: /^[a-z][a-z0-9_]{1,63}$/u.test(candidate) ? candidate : fallbackCode,
    message: redact(error?.message ?? String(error), 1_000),
    http_status: Number.isInteger(error?.status) ? error.status : 0,
  };
}

function parseIso(value, code, label) {
  const text = String(value ?? "").trim();
  const timestamp = Date.parse(text);
  if (!text || Number.isNaN(timestamp)) throw new RestartError(code, `${label} must be an ISO-8601 timestamp.`);
  return { text: new Date(timestamp).toISOString(), timestamp };
}

export function parseArgs(argv, env = process.env) {
  const options = {
    accountUsername: env.HOSTINGER_ACCOUNT_USERNAME || "",
    domain: env.HOSTINGER_NODEJS_DOMAIN || DEFAULT_DOMAIN,
    expectedSha: env.EXPECTED_PRODUCTION_SHA || "",
    expectedBuildUuid: env.EXPECTED_HOSTINGER_BUILD_UUID || "",
    productionMergedAt: env.PRODUCTION_MERGED_AT || "",
    outputDir: env.HOSTINGER_NODEJS_RESTART_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR,
    timeoutMs: Number(env.HOSTINGER_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    pollAttempts: Number(env.HOSTINGER_RESTART_POLL_ATTEMPTS || DEFAULT_POLL_ATTEMPTS),
    pollIntervalMs: Number(env.HOSTINGER_RESTART_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
    token: env.HOSTINGER_API_TOKEN || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new RestartError("argument_value_missing", `${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--account-username") options.accountUsername = take();
    else if (arg.startsWith("--account-username=")) options.accountUsername = arg.slice(19);
    else if (arg === "--expected-sha") options.expectedSha = take();
    else if (arg.startsWith("--expected-sha=")) options.expectedSha = arg.slice(15);
    else if (arg === "--expected-build-uuid") options.expectedBuildUuid = take();
    else if (arg.startsWith("--expected-build-uuid=")) options.expectedBuildUuid = arg.slice(22);
    else if (arg === "--production-merged-at") options.productionMergedAt = take();
    else if (arg.startsWith("--production-merged-at=")) options.productionMergedAt = arg.slice(23);
    else if (arg === "--output-dir") options.outputDir = take();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else throw new RestartError("argument_unknown", `Unknown argument: ${redact(arg)}`);
  }
  return options;
}

export function validateConfiguration(options) {
  const accountUsername = String(options.accountUsername ?? "").trim();
  const domain = String(options.domain ?? "").trim().toLowerCase();
  const expectedSha = String(options.expectedSha ?? "").trim().toLowerCase();
  const expectedBuildUuid = String(options.expectedBuildUuid ?? "").trim().toLowerCase();
  const token = String(options.token ?? "").trim();
  if (!USERNAME_PATTERN.test(accountUsername)) throw new RestartError("account_username_invalid", "Hostinger account username is invalid.");
  if (domain !== DEFAULT_DOMAIN) throw new RestartError("domain_not_authorized", `Restart is restricted to ${DEFAULT_DOMAIN}.`);
  if (!SHA_PATTERN.test(expectedSha)) throw new RestartError("expected_sha_invalid", "Expected Production SHA must be a full lowercase 40-character Git SHA.");
  if (!UUID_PATTERN.test(expectedBuildUuid)) throw new RestartError("expected_build_uuid_invalid", "Expected Hostinger build UUID is invalid.");
  const merged = parseIso(options.productionMergedAt, "production_merge_time_invalid", "Production merge time");
  if (!token) throw new RestartError("hostinger_api_token_unavailable", "HOSTINGER_API_TOKEN is required for the governed restart.");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) throw new RestartError("timeout_invalid", "Timeout must be between 1000 and 60000 milliseconds.");
  if (!Number.isInteger(options.pollAttempts) || options.pollAttempts < 1 || options.pollAttempts > 30) throw new RestartError("poll_attempts_invalid", "Poll attempts must be between 1 and 30.");
  if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs < 0 || options.pollIntervalMs > 30_000) throw new RestartError("poll_interval_invalid", "Poll interval must be between 0 and 30000 milliseconds.");
  return {
    accountUsername,
    domain,
    expectedSha,
    expectedBranch: "Production",
    expectedBuildUuid,
    productionMergedAt: merged.text,
    productionMergedAtMs: merged.timestamp,
    outputDir: String(options.outputDir || DEFAULT_OUTPUT_DIR),
    timeoutMs: options.timeoutMs,
    pollAttempts: options.pollAttempts,
    pollIntervalMs: options.pollIntervalMs,
    token,
  };
}

function maskAccountUsername(value) {
  const text = String(value ?? "");
  if (text.length <= 2) return "**";
  return `${text.slice(0, 1)}${"*".repeat(Math.min(8, text.length - 2))}${text.slice(-1)}`;
}

async function readBoundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new RestartError("response_too_large", `Response exceeded ${MAX_RESPONSE_BYTES} bytes.`, response.status);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function sha256(text) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

async function request(url, { method = "GET", token = "", timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, body = undefined } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new RestartError("request_timeout", `${method} request timed out.`);
    throw new RestartError("request_transport_failed", `${method} request failed: ${redactKnownSecret(error?.message ?? error, token)}`);
  }
  const text = await readBoundedText(response);
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw_sha256: await sha256(text), raw_bytes: Buffer.byteLength(text) };
    }
  }
  if (!response.ok) {
    const message = parsed?.error?.message || parsed?.message || `${method} request returned HTTP ${response.status}.`;
    const code = response.status === 401 || response.status === 403 ? "hostinger_api_unauthorized" : response.status === 429 ? "hostinger_api_rate_limited" : "hostinger_api_http_error";
    throw new RestartError(code, redactKnownSecret(message, token, 1_000), response.status);
  }
  return { status: response.status, body: parsed, textBytes: Buffer.byteLength(text), url: String(url) };
}

function listBuildsUrl(configuration) {
  const url = new URL(`/api/hosting/v1/accounts/${encodeURIComponent(configuration.accountUsername)}/websites/${encodeURIComponent(configuration.domain)}/nodejs/builds`, HOSTINGER_API_BASE_URL);
  url.searchParams.set("page", "1");
  return url;
}

function restartUrl(configuration) {
  return new URL(`/api/hosting/v1/accounts/${encodeURIComponent(configuration.accountUsername)}/websites/${encodeURIComponent(configuration.domain)}/nodejs/server/restart`, HOSTINGER_API_BASE_URL);
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeBuildCollection(body) {
  const candidates = [body?.data, body?.data?.data, body?.builds, body?.items];
  const raw = candidates.find(Array.isArray) || [];
  return raw.map((item) => ({
    uuid: String(item?.uuid || item?.id || "").toLowerCase() || null,
    state: String(item?.state || item?.status || "unknown").toLowerCase(),
    created_at: normalizeTimestamp(item?.created_at || item?.createdAt),
    updated_at: normalizeTimestamp(item?.updated_at || item?.updatedAt),
    source_type: String(item?.options?.source_type || item?.metadata?.source_type || "").toLowerCase() || null,
    entry_file: String(item?.options?.entry_file || item?.metadata?.entry_file || "") || null,
  })).filter((item) => item.uuid);
}

function buildCreatedTimestamp(build) {
  return Date.parse(build.created_at || "") || 0;
}

function verifyBuildPrecondition(builds, configuration) {
  const afterMerge = builds
    .filter((build) => buildCreatedTimestamp(build) >= configuration.productionMergedAtMs)
    .sort((a, b) => buildCreatedTimestamp(b) - buildCreatedTimestamp(a));
  const latest = afterMerge[0] || null;
  if (!latest) throw new RestartError("no_build_after_merge", "No Hostinger Node.js build was created after the protected Production merge.");
  if (latest.uuid !== configuration.expectedBuildUuid) throw new RestartError("newer_or_different_build_detected", `Latest build created after merge is ${redact(latest.uuid, 128)}, not the authorized build.`);
  if (latest.state !== "completed") throw new RestartError("authorized_build_not_completed", `Authorized build state is ${redact(latest.state, 64)}, not completed.`);
  if (latest.source_type !== "git") throw new RestartError("authorized_build_source_not_git", "Authorized build source is missing or is not Git.");
  return { latest, builds_after_merge: afterMerge.length };
}

function collectByKey(value, matcher, depth = 0, output = []) {
  if (depth > 8 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectByKey(entry, matcher, depth + 1, output);
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    if (matcher(key, entry)) output.push(entry);
    collectByKey(entry, matcher, depth + 1, output);
  }
  return output;
}

function extractRuntimeIdentity(versionBody, deploymentBody) {
  const allBodies = [versionBody, deploymentBody];
  const shas = new Set();
  const branches = new Set();
  for (const body of allBodies) {
    for (const entry of collectByKey(body, (key, value) => /(sha|commit|revision)/iu.test(key) && typeof value === "string")) {
      const normalized = String(entry).trim().toLowerCase();
      if (SHA_PATTERN.test(normalized)) shas.add(normalized);
    }
    for (const entry of collectByKey(body, (key, value) => /branch/iu.test(key) && typeof value === "string")) {
      const normalized = String(entry).trim();
      if (normalized) branches.add(normalized);
    }
  }
  return { shas: [...shas], branches: [...branches] };
}

function summarizeEndpoint(response) {
  return { status: response.status, body_bytes: response.textBytes };
}

async function readRuntime(configuration, fetchImpl) {
  const base = `https://${configuration.domain}`;
  const [health, version, deployment] = await Promise.all([
    request(`${base}/health`, { timeoutMs: configuration.timeoutMs, fetchImpl }),
    request(`${base}/version`, { timeoutMs: configuration.timeoutMs, fetchImpl }),
    request(`${base}/deployment-info`, { timeoutMs: configuration.timeoutMs, fetchImpl }),
  ]);
  const identity = extractRuntimeIdentity(version.body, deployment.body);
  const exactSha = identity.shas.includes(configuration.expectedSha);
  const exactBranch = identity.branches.some((branch) => branch === configuration.expectedBranch);
  return {
    current: exactSha && exactBranch,
    exact_sha: exactSha,
    exact_branch: exactBranch,
    observed_shas: identity.shas,
    observed_branches: identity.branches,
    endpoints: {
      health: summarizeEndpoint(health),
      version: summarizeEndpoint(version),
      deployment_info: summarizeEndpoint(deployment),
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseReport(configuration, generatedAt) {
  return {
    contract: HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
    generated_at: generatedAt,
    identity: {
      expected_sha: configuration.expectedSha,
      expected_branch: configuration.expectedBranch,
      expected_build_uuid: configuration.expectedBuildUuid,
      production_merged_at: configuration.productionMergedAt,
      domain: configuration.domain,
      account_username_masked: maskAccountUsername(configuration.accountUsername),
      api_base_url: HOSTINGER_API_BASE_URL,
    },
    authorization: {
      operation: "restart_existing_nodejs_server",
      provider_method: "POST",
      provider_path: `/api/hosting/v1/accounts/{username}/websites/${configuration.domain}/nodejs/server/restart`,
      creates_build: false,
      deploys_archive: false,
      changes_branch_binding: false,
      token_returned: false,
    },
    outcome: "failed",
    classification: "restart_not_attempted",
    precondition: null,
    pre_runtime: null,
    restart: { requested: false, performed: false, response_status: null },
    post_runtime: null,
    poll_attempts_used: 0,
    first_failure: null,
    side_effects: {
      repository_mutation_performed: false,
      protected_ref_mutation_performed: false,
      provider_mutation_performed: false,
      restart_performed: false,
      build_creation_performed: false,
      deployment_performed: false,
      sql_execution_performed: false,
      migration_apply_performed: false,
      database_mutation_performed: false,
      external_send_performed: false,
    },
    secrets_included: false,
  };
}

export async function executeGovernedRestart(options, dependencies = {}) {
  const configuration = validateConfiguration(options);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => new Date());
  const sleepImpl = dependencies.sleepImpl || sleep;
  const report = baseReport(configuration, now().toISOString());
  try {
    const buildsResponse = await request(listBuildsUrl(configuration), { token: configuration.token, timeoutMs: configuration.timeoutMs, fetchImpl });
    const builds = normalizeBuildCollection(buildsResponse.body);
    const verified = verifyBuildPrecondition(builds, configuration);
    report.precondition = {
      authorized_build: verified.latest,
      builds_after_merge: verified.builds_after_merge,
      list_status: buildsResponse.status,
    };

    report.pre_runtime = await readRuntime(configuration, fetchImpl);
    if (report.pre_runtime.current) {
      report.outcome = "passed";
      report.classification = "runtime_already_current";
      return report;
    }

    report.restart.requested = true;
    const restartResponse = await request(restartUrl(configuration), {
      method: "POST",
      token: configuration.token,
      timeoutMs: configuration.timeoutMs,
      fetchImpl,
      body: "{}",
    });
    report.restart.performed = true;
    report.restart.response_status = restartResponse.status;
    report.side_effects.provider_mutation_performed = true;
    report.side_effects.restart_performed = true;

    for (let attempt = 1; attempt <= configuration.pollAttempts; attempt += 1) {
      if (attempt > 1 || configuration.pollIntervalMs > 0) await sleepImpl(configuration.pollIntervalMs);
      report.poll_attempts_used = attempt;
      try {
        report.post_runtime = await readRuntime(configuration, fetchImpl);
      } catch (error) {
        report.post_runtime = { current: false, read_failure: safeFailure(error, "post_restart_runtime_read_failed") };
      }
      if (report.post_runtime.current) {
        report.outcome = "passed";
        report.classification = "restart_completed_runtime_current";
        return report;
      }
    }

    report.outcome = "failed";
    report.classification = "restart_completed_runtime_stale";
    report.first_failure = {
      code: "runtime_parity_not_reached_after_restart",
      message: "Hostinger accepted the Node.js restart, but the public runtime did not converge to the authorized Production identity.",
      http_status: 0,
    };
    return report;
  } catch (error) {
    report.first_failure = safeFailure(error);
    report.classification = report.restart.performed ? "restart_or_postcheck_failed" : "restart_precondition_failed";
    return report;
  }
}

function renderMarkdown(report) {
  const lines = [
    "# Hostinger Production Node.js Restart Evidence",
    "",
    `- Contract: \`${report.contract}\``,
    `- Generated at: \`${report.generated_at}\``,
    `- Expected Production SHA: \`${report.identity.expected_sha}\``,
    `- Expected build UUID: \`${report.identity.expected_build_uuid}\``,
    `- Outcome: **${report.outcome}**`,
    `- Classification: \`${report.classification}\``,
    `- Restart performed: **${report.restart.performed ? "yes" : "no"}**`,
    `- Provider mutation performed: **${report.side_effects.provider_mutation_performed ? "yes" : "no"}**`,
    `- Secrets included: \`${report.secrets_included}\``,
    "",
    "## Runtime",
    "",
    `- Pre-restart current: **${report.pre_runtime?.current ? "yes" : "no"}**`,
    `- Post-restart current: **${report.post_runtime?.current ? "yes" : "no"}**`,
  ];
  if (report.first_failure) {
    lines.push("", "## First failure", "", `- Code: \`${report.first_failure.code}\``, `- Message: ${redact(report.first_failure.message, 1_000)}`);
  }
  lines.push("", "## Safety boundary", "", "This operation restarts only the existing Hostinger Node.js server process. It does not create a build, upload an archive, redeploy, change the Git branch binding, mutate Git refs, run SQL, or apply migrations.", "");
  return lines.join("\n");
}

export function writeReport(report, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "hostinger-nodejs-production-restart.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(outputDir, "hostinger-nodejs-production-restart.md"), renderMarkdown(report), { mode: 0o600 });
}

async function main() {
  let report;
  let outputDir = process.env.HOSTINGER_NODEJS_RESTART_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR;
  try {
    const options = parseArgs(process.argv.slice(2));
    outputDir = options.outputDir;
    report = await executeGovernedRestart(options);
  } catch (error) {
    report = {
      contract: HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
      generated_at: new Date().toISOString(),
      outcome: "failed",
      classification: "restart_configuration_failed",
      first_failure: safeFailure(error),
      restart: { requested: false, performed: false, response_status: null },
      side_effects: {
        repository_mutation_performed: false,
        protected_ref_mutation_performed: false,
        provider_mutation_performed: false,
        restart_performed: false,
        build_creation_performed: false,
        deployment_performed: false,
        sql_execution_performed: false,
        migration_apply_performed: false,
        database_mutation_performed: false,
        external_send_performed: false,
      },
      secrets_included: false,
    };
  }
  writeReport(report, outputDir);
  console.log(JSON.stringify({
    outcome: report.outcome,
    classification: report.classification,
    restart_performed: report.restart?.performed === true,
    secrets_included: false,
  }));
  if (report.outcome !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
