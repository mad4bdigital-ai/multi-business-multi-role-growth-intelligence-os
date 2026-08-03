#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONTRACT = "mad4b.hostinger-completed-build-forensics.v1";
export const HOSTINGER_API_BASE_URL = "https://developers.hostinger.com";
const AUTH_DOMAIN = "auth.mad4b.com";
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "hostinger-completed-build-forensics");
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_LOG_CHARS = 24_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const UUID_PATTERN = /^[0-9a-f-]{36}$/u;

class ForensicsError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "ForensicsError";
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
    .replace(/\b(authorization|access[_-]?token|refresh[_-]?token|api[_-]?token|api[_-]?key|password|cookie|secret|private[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu, "$1$2[REDACTED]")
    .slice(0, maxLength);
}

function scrubKnownSecret(value, secret, maxLength = 4_000) {
  const text = String(value ?? "");
  return redact(secret ? text.split(String(secret)).join("[REDACTED]") : text, maxLength);
}

function parseIso(value, code, label) {
  const text = String(value ?? "").trim();
  const timestamp = Date.parse(text);
  if (!text || Number.isNaN(timestamp)) throw new ForensicsError(code, `${label} must be an ISO-8601 timestamp.`);
  return { text: new Date(timestamp).toISOString(), timestamp };
}

export function parseArgs(argv, env = process.env) {
  const options = {
    accountUsername: env.HOSTINGER_ACCOUNT_USERNAME || "",
    domain: env.HOSTINGER_NODEJS_DOMAIN || AUTH_DOMAIN,
    buildUuid: env.HOSTINGER_BUILD_UUID || "",
    expectedSha: env.EXPECTED_PRODUCTION_SHA || "",
    productionMergedAt: env.PRODUCTION_MERGED_AT || "",
    token: env.HOSTINGER_API_TOKEN || "",
    outputDir: env.HOSTINGER_COMPLETED_BUILD_FORENSICS_DIR || DEFAULT_OUTPUT_DIR,
    timeoutMs: Number(env.HOSTINGER_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ForensicsError("argument_value_missing", `${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--account-username") options.accountUsername = take();
    else if (arg.startsWith("--account-username=")) options.accountUsername = arg.slice(19);
    else if (arg === "--domain") options.domain = take();
    else if (arg.startsWith("--domain=")) options.domain = arg.slice(9);
    else if (arg === "--build-uuid") options.buildUuid = take();
    else if (arg.startsWith("--build-uuid=")) options.buildUuid = arg.slice(13);
    else if (arg === "--expected-sha") options.expectedSha = take();
    else if (arg.startsWith("--expected-sha=")) options.expectedSha = arg.slice(15);
    else if (arg === "--production-merged-at") options.productionMergedAt = take();
    else if (arg.startsWith("--production-merged-at=")) options.productionMergedAt = arg.slice(23);
    else if (arg === "--output-dir") options.outputDir = take();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(take());
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice(13));
    else throw new ForensicsError("argument_unknown", `Unknown argument: ${redact(arg)}`);
  }
  return options;
}

export function validateConfiguration(options) {
  const accountUsername = String(options.accountUsername ?? "").trim();
  const domain = String(options.domain ?? "").trim().toLowerCase();
  const buildUuid = String(options.buildUuid ?? "").trim().toLowerCase();
  const expectedSha = String(options.expectedSha ?? "").trim().toLowerCase();
  const token = String(options.token ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(accountUsername)) throw new ForensicsError("account_username_invalid", "Hostinger account username is invalid.");
  if (domain !== AUTH_DOMAIN) throw new ForensicsError("domain_not_authorized", `Forensics is restricted to ${AUTH_DOMAIN}.`);
  if (!UUID_PATTERN.test(buildUuid)) throw new ForensicsError("build_uuid_invalid", "Build UUID must be a canonical lowercase UUID.");
  if (!SHA_PATTERN.test(expectedSha)) throw new ForensicsError("expected_sha_invalid", "Expected Production SHA must be a full lowercase Git SHA.");
  if (!token) throw new ForensicsError("hostinger_api_token_unavailable", "HOSTINGER_API_TOKEN is required.");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) throw new ForensicsError("timeout_invalid", "Timeout must be between 1000 and 60000 milliseconds.");
  const merged = parseIso(options.productionMergedAt, "production_merge_time_invalid", "Production merge time");
  return {
    accountUsername,
    domain,
    buildUuid,
    expectedSha,
    expectedBranch: "Production",
    productionMergedAt: merged.text,
    productionMergedAtMs: merged.timestamp,
    token,
    outputDir: String(options.outputDir || DEFAULT_OUTPUT_DIR),
    timeoutMs: options.timeoutMs,
  };
}

function endpoint(configuration, suffix) {
  const username = encodeURIComponent(configuration.accountUsername);
  const domain = encodeURIComponent(configuration.domain);
  return new URL(`/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/${suffix}`, HOSTINGER_API_BASE_URL);
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
      if (total > MAX_RESPONSE_BYTES) throw new ForensicsError("response_too_large", `Response exceeded ${MAX_RESPONSE_BYTES} bytes.`, response.status);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function requestJson(url, configuration, fetchImpl, authenticated = true) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: authenticated
        ? { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${configuration.token}` }
        : { accept: "application/json" },
      signal: AbortSignal.timeout(configuration.timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    throw new ForensicsError("request_transport_failed", scrubKnownSecret(error?.message ?? error, configuration.token));
  }
  const text = await readBoundedText(response);
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: redact(text, 2_000) };
    }
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `HTTP ${response.status}`;
    throw new ForensicsError(authenticated ? "hostinger_api_http_error" : "public_runtime_http_error", scrubKnownSecret(message, configuration.token, 1_000), response.status);
  }
  return { status: response.status, body, text };
}

function arrayFromBuildResponse(body) {
  for (const candidate of [body?.data, body?.data?.data, body?.builds, body?.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function findStringSignals(value, depth = 0, key = "") {
  const signals = { shas: new Set(), branches: new Set(), releaseDirs: new Set(), text: [] };
  if (depth > 6 || value === null || value === undefined) return signals;
  const merge = (other) => {
    for (const sha of other.shas) signals.shas.add(sha);
    for (const branch of other.branches) signals.branches.add(branch);
    for (const directory of other.releaseDirs) signals.releaseDirs.add(directory);
    signals.text.push(...other.text);
  };
  if (typeof value === "string") {
    const text = redact(value, MAX_LOG_CHARS);
    signals.text.push(text);
    for (const match of text.toLowerCase().matchAll(/\b[0-9a-f]{40}\b/gu)) {
      if (/(sha|commit|revision|source|checkout|deploy|build)/iu.test(key) || text.length < 1_000) signals.shas.add(match[0]);
    }
    for (const match of text.matchAll(/(?:branch|ref|source[_ -]?branch)\s*[:=]\s*["']?([A-Za-z0-9._/-]+)/giu)) signals.branches.add(match[1]);
    for (const match of text.matchAll(/\.builds\/versions\/[A-Za-z0-9._-]+/gu)) signals.releaseDirs.add(match[0]);
    return signals;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) merge(findStringSignals(entry, depth + 1, key));
    return signals;
  }
  if (typeof value === "object") {
    for (const [childKey, entry] of Object.entries(value).slice(0, 100)) merge(findStringSignals(entry, depth + 1, childKey));
  }
  return signals;
}

export function analyzeBuildLogs(logText, structuredBuild = {}) {
  const combined = `${redact(logText, MAX_LOG_CHARS)}\n${JSON.stringify(structuredBuild)}`;
  const signals = findStringSignals(combined);
  const lower = combined.toLowerCase();
  return {
    source_shas: [...signals.shas].sort(),
    source_branches: [...signals.branches].sort(),
    release_directories: [...signals.releaseDirs].sort(),
    deploy_completed_hint: /(deploy(?:ment|ed)?[^\n]{0,80}(complete|success|finished)|release[^\n]{0,80}(active|activated|promoted))/iu.test(combined),
    restart_hint: /(restart(?:ed|ing)?|process[^\n]{0,80}(start|reload)|pm2[^\n]{0,80}restart)/iu.test(combined),
    failure_hint: /(^|\n).{0,80}(error|fatal|failed|crash|exception).{0,160}($|\n)/iu.test(combined),
    production_branch_hint: /\bproduction\b/iu.test(combined),
    excerpt: redact(logText, MAX_LOG_CHARS),
    excerpt_sha256: createHash("sha256").update(redact(logText, MAX_LOG_CHARS)).digest("hex"),
    empty: lower.trim().length === 0,
  };
}

function extractRuntimeIdentity(body) {
  const signals = findStringSignals(body);
  const possibleShaKeys = [
    body?.buildSha,
    body?.build_sha,
    body?.commit_sha,
    body?.deploymentSha,
    body?.deployment_sha,
    body?.deployment?.deployed_commit_sha,
    body?.deployment?.commit_sha,
    body?.manifest?.commit_sha,
    body?.deployment?.manifest?.commit_sha,
  ];
  const explicitSha = possibleShaKeys.map((value) => String(value ?? "").trim().toLowerCase()).find((value) => SHA_PATTERN.test(value));
  const possibleBranches = [body?.branch, body?.deployment?.branch, body?.manifest?.branch, body?.deployment?.manifest?.branch];
  const explicitBranch = possibleBranches.map((value) => String(value ?? "").trim()).find(Boolean);
  return {
    sha: explicitSha || [...signals.shas][0] || null,
    branch: explicitBranch || [...signals.branches][0] || null,
    release_directories: [...signals.releaseDirs].sort(),
  };
}

export function classifyForensics({ configuration, build, logAnalysis, runtime }) {
  const runtimeCurrent = runtime.version.identity.sha === configuration.expectedSha
    && String(runtime.deploymentInfo.identity.branch || "").toLowerCase() === "production";
  if (runtimeCurrent) return { outcome: "passed", classification: "production_runtime_current", next_action: "close_incident_after_admin_tenant_readback" };

  const buildSourceExact = logAnalysis.source_shas.includes(configuration.expectedSha);
  const branchExact = logAnalysis.source_branches.some((branch) => branch.toLowerCase() === "production") || logAnalysis.production_branch_hint;
  const runtimeStale = Boolean(runtime.version.identity.sha && runtime.version.identity.sha !== configuration.expectedSha);

  if (buildSourceExact && branchExact && runtimeStale && logAnalysis.deploy_completed_hint) {
    return { outcome: "blocked", classification: "completed_expected_build_not_active_restart_or_slot_promotion_required", next_action: "verify_active_slot_then_restart_existing_nodejs_server_if_slot_is_current" };
  }
  if (buildSourceExact && runtimeStale) {
    return { outcome: "blocked", classification: "completed_expected_source_runtime_stale_activation_unproven", next_action: "inspect_hpanel_active_release_and_build_logs_before_restart" };
  }
  if (logAnalysis.failure_hint) {
    return { outcome: "blocked", classification: "completed_build_logs_contain_failure_signal", next_action: "inspect_full_hpanel_build_and_startup_logs" };
  }
  return { outcome: "partial", classification: "completed_build_source_or_activation_unverified", next_action: "inspect_hpanel_build_source_and_active_release_slot" };
}

export async function collectForensics(options, dependencies = {}) {
  const configuration = validateConfiguration(options);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => new Date());

  const buildsUrl = endpoint(configuration, "builds");
  buildsUrl.searchParams.set("page", "1");
  const buildList = await requestJson(buildsUrl, configuration, fetchImpl, true);
  const rawBuild = arrayFromBuildResponse(buildList.body).find((entry) => String(entry?.uuid || entry?.id || "").toLowerCase() === configuration.buildUuid);
  if (!rawBuild) throw new ForensicsError("target_build_not_found", `Build ${configuration.buildUuid} was not found on page one.`);
  const build = {
    uuid: configuration.buildUuid,
    state: String(rawBuild.state || rawBuild.status || "unknown").toLowerCase(),
    created_at: normalizeTimestamp(rawBuild.created_at || rawBuild.createdAt),
    updated_at: normalizeTimestamp(rawBuild.updated_at || rawBuild.updatedAt),
    options: JSON.parse(redact(JSON.stringify(rawBuild.options ?? rawBuild.metadata ?? {}), 12_000)),
  };
  if (build.state !== "completed") throw new ForensicsError("target_build_not_completed", `Target build state is ${build.state}.`);
  if ((Date.parse(build.created_at || "") || 0) < configuration.productionMergedAtMs) throw new ForensicsError("target_build_predates_production_merge", "Target build predates the protected Production merge.");

  const logsUrl = endpoint(configuration, `builds/${encodeURIComponent(configuration.buildUuid)}/logs`);
  logsUrl.searchParams.set("from_line", "0");
  const logsResponse = await requestJson(logsUrl, configuration, fetchImpl, true);
  const rawLogs = logsResponse.body?.logs ?? logsResponse.body?.data?.logs ?? logsResponse.body?.data ?? logsResponse.body?.message ?? logsResponse.text;
  const logText = Array.isArray(rawLogs) ? rawLogs.join("\n") : typeof rawLogs === "object" ? JSON.stringify(rawLogs) : String(rawLogs ?? "");
  const logAnalysis = analyzeBuildLogs(logText, rawBuild);

  const publicRoute = async (route) => {
    try {
      const response = await requestJson(new URL(route, `https://${configuration.domain}`), configuration, fetchImpl, false);
      return { ok: true, http_status: response.status, body: response.body, identity: extractRuntimeIdentity(response.body) };
    } catch (error) {
      return { ok: false, http_status: Number(error?.status || 0), error: { code: error?.code || "public_runtime_error", message: redact(error?.message || error, 1_000) }, body: null, identity: { sha: null, branch: null, release_directories: [] } };
    }
  };

  const runtime = {
    health: await publicRoute("/health"),
    version: await publicRoute("/version"),
    deploymentInfo: await publicRoute("/deployment-info"),
    connectorAgentVersion: await publicRoute("/connector-agent/version"),
  };
  const decision = classifyForensics({ configuration, build, logAnalysis, runtime });

  return {
    contract: CONTRACT,
    generated_at: now().toISOString(),
    identity: {
      domain: configuration.domain,
      expected_branch: configuration.expectedBranch,
      expected_sha: configuration.expectedSha,
      production_merged_at: configuration.productionMergedAt,
      build_uuid: configuration.buildUuid,
    },
    requests: {
      methods: ["GET"],
      hostinger_build_list: buildsUrl.toString(),
      hostinger_build_logs: logsUrl.toString(),
      token_returned: false,
    },
    build,
    log_analysis: logAnalysis,
    runtime,
    decision,
    side_effects: {
      provider_mutation_performed: false,
      build_created: false,
      deployment_performed: false,
      active_slot_changed: false,
      restart_performed: false,
      repository_mutation_performed: false,
      sql_execution_performed: false,
      migration_apply_performed: false,
      database_mutation_performed: false,
      external_send_performed: false,
    },
    secrets_included: false,
  };
}

function markdown(report) {
  const observedSha = report.runtime.version.identity.sha || "unavailable";
  const observedBranch = report.runtime.deploymentInfo.identity.branch || report.runtime.version.identity.branch || "unavailable";
  return [
    "# Hostinger completed build forensics",
    "",
    `- outcome: \`${report.decision.outcome}\``,
    `- classification: \`${report.decision.classification}\``,
    `- next action: \`${report.decision.next_action}\``,
    `- build UUID: \`${report.identity.build_uuid}\``,
    `- build state: \`${report.build.state}\``,
    `- expected SHA: \`${report.identity.expected_sha}\``,
    `- log source SHAs: \`${report.log_analysis.source_shas.join(",") || "none"}\``,
    `- log source branches: \`${report.log_analysis.source_branches.join(",") || "none"}\``,
    `- release directories: \`${report.log_analysis.release_directories.join(",") || "none"}\``,
    `- observed runtime SHA: \`${observedSha}\``,
    `- observed runtime branch: \`${observedBranch}\``,
    "- provider mutation: `false`",
    "- restart: `false`",
    "- secrets included: `false`",
    "",
  ].join("\n");
}

export async function writeReport(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "hostinger-completed-build-forensics.json");
  const markdownPath = path.join(outputDir, "hostinger-completed-build-forensics.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, markdown(report), "utf8");
  return { jsonPath, markdownPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const report = await collectForensics(options);
    const paths = await writeReport(report, options.outputDir || DEFAULT_OUTPUT_DIR);
    console.log(JSON.stringify({ ok: true, contract: report.contract, decision: report.decision, paths, secrets_included: false }));
  } catch (error) {
    const failure = {
      contract: CONTRACT,
      generated_at: new Date().toISOString(),
      ok: false,
      failure: { code: error?.code || "forensics_failed", message: scrubKnownSecret(error?.message || error, options.token, 1_000), http_status: Number(error?.status || 0) },
      side_effects: { provider_mutation_performed: false, build_created: false, deployment_performed: false, active_slot_changed: false, restart_performed: false, repository_mutation_performed: false, sql_execution_performed: false, migration_apply_performed: false, database_mutation_performed: false, external_send_performed: false },
      secrets_included: false,
    };
    await writeReport(failure, options.outputDir || DEFAULT_OUTPUT_DIR);
    console.error(JSON.stringify({ ok: false, failure: failure.failure, secrets_included: false }));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
