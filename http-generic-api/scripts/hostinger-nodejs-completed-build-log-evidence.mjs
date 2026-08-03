#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_CONTRACT =
  "mad4b.hostinger-nodejs-completed-build-log-evidence.v1";
export const HOSTINGER_API_BASE_URL = "https://developers.hostinger.com";

const DEFAULT_DOMAIN = "auth.mad4b.com";
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "hostinger-nodejs-completed-build-log-evidence");
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_LOG_CHARS = 12_000;
const SHA_PATTERN = /\b[0-9a-f]{40}\b/giu;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

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

export function parseArgs(argv, env = process.env) {
  const options = {
    accountUsername: env.HOSTINGER_ACCOUNT_USERNAME || "",
    domain: env.HOSTINGER_NODEJS_DOMAIN || DEFAULT_DOMAIN,
    buildUuid: env.HOSTINGER_NODEJS_BUILD_UUID || "",
    expectedSha: env.EXPECTED_PRODUCTION_SHA || "",
    outputDir: env.HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR,
    timeoutMs: Number(env.HOSTINGER_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    token: env.HOSTINGER_API_TOKEN || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new EvidenceError("argument_value_missing", `${arg} requires a value.`);
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
  const buildUuid = String(options.buildUuid ?? "").trim().toLowerCase();
  const expectedSha = String(options.expectedSha ?? "").trim().toLowerCase();
  const token = String(options.token ?? "").trim();
  if (!USERNAME_PATTERN.test(accountUsername)) throw new EvidenceError("account_username_invalid", "Hostinger account username is invalid.");
  if (domain !== DEFAULT_DOMAIN) throw new EvidenceError("domain_not_authorized", `Live build-log evidence is restricted to ${DEFAULT_DOMAIN}.`);
  if (!UUID_PATTERN.test(buildUuid)) throw new EvidenceError("build_uuid_invalid", "Hostinger build UUID must be a canonical UUID.");
  if (!/^[0-9a-f]{40}$/u.test(expectedSha)) throw new EvidenceError("expected_sha_invalid", "Expected Production SHA must be a full lowercase 40-character Git SHA.");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) {
    throw new EvidenceError("timeout_invalid", "Timeout must be an integer between 1000 and 60000 milliseconds.");
  }
  return {
    accountUsername,
    domain,
    buildUuid,
    expectedSha,
    expectedBranch: "Production",
    outputDir: String(options.outputDir || DEFAULT_OUTPUT_DIR),
    timeoutMs: options.timeoutMs,
    token,
  };
}

function buildLogsUrl(configuration) {
  const username = encodeURIComponent(configuration.accountUsername);
  const domain = encodeURIComponent(configuration.domain);
  const uuid = encodeURIComponent(configuration.buildUuid);
  const url = new URL(`/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/builds/${uuid}/logs`, HOSTINGER_API_BASE_URL);
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
        throw new EvidenceError("hostinger_api_response_too_large", `Hostinger API response exceeded ${MAX_RESPONSE_BYTES} bytes.`, response.status);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function requestJson(url, configuration, fetchImpl) {
  if (!configuration.token) throw new EvidenceError("hostinger_api_token_unavailable", "HOSTINGER_API_TOKEN is required for live Hostinger build-log inspection.");
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
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new EvidenceError("hostinger_api_timeout", "Hostinger API request timed out.");
    throw new EvidenceError("hostinger_api_transport_failed", `Hostinger API request failed: ${redactKnownSecret(error?.message ?? error, configuration.token)}`);
  }
  const text = await readBoundedText(response);
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new EvidenceError("hostinger_api_invalid_json", `Hostinger API returned non-JSON content with HTTP ${response.status}.`, response.status);
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
  return body;
}

function rawLogText(body) {
  const raw = body?.logs ?? body?.data?.logs ?? body?.data ?? body?.message ?? "";
  return Array.isArray(raw) ? raw.join("\n") : typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? "");
}

export function extractLogProvenance(text, expectedSha) {
  const raw = String(text ?? "");
  const shas = [...new Set((raw.match(SHA_PATTERN) || []).map((value) => value.toLowerCase()))].slice(0, 20);
  const expectedShaFound = shas.includes(expectedSha);
  const branchHints = [...new Set(
    raw.split(/\r?\n/u)
      .filter((line) => /(branch|ref|checkout|source)/iu.test(line) && /\bProduction\b/u.test(line))
      .map((line) => redact(line, 500))
  )].slice(0, 20);
  const releaseHints = [...new Set(
    raw.match(/\/home\/[A-Za-z0-9._/-]*?\.builds\/versions\/[0-9a-f-]{36}[A-Za-z0-9._/-]*/giu) || []
  )].map((value) => redact(value, 1_000)).slice(0, 20);
  return {
    source_shas: shas,
    expected_sha_found: expectedShaFound,
    production_branch_hint_found: branchHints.length > 0,
    branch_hints: branchHints,
    release_path_hints: releaseHints,
  };
}

function classify(provenance, expectedSha) {
  if (provenance.expected_sha_found) return { outcome: "passed", classification: "completed_build_logs_expected_sha", failure: null };
  if (provenance.source_shas.length > 0) {
    return {
      outcome: "failed",
      classification: "completed_build_logs_other_sha",
      failure: {
        code: "hostinger_completed_build_log_sha_mismatch",
        message: `Completed build logs expose source SHA values but not expected Production SHA ${expectedSha}.`,
      },
    };
  }
  if (provenance.production_branch_hint_found) return { outcome: "partial", classification: "completed_build_logs_production_branch_only", failure: null };
  return { outcome: "partial", classification: "completed_build_logs_source_unverified", failure: null };
}

export async function collectHostingerCompletedBuildLogEvidence(options, dependencies = {}) {
  const configuration = validateConfiguration(options);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => new Date());
  const report = {
    contract: HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_CONTRACT,
    generated_at: now().toISOString(),
    identity: {
      expected_sha: configuration.expectedSha,
      expected_branch: configuration.expectedBranch,
      domain: configuration.domain,
      build_uuid: configuration.buildUuid,
      account_username_masked: `${configuration.accountUsername.slice(0, 1)}********${configuration.accountUsername.slice(-1)}`,
      api_base_url: HOSTINGER_API_BASE_URL,
    },
    request: {
      build_logs_path: `/api/hosting/v1/accounts/{username}/websites/${configuration.domain}/nodejs/builds/{uuid}/logs`,
      from_line: 0,
      timeout_ms: configuration.timeoutMs,
      method: "GET",
      credential_source: "HOSTINGER_API_TOKEN",
      token_returned: false,
    },
    outcome: "failed",
    classification: "evidence_error",
    log_evidence: null,
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
    const body = await requestJson(buildLogsUrl(configuration), configuration, fetchImpl);
    const raw = rawLogText(body);
    const provenance = extractLogProvenance(raw, configuration.expectedSha);
    const decision = classify(provenance, configuration.expectedSha);
    report.outcome = decision.outcome;
    report.classification = decision.classification;
    report.first_failure = decision.failure;
    report.log_evidence = {
      excerpt: redactKnownSecret(raw, configuration.token, MAX_LOG_CHARS) || null,
      returned_lines: Number(body?.lines ?? body?.data?.lines ?? 0) || null,
      truncated: raw.length > MAX_LOG_CHARS,
      ...provenance,
    };
  } catch (error) {
    const failure = safeFailure(error);
    report.outcome = failure.code === "hostinger_api_token_unavailable" ? "blocked" : "failed";
    report.classification = failure.code;
    report.first_failure = failure;
  }

  const serialized = JSON.stringify(report);
  if (configuration.token && serialized.includes(configuration.token)) {
    throw new EvidenceError("secret_redaction_failure", "Hostinger API token leaked into structured evidence.");
  }
  return report;
}

export function renderMarkdown(report) {
  const lines = [
    "# Hostinger Node.js Completed Build Log Evidence",
    "",
    `- Contract: \`${report.contract}\``,
    `- Generated at: \`${report.generated_at}\``,
    `- Build UUID: \`${report.identity?.build_uuid || "unavailable"}\``,
    `- Expected Production SHA: \`${report.identity?.expected_sha || "unavailable"}\``,
    `- Outcome: **${report.outcome}**`,
    `- Classification: \`${report.classification}\``,
    `- Secrets included: \`${report.secrets_included}\``,
    "",
  ];
  if (report.log_evidence) {
    lines.push("## Provenance extracted from redacted logs", "");
    lines.push(`- Expected SHA found: \`${report.log_evidence.expected_sha_found}\``);
    lines.push(`- Production branch hint found: \`${report.log_evidence.production_branch_hint_found}\``);
    lines.push(`- Source SHAs: ${report.log_evidence.source_shas.length ? report.log_evidence.source_shas.map((sha) => `\`${sha}\``).join(", ") : "none"}`);
    lines.push(`- Release path hints: ${report.log_evidence.release_path_hints.length ? report.log_evidence.release_path_hints.map((value) => `\`${value}\``).join(", ") : "none"}`, "");
    if (report.log_evidence.excerpt) lines.push("## Redacted bounded log excerpt", "", "```text", report.log_evidence.excerpt, "```", "");
  }
  if (report.first_failure) lines.push("## First failure", "", `- Code: \`${report.first_failure.code}\``, `- Message: ${report.first_failure.message}`, "");
  lines.push("## Safety boundary", "", "This evidence performs one authenticated GET request only. It does not create a build, deploy, activate a release, restart a service, mutate provider state, run SQL, apply migrations, or expose credentials.", "");
  return `${lines.join("\n")}\n`;
}

export function writeEvidence(report, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "hostinger-nodejs-completed-build-log-evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "hostinger-nodejs-completed-build-log-evidence.md"), renderMarkdown(report), "utf8");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const report = await collectHostingerCompletedBuildLogEvidence(options);
    writeEvidence(report, options.outputDir || DEFAULT_OUTPUT_DIR);
    console.log(JSON.stringify({ ok: report.outcome === "passed", outcome: report.outcome, classification: report.classification, secrets_included: false }));
    if (report.outcome !== "passed") process.exitCode = 1;
  } catch (error) {
    const outputDir = options?.outputDir || process.env.HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR;
    const failure = safeFailure(error);
    const report = {
      contract: HOSTINGER_NODEJS_COMPLETED_BUILD_LOG_EVIDENCE_CONTRACT,
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
