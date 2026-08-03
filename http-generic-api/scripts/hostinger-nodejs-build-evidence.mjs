#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const HOSTINGER_NODEJS_BUILD_EVIDENCE_CONTRACT = "mad4b.hostinger-nodejs-build-evidence.v1";
export const HOSTINGER_API_BASE_URL = "https://developers.hostinger.com";
const DEFAULT_DOMAIN = "auth.mad4b.com";
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "hostinger-nodejs-build-evidence");
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_LOG_CHARS = 12_000;
const MAX_SIGNAL_LINES = 30;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHA_GLOBAL_PATTERN = /\b[0-9a-f]{40}\b/giu;
const REVISION_GLOBAL_PATTERN = /\b[0-9a-f]{7,40}\b/giu;
const SOURCE_CONTEXT_PATTERN = /\b(branch|checkout|clone|commit|git|head|ref|repository|revision|sha|source)\b/iu;
const ACTIVATION_CONTEXT_PATTERN = /\b(activat|deploy|promot|release|restart|route|slot|start|switch)\w*\b/iu;
const ERROR_CONTEXT_PATTERN = /\b(crash|error|exception|fail|fatal|panic)\w*\b/iu;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const BUILD_STATES = new Set(["pending", "running", "completed", "failed"]);

class EvidenceError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "EvidenceError";
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

function safeFailure(error, fallbackCode = "hostinger_api_error") {
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
  if (!text || Number.isNaN(timestamp)) {
    throw new EvidenceError(code, `${label} must be an ISO-8601 timestamp.`);
  }
  return { text: new Date(timestamp).toISOString(), timestamp };
}

export function parseArgs(argv, env = process.env) {
  const options = {
    accountUsername: env.HOSTINGER_ACCOUNT_USERNAME || "",
    domain: env.HOSTINGER_NODEJS_DOMAIN || DEFAULT_DOMAIN,
    expectedSha: env.EXPECTED_PRODUCTION_SHA || "",
    productionMergedAt: env.PRODUCTION_MERGED_AT || "",
    outputDir: env.HOSTINGER_NODEJS_BUILD_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR,
    timeoutMs: Number(env.HOSTINGER_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    token: env.HOSTINGER_API_TOKEN || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new EvidenceError("argument_value_missing", `${arg} requires a value.`);
      }
      index += 1;
      return value;
    };
    if (arg === "--account-username") options.accountUsername = take();
    else if (arg.startsWith("--account-username=")) options.accountUsername = arg.slice(19);
    else if (arg === "--domain") options.domain = take();
    else if (arg.startsWith("--domain=")) options.domain = arg.slice(9);
    else if (arg === "--expected-sha") options.expectedSha = take();
    else if (arg.startsWith("--expected-sha=")) options.expectedSha = arg.slice(15);
    else if (arg === "--production-merged-at") options.productionMergedAt = take();
    else if (arg.startsWith("--production-merged-at=")) options.productionMergedAt = arg.slice(23);
    else if (arg === "--output-dir") options.outputDir = take();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(take());
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice(13));
    else throw new EvidenceError("argument_unknown", `Unknown argument: ${redact(arg)}`);
  }
  return options;
}

export function validateConfiguration(options) {
  const accountUsername = String(options.accountUsername ?? "").trim();
  const domain = String(options.domain ?? "").trim().toLowerCase();
  const expectedSha = String(options.expectedSha ?? "").trim().toLowerCase();
  const token = String(options.token ?? "").trim();
  if (!USERNAME_PATTERN.test(accountUsername)) {
    throw new EvidenceError(
      "account_username_invalid",
      "Hostinger account username is required and may contain letters, numbers, dot, underscore, or dash.",
    );
  }
  if (domain !== DEFAULT_DOMAIN) {
    throw new EvidenceError("domain_not_authorized", `Live build evidence is restricted to ${DEFAULT_DOMAIN}.`);
  }
  if (!SHA_PATTERN.test(expectedSha)) {
    throw new EvidenceError(
      "expected_sha_invalid",
      "Expected Production SHA must be a full lowercase 40-character Git SHA.",
    );
  }
  const merged = parseIso(
    options.productionMergedAt,
    "production_merge_time_invalid",
    "Production merge time",
  );
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) {
    throw new EvidenceError("timeout_invalid", "Timeout must be an integer between 1000 and 60000 milliseconds.");
  }
  return {
    accountUsername,
    domain,
    expectedSha,
    expectedBranch: "Production",
    productionMergedAt: merged.text,
    productionMergedAtMs: merged.timestamp,
    outputDir: String(options.outputDir || DEFAULT_OUTPUT_DIR),
    timeoutMs: options.timeoutMs,
    token,
  };
}

export function maskAccountUsername(value) {
  const text = String(value ?? "");
  if (text.length <= 2) return "**";
  return `${text.slice(0, 1)}${"*".repeat(Math.min(8, text.length - 2))}${text.slice(-1)}`;
}

function buildListUrl(configuration) {
  const username = encodeURIComponent(configuration.accountUsername);
  const domain = encodeURIComponent(configuration.domain);
  const url = new URL(
    `/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/builds`,
    HOSTINGER_API_BASE_URL,
  );
  url.searchParams.set("page", "1");
  return url;
}

function buildLogsUrl(configuration, uuid) {
  const username = encodeURIComponent(configuration.accountUsername);
  const domain = encodeURIComponent(configuration.domain);
  const buildUuid = encodeURIComponent(uuid);
  const url = new URL(
    `/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/builds/${buildUuid}/logs`,
    HOSTINGER_API_BASE_URL,
  );
  url.searchParams.set("from_line", "0");
  return url;
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
      if (total > MAX_RESPONSE_BYTES) {
        throw new EvidenceError(
          "hostinger_api_response_too_large",
          `Hostinger API response exceeded ${MAX_RESPONSE_BYTES} bytes.`,
          response.status,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function requestJson(url, configuration, fetchImpl) {
  if (!configuration.token) {
    throw new EvidenceError(
      "hostinger_api_token_unavailable",
      "HOSTINGER_API_TOKEN is required for live Hostinger build inspection.",
    );
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${configuration.token}`,
      },
      signal: AbortSignal.timeout(configuration.timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new EvidenceError("hostinger_api_timeout", "Hostinger API request timed out.");
    }
    throw new EvidenceError(
      "hostinger_api_transport_failed",
      `Hostinger API request failed: ${redactKnownSecret(error?.message ?? error, configuration.token)}`,
    );
  }

  const text = await readBoundedText(response);
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new EvidenceError(
        "hostinger_api_invalid_json",
        `Hostinger API returned non-JSON content with HTTP ${response.status}.`,
        response.status,
      );
    }
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "hostinger_api_unauthorized"
      : response.status === 429
        ? "hostinger_api_rate_limited"
        : "hostinger_api_http_error";
    const message = body?.error?.message || body?.message || `Hostinger API returned HTTP ${response.status}.`;
    throw new EvidenceError(code, redactKnownSecret(message, configuration.token, 1_000), response.status);
  }
  return { status: response.status, body };
}

function normalizeBuildCollection(body) {
  const candidates = [body?.data, body?.data?.data, body?.builds, body?.items];
  const raw = candidates.find(Array.isArray) || [];
  return raw.map((item) => normalizeBuild(item)).filter(Boolean);
}

function normalizeBuild(item) {
  if (!item || typeof item !== "object") return null;
  const uuid = redact(item.uuid || item.id || "", 128);
  const stateRaw = String(item.state || item.status || "unknown").trim().toLowerCase();
  const state = BUILD_STATES.has(stateRaw) ? stateRaw : "unknown";
  const createdAt = normalizeOptionalTimestamp(item.created_at || item.createdAt);
  const updatedAt = normalizeOptionalTimestamp(item.updated_at || item.updatedAt);
  const rawOptions = item.options ?? item.metadata ?? null;
  return {
    uuid: uuid || null,
    state,
    created_at: createdAt,
    updated_at: updatedAt,
    options: sanitizeStructured(rawOptions, 0),
    source_shas: [...findStructuredSourceShas(rawOptions)],
  };
}

function normalizeOptionalTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function sanitizeStructured(value, depth) {
  if (depth > 4) return "[TRUNCATED_DEPTH]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redact(value, 1_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeStructured(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 40)) {
      if (/(authorization|token|secret|password|cookie|private[_-]?key|credential)/iu.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[redact(key, 128)] = sanitizeStructured(entry, depth + 1);
      }
    }
    return output;
  }
  return redact(value, 1_000);
}

function findStructuredSourceShas(value, depth = 0, keyHint = "") {
  const found = new Set();
  if (depth > 5 || value === null || value === undefined) return found;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (SHA_PATTERN.test(normalized) && /(sha|commit|revision|source)/iu.test(keyHint)) {
      found.add(normalized);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      for (const sha of findStructuredSourceShas(entry, depth + 1, keyHint)) found.add(sha);
    }
    return found;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      for (const sha of findStructuredSourceShas(entry, depth + 1, key)) found.add(sha);
    }
  }
  return found;
}

function buildTimestamp(build) {
  return Math.max(Date.parse(build.created_at || "") || 0, Date.parse(build.updated_at || "") || 0);
}

function sortBuilds(builds) {
  return [...builds].sort((a, b) => buildTimestamp(b) - buildTimestamp(a));
}

function classifyBuild(build, configuration) {
  if (!build) {
    return {
      outcome: "failed",
      classification: "no_build_after_merge",
      failure: {
        code: "no_build_after_merge",
        message: "No Hostinger Node.js build was created after the protected Production merge.",
      },
    };
  }
  const exactSha = build.source_shas.includes(configuration.expectedSha);
  const otherSha = build.source_shas.length > 0 && !exactSha;
  if (build.state === "pending") return { outcome: "pending", classification: "build_pending", failure: null };
  if (build.state === "running") return { outcome: "pending", classification: "build_running", failure: null };
  if (build.state === "failed") {
    return {
      outcome: "failed",
      classification: "build_failed",
      failure: {
        code: "hostinger_build_failed",
        message: "The newest Hostinger Node.js build after the Production merge failed.",
      },
    };
  }
  if (build.state === "completed" && exactSha) {
    return { outcome: "passed", classification: "build_completed_expected_sha", failure: null };
  }
  if (build.state === "completed" && otherSha) {
    return {
      outcome: "failed",
      classification: "build_completed_other_sha",
      failure: {
        code: "hostinger_build_source_sha_mismatch",
        message: "The completed Hostinger build identifies a different source SHA.",
      },
    };
  }
  if (build.state === "completed") {
    return { outcome: "partial", classification: "build_completed_source_unverified", failure: null };
  }
  return { outcome: "partial", classification: "build_state_unknown", failure: null };
}

function logsToText(body) {
  const raw = body?.logs ?? body?.data?.logs ?? body?.data ?? body?.message ?? "";
  if (Array.isArray(raw)) {
    return raw.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n");
  }
  return typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? "");
}

function unique(values, limit = 100) {
  return [...new Set(values)].slice(0, limit);
}

function normalizeLogs(body, secret) {
  const rawText = logsToText(body);
  const safeText = redactKnownSecret(rawText, secret, MAX_LOG_CHARS);
  const rawLines = rawText.split(/\r?\n/u);
  const safeLines = safeText.split(/\r?\n/u);

  const sourceShas = [];
  const sourceRevisionCandidates = [];
  const activationSignals = [];
  const errorSignals = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const safeLine = redactKnownSecret(safeLines[index] ?? rawLine, secret, 1_000).trim();
    if (!safeLine) continue;

    if (SOURCE_CONTEXT_PATTERN.test(rawLine)) {
      for (const sha of rawLine.match(SHA_GLOBAL_PATTERN) || []) sourceShas.push(sha.toLowerCase());
      for (const revision of rawLine.match(REVISION_GLOBAL_PATTERN) || []) {
        sourceRevisionCandidates.push(revision.toLowerCase());
      }
    }
    if (ACTIVATION_CONTEXT_PATTERN.test(rawLine) && activationSignals.length < MAX_SIGNAL_LINES) {
      activationSignals.push(safeLine.slice(0, 500));
    }
    if (ERROR_CONTEXT_PATTERN.test(rawLine) && errorSignals.length < MAX_SIGNAL_LINES) {
      errorSignals.push(safeLine.slice(0, 500));
    }
  }

  return {
    excerpt: safeText || null,
    returned_lines: Number(body?.lines ?? body?.data?.lines ?? rawLines.length) || null,
    truncated: rawText.length > MAX_LOG_CHARS,
    source_shas: unique(sourceShas),
    source_revision_candidates: unique(sourceRevisionCandidates),
    activation_signals: unique(activationSignals, MAX_SIGNAL_LINES),
    error_signals: unique(errorSignals, MAX_SIGNAL_LINES),
  };
}

function applyLogProvenanceDecision(report, configuration) {
  const build = report.latest_build_after_merge;
  const logs = report.build_logs;
  if (!build || build.state !== "completed" || !logs || logs.unavailable) return;

  const structuredExact = build.source_shas.includes(configuration.expectedSha);
  const structuredOther = build.source_shas.length > 0 && !structuredExact;
  const logExactFull = logs.source_shas.includes(configuration.expectedSha);
  const logExactPrefix = logs.source_revision_candidates.some(
    (candidate) => candidate.length >= 7 && configuration.expectedSha.startsWith(candidate),
  );
  const logOtherFull = logs.source_shas.filter((sha) => sha !== configuration.expectedSha);

  if ((structuredOther && (logExactFull || logExactPrefix)) || (structuredExact && logOtherFull.length > 0)) {
    report.outcome = "failed";
    report.classification = "build_source_provenance_conflict";
    report.first_failure = {
      code: "hostinger_build_source_provenance_conflict",
      message: "Hostinger build metadata and redacted source-context logs expose conflicting source revisions.",
    };
    return;
  }
  if (structuredExact) return;
  if (structuredOther) return;

  if (logExactFull || logExactPrefix) {
    report.outcome = "passed";
    report.classification = "build_completed_expected_revision_from_logs";
    report.first_failure = null;
    return;
  }
  if (logOtherFull.length > 0) {
    report.outcome = "failed";
    report.classification = "build_completed_other_sha_from_logs";
    report.first_failure = {
      code: "hostinger_build_source_sha_mismatch",
      message: "The completed Hostinger build logs identify a different full source SHA.",
    };
  }
}

export async function collectHostingerNodejsBuildEvidence(options, dependencies = {}) {
  const configuration = validateConfiguration(options);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => new Date());
  const report = {
    contract: HOSTINGER_NODEJS_BUILD_EVIDENCE_CONTRACT,
    generated_at: now().toISOString(),
    identity: {
      expected_sha: configuration.expectedSha,
      expected_branch: configuration.expectedBranch,
      production_merged_at: configuration.productionMergedAt,
      domain: configuration.domain,
      account_username_masked: maskAccountUsername(configuration.accountUsername),
      api_base_url: HOSTINGER_API_BASE_URL,
    },
    request: {
      list_builds_path: `/api/hosting/v1/accounts/{username}/websites/${configuration.domain}/nodejs/builds`,
      build_logs_path: `/api/hosting/v1/accounts/{username}/websites/${configuration.domain}/nodejs/builds/{uuid}/logs`,
      page: 1,
      logs_from_line: 0,
      timeout_ms: configuration.timeoutMs,
      method: "GET",
      credential_source: "HOSTINGER_API_TOKEN",
      token_returned: false,
    },
    outcome: "failed",
    classification: "evidence_error",
    builds: [],
    latest_build_after_merge: null,
    build_logs: null,
    failed_build_logs: null,
    first_failure: null,
    side_effects: {
      repository_mutation_performed: false,
      provider_dispatch_performed: false,
      provider_mutation_performed: false,
      credential_access_performed: Boolean(configuration.token),
      sql_execution_performed: false,
      migration_apply_performed: false,
      database_mutation_performed: false,
      restart_performed: false,
      external_send_performed: false,
    },
    secrets_included: false,
  };

  try {
    const listResult = await requestJson(buildListUrl(configuration), configuration, fetchImpl);
    const builds = sortBuilds(normalizeBuildCollection(listResult.body));
    const afterMerge = builds.filter((build) => buildTimestamp(build) >= configuration.productionMergedAtMs);
    const latest = afterMerge[0] || null;
    report.builds = builds.slice(0, 20);
    report.latest_build_after_merge = latest;

    const decision = classifyBuild(latest, configuration);
    report.outcome = decision.outcome;
    report.classification = decision.classification;
    report.first_failure = decision.failure;

    if (latest?.uuid && (latest.state === "completed" || latest.state === "failed")) {
      try {
        const logsResult = await requestJson(buildLogsUrl(configuration, latest.uuid), configuration, fetchImpl);
        report.build_logs = {
          build_uuid: latest.uuid,
          ...normalizeLogs(logsResult.body, configuration.token),
        };
        if (latest.state === "failed") report.failed_build_logs = report.build_logs;
        applyLogProvenanceDecision(report, configuration);
      } catch (error) {
        report.build_logs = {
          build_uuid: latest.uuid,
          unavailable: true,
          failure: safeFailure(error, "hostinger_build_logs_unavailable"),
        };
        if (latest.state === "failed") report.failed_build_logs = report.build_logs;
      }
    }
  } catch (error) {
    const failure = safeFailure(error);
    report.classification = failure.code;
    report.first_failure = failure;
    report.outcome = failure.code === "hostinger_api_token_unavailable" ? "blocked" : "failed";
  }

  const serialized = JSON.stringify(report);
  if (configuration.token && serialized.includes(configuration.token)) {
    throw new EvidenceError("secret_redaction_failure", "Hostinger API token leaked into structured evidence.");
  }
  return report;
}

export function renderMarkdown(report) {
  const lines = [
    "# Hostinger Node.js Build Evidence",
    "",
    `- Contract: \`${report.contract}\``,
    `- Generated at: \`${report.generated_at}\``,
    `- Domain: \`${report.identity?.domain || "unavailable"}\``,
    `- Expected Production SHA: \`${report.identity?.expected_sha || "unavailable"}\``,
    `- Production merged at: \`${report.identity?.production_merged_at || "unavailable"}\``,
    `- Outcome: **${report.outcome}**`,
    `- Classification: \`${report.classification}\``,
    `- Secrets included: \`${report.secrets_included}\``,
    "",
  ];
  const build = report.latest_build_after_merge;
  if (build) {
    lines.push("## Latest build after merge", "");
    lines.push(`- UUID: \`${build.uuid || "unavailable"}\``);
    lines.push(`- State: \`${build.state}\``);
    lines.push(`- Created at: \`${build.created_at || "unavailable"}\``);
    lines.push(`- Updated at: \`${build.updated_at || "unavailable"}\``);
    lines.push(
      `- Source SHAs exposed by build list: ${
        build.source_shas.length ? build.source_shas.map((sha) => `\`${sha}\``).join(", ") : "none"
      }`,
    );
    lines.push("");
  }
  if (report.build_logs) {
    lines.push("## Redacted selected-build logs", "");
    lines.push(`- Build UUID: \`${report.build_logs.build_uuid || "unavailable"}\``);
    lines.push(
      `- Source SHAs from source-context lines: ${
        report.build_logs.source_shas?.length
          ? report.build_logs.source_shas.map((sha) => `\`${sha}\``).join(", ")
          : "none"
      }`,
    );
    lines.push(`- Truncated: \`${Boolean(report.build_logs.truncated)}\``, "");
    if (report.build_logs.activation_signals?.length) {
      lines.push("### Bounded activation signals", "", "```text");
      lines.push(...report.build_logs.activation_signals);
      lines.push("```", "");
    }
    if (report.build_logs.error_signals?.length) {
      lines.push("### Bounded error signals", "", "```text");
      lines.push(...report.build_logs.error_signals);
      lines.push("```", "");
    }
    if (report.build_logs.excerpt) {
      lines.push("### Bounded redacted excerpt", "", "```text", report.build_logs.excerpt, "```", "");
    }
    if (report.build_logs.unavailable) {
      lines.push(
        `- Logs unavailable: \`${report.build_logs.failure?.code || "hostinger_build_logs_unavailable"}\``,
        "",
      );
    }
  }
  if (report.first_failure) {
    lines.push(
      "## First failure",
      "",
      `- Code: \`${report.first_failure.code}\``,
      `- Message: ${report.first_failure.message}`,
      "",
    );
  }
  lines.push(
    "## Safety boundary",
    "",
    "This evidence performs authenticated GET requests only. It does not create a build, deploy, restart, mutate provider state, run SQL, apply migrations, or expose credentials.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function writeEvidence(report, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "hostinger-nodejs-build-evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "hostinger-nodejs-build-evidence.md"),
    renderMarkdown(report),
    "utf8",
  );
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const report = await collectHostingerNodejsBuildEvidence(options);
    writeEvidence(report, options.outputDir || DEFAULT_OUTPUT_DIR);
    console.log(
      JSON.stringify({
        ok: report.outcome === "passed",
        outcome: report.outcome,
        classification: report.classification,
        secrets_included: false,
      }),
    );
    if (report.outcome !== "passed") process.exitCode = 1;
  } catch (error) {
    const outputDir =
      options?.outputDir || process.env.HOSTINGER_NODEJS_BUILD_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR;
    const failure = safeFailure(error);
    const report = {
      contract: HOSTINGER_NODEJS_BUILD_EVIDENCE_CONTRACT,
      generated_at: new Date().toISOString(),
      outcome: "failed",
      classification: failure.code,
      first_failure: failure,
      side_effects: {
        repository_mutation_performed: false,
        provider_dispatch_performed: false,
        provider_mutation_performed: false,
        credential_access_performed: false,
        sql_execution_performed: false,
        migration_apply_performed: false,
        database_mutation_performed: false,
        restart_performed: false,
        external_send_performed: false,
      },
      secrets_included: false,
    };
    writeEvidence(report, outputDir);
    console.error(JSON.stringify({ ok: false, error: failure, secrets_included: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();