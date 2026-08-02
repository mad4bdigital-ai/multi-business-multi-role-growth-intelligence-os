#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

export const PRODUCTION_RUNTIME_PARITY_CONTRACT = "mad4b.production-runtime-parity-evidence.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ENDPOINT_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;
const ALLOWED_HOST_PATTERN = /(^|\.)mad4b\.com$/iu;
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "production-runtime-parity-evidence");
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 64 * 1024;
const EXPECTED_SERVICE = "http_generic_api_connector";

class EvidenceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
    this.details = details;
  }
}

function clean(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]")
    .replace(/\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|cookie|secret)\b(\s*[:=]\s*)([^\s,;]+)/giu, "$1$2[REDACTED]")
    .slice(0, 2_000);
}

function isPublicAddress(value) {
  const address = String(value || "").toLowerCase();
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (family === 6) {
    if (address === "::" || address === "::1") return false;
    if (address.startsWith("::ffff:")) return isPublicAddress(address.slice(7));
    if (address.startsWith("fc") || address.startsWith("fd")) return false;
    if (/^fe[89ab]/u.test(address)) return false;
    if (address.startsWith("ff") || address.startsWith("2001:db8:")) return false;
    return true;
  }
  return false;
}

function parseEndpoint(value, required) {
  const separator = value.indexOf("=");
  if (separator < 1) throw new EvidenceError("endpoint_format_invalid", "Endpoint must use name=https://host/version.");
  const name = value.slice(0, separator).trim();
  const url = value.slice(separator + 1).trim();
  if (!ENDPOINT_NAME_PATTERN.test(name)) throw new EvidenceError("endpoint_name_invalid", `Invalid endpoint name: ${clean(name)}`);
  return { name, url, required };
}

export function parseArgs(argv) {
  const options = {
    expectedSha: "",
    expectedBranch: "Production",
    outputDir: process.env.PRODUCTION_RUNTIME_PARITY_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    endpoints: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new EvidenceError("argument_value_missing", `${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--expected-sha") options.expectedSha = take();
    else if (arg.startsWith("--expected-sha=")) options.expectedSha = arg.slice(15);
    else if (arg === "--expected-branch") options.expectedBranch = take();
    else if (arg.startsWith("--expected-branch=")) options.expectedBranch = arg.slice(18);
    else if (arg === "--endpoint") options.endpoints.push(parseEndpoint(take(), true));
    else if (arg.startsWith("--endpoint=")) options.endpoints.push(parseEndpoint(arg.slice(11), true));
    else if (arg === "--optional-endpoint") options.endpoints.push(parseEndpoint(take(), false));
    else if (arg.startsWith("--optional-endpoint=")) options.endpoints.push(parseEndpoint(arg.slice(20), false));
    else if (arg === "--output-dir") options.outputDir = take();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(take());
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice(13));
    else throw new EvidenceError("argument_unknown", `Unknown argument: ${clean(arg)}`);
  }
  return options;
}

export function validateConfiguration({ expectedSha, expectedBranch, endpoints, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!SHA_PATTERN.test(String(expectedSha || ""))) {
    throw new EvidenceError("expected_sha_invalid", "Expected deployment SHA must be a full lowercase 40-character Git SHA.");
  }
  if (String(expectedBranch || "").trim() !== "Production") {
    throw new EvidenceError("expected_branch_invalid", "Expected branch must be exactly Production.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new EvidenceError("timeout_invalid", "Timeout must be an integer between 1000 and 60000 milliseconds.");
  }
  if (!Array.isArray(endpoints) || endpoints.length < 1) {
    throw new EvidenceError("endpoint_missing", "At least one required endpoint is needed.");
  }
  const names = new Set();
  let requiredCount = 0;
  const normalized = endpoints.map((endpoint) => {
    if (!ENDPOINT_NAME_PATTERN.test(String(endpoint?.name || ""))) {
      throw new EvidenceError("endpoint_name_invalid", `Invalid endpoint name: ${clean(endpoint?.name)}`);
    }
    if (names.has(endpoint.name)) throw new EvidenceError("endpoint_name_duplicate", `Duplicate endpoint name: ${endpoint.name}`);
    names.add(endpoint.name);
    if (endpoint.required) requiredCount += 1;
    let parsed;
    try {
      parsed = new URL(endpoint.url);
    } catch {
      throw new EvidenceError("endpoint_url_invalid", `Endpoint ${endpoint.name} has an invalid URL.`);
    }
    if (parsed.protocol !== "https:") throw new EvidenceError("endpoint_https_required", `Endpoint ${endpoint.name} must use HTTPS.`);
    if (parsed.username || parsed.password) throw new EvidenceError("endpoint_credentials_forbidden", `Endpoint ${endpoint.name} must not contain credentials.`);
    if (parsed.search || parsed.hash) throw new EvidenceError("endpoint_query_forbidden", `Endpoint ${endpoint.name} must not contain query or fragment data.`);
    if (parsed.pathname !== "/version") throw new EvidenceError("endpoint_path_invalid", `Endpoint ${endpoint.name} must target exactly /version.`);
    if (parsed.port && parsed.port !== "443") throw new EvidenceError("endpoint_port_forbidden", `Endpoint ${endpoint.name} must use port 443.`);
    if (!ALLOWED_HOST_PATTERN.test(parsed.hostname)) throw new EvidenceError("endpoint_host_forbidden", `Endpoint ${endpoint.name} must use a mad4b.com host.`);
    return {
      name: endpoint.name,
      url: parsed.toString(),
      host: parsed.hostname,
      port: Number(parsed.port || 443),
      required: Boolean(endpoint.required)
    };
  });
  if (requiredCount < 1) throw new EvidenceError("required_endpoint_missing", "At least one endpoint must be required.");
  return {
    expectedSha,
    expectedBranch: "Production",
    timeoutMs,
    endpoints: normalized
  };
}

async function readBoundedBody(response, maxBytes = MAX_BODY_BYTES) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new EvidenceError("response_too_large", `Response exceeded ${maxBytes} bytes.`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function defaultTlsProbe(endpoint, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: endpoint.host,
      port: endpoint.port,
      servername: endpoint.host,
      rejectUnauthorized: true
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new EvidenceError("tls_timeout", `TLS handshake timed out for ${endpoint.name}.`));
    }, timeoutMs);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new EvidenceError("tls_handshake_failed", `TLS handshake failed for ${endpoint.name}: ${clean(error.message)}`));
    });
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const certificate = socket.getPeerCertificate();
      const result = {
        authorized: socket.authorized === true,
        protocol: socket.getProtocol() || null,
        valid_from: certificate?.valid_from || null,
        valid_to: certificate?.valid_to || null,
        fingerprint256: certificate?.fingerprint256 || null,
        subject_cn: certificate?.subject?.CN || null,
        issuer_cn: certificate?.issuer?.CN || null
      };
      socket.end();
      if (!result.authorized) {
        reject(new EvidenceError("tls_unauthorized", `TLS certificate was not authorized for ${endpoint.name}.`));
        return;
      }
      resolve(result);
    });
  });
}

function safeFailure(error, fallbackCode) {
  return {
    code: error?.code || fallbackCode,
    message: clean(error?.message || String(error)),
    ...(error?.details ? { details: error.details } : {})
  };
}

async function probeEndpoint(endpoint, configuration, dependencies) {
  const startedAt = dependencies.now();
  const result = {
    name: endpoint.name,
    url: endpoint.url,
    host: endpoint.host,
    required: endpoint.required,
    status: "failed",
    dns: null,
    tls: null,
    http: null,
    runtime: null,
    failure: null,
    duration_ms: 0
  };
  try {
    const addresses = await dependencies.lookup(endpoint.host, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length < 1) {
      throw new EvidenceError("dns_resolution_empty", `DNS returned no addresses for ${endpoint.name}.`);
    }
    const forbiddenAddress = addresses.find((entry) => !isPublicAddress(entry?.address));
    if (forbiddenAddress) {
      throw new EvidenceError("dns_address_forbidden", `DNS returned a non-public address for ${endpoint.name}.`);
    }
    result.dns = {
      resolved: true,
      address_count: addresses.length,
      families: [...new Set(addresses.map((entry) => Number(entry.family)).filter(Boolean))].sort(),
      addresses: addresses.map((entry) => createHash("sha256").update(String(entry.address)).digest("hex"))
    };

    result.tls = await dependencies.tlsProbe(endpoint, configuration.timeoutMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    let response;
    try {
      response = await dependencies.fetchImpl(endpoint.url, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "application/json",
          "user-agent": "mad4b-production-runtime-parity-evidence/1"
        },
        signal: controller.signal
      });
    } catch (error) {
      throw new EvidenceError("http_request_failed", `HTTP request failed for ${endpoint.name}: ${clean(error.message)}`);
    } finally {
      clearTimeout(timer);
    }

    const body = await readBoundedBody(response);
    const bodyDigest = createHash("sha256").update(body).digest("hex");
    result.http = {
      status: response.status,
      content_type: response.headers.get("content-type"),
      body_bytes: body.byteLength,
      body_sha256: bodyDigest,
      redirected: response.status >= 300 && response.status < 400,
      location_present: Boolean(response.headers.get("location"))
    };
    if (response.status !== 200) {
      throw new EvidenceError("http_status_mismatch", `Endpoint ${endpoint.name} returned HTTP ${response.status}.`);
    }
    if (!String(result.http.content_type || "").toLowerCase().includes("application/json")) {
      throw new EvidenceError("response_content_type_invalid", `Endpoint ${endpoint.name} did not return application/json.`);
    }

    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new EvidenceError("response_json_invalid", `Endpoint ${endpoint.name} did not return valid JSON.`);
    }
    const service = payload?.service || null;
    const deployedCommitSha = payload?.deployment?.deployed_commit_sha || null;
    const deploymentBranch = payload?.deployment?.manifest?.branch || null;
    result.runtime = {
      service,
      deployed_commit_sha: deployedCommitSha,
      deployment_branch: deploymentBranch
    };
    if (service !== EXPECTED_SERVICE) {
      throw new EvidenceError("service_identity_mismatch", `Endpoint ${endpoint.name} returned an unexpected service identity.`);
    }
    if (deployedCommitSha !== configuration.expectedSha) {
      throw new EvidenceError("deployed_sha_mismatch", `Endpoint ${endpoint.name} is not running the expected Production SHA.`);
    }
    if (deploymentBranch !== configuration.expectedBranch) {
      throw new EvidenceError("deployment_branch_mismatch", `Endpoint ${endpoint.name} is not reporting the expected Production branch.`);
    }

    result.status = "passed";
  } catch (error) {
    result.failure = safeFailure(error, "endpoint_probe_failed");
    result.status = endpoint.required ? "failed" : "optional_failed";
  } finally {
    result.duration_ms = Math.max(0, dependencies.now() - startedAt);
  }
  return result;
}

function renderMarkdown(report) {
  const lines = [
    "# Production runtime parity evidence",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Expected Production SHA: \`${report.identity.expected_sha}\``,
    `- Expected branch: \`${report.identity.expected_branch}\``,
    `- Tooling SHA: \`${report.identity.tooling_sha || "unavailable"}\``,
    `- Contract: \`${report.contract}\``,
    "- Secrets included: `false`",
    "",
    "## Endpoints",
    ""
  ];
  for (const endpoint of report.endpoints) {
    lines.push(
      `- ${endpoint.status === "passed" ? "PASS" : endpoint.status === "optional_failed" ? "WARN" : "FAIL"} \`${endpoint.name}\` (${endpoint.required ? "required" : "optional"}): HTTP ${endpoint.http?.status ?? "n/a"}, SHA \`${endpoint.runtime?.deployed_commit_sha || "unavailable"}\`, branch \`${endpoint.runtime?.deployment_branch || "unavailable"}\``
    );
    if (endpoint.failure) lines.push(`  - ${endpoint.failure.code}: ${endpoint.failure.message}`);
  }
  if (report.first_failure) {
    lines.push("", "## First blocking failure", "", `- Endpoint: \`${report.first_failure.endpoint}\``, `- Code: \`${report.first_failure.code}\``, `- Message: ${report.first_failure.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(outputDir, report) {
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, { recursive: true });
  const jsonPath = path.join(resolved, "production-runtime-parity-evidence.json");
  const markdownPath = path.join(resolved, "production-runtime-parity-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}

export async function runProductionRuntimeParityEvidence({
  expectedSha,
  expectedBranch = "Production",
  endpoints,
  outputDir = DEFAULT_OUTPUT_DIR,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  lookup = dns.lookup,
  tlsProbe = defaultTlsProbe,
  fetchImpl = fetch,
  now = () => Date.now()
} = {}) {
  const configuration = validateConfiguration({ expectedSha, expectedBranch, endpoints, timeoutMs });
  const dependencies = { lookup, tlsProbe, fetchImpl, now };
  const results = [];
  for (const endpoint of configuration.endpoints) {
    results.push(await probeEndpoint(endpoint, configuration, dependencies));
  }
  const blocking = results.filter((entry) => entry.required && entry.status !== "passed");
  const first = blocking[0];
  const report = {
    contract: PRODUCTION_RUNTIME_PARITY_CONTRACT,
    generated_at: new Date().toISOString(),
    identity: {
      repository: env.GITHUB_REPOSITORY || "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      expected_sha: configuration.expectedSha,
      expected_branch: configuration.expectedBranch,
      tooling_sha: SHA_PATTERN.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA : null,
      workflow: env.GITHUB_WORKFLOW || "Production Runtime Parity Evidence",
      run_id: env.GITHUB_RUN_ID || null
    },
    outcome: blocking.length === 0 ? "passed" : "failed",
    endpoints: results,
    first_failure: first ? {
      endpoint: first.name,
      code: first.failure?.code || "endpoint_probe_failed",
      message: first.failure?.message || "Endpoint probe failed."
    } : null,
    routing: {
      source_of_truth: "structured_report",
      job_logs_role: "diagnostic_only",
      consult_job_logs: false
    },
    side_effects: {
      repository_mutation_performed: false,
      provider_dispatch_performed: false,
      credential_access_performed: false,
      sql_execution_performed: false,
      migration_apply_performed: false,
      external_send_performed: false
    },
    secrets_included: false
  };
  return { report, ...writeReport(outputDir, report) };
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runProductionRuntimeParityEvidence(options);
  const summary = {
    ok: result.report.outcome === "passed",
    contract: result.report.contract,
    outcome: result.report.outcome,
    expected_sha: result.report.identity.expected_sha,
    first_failure: result.report.first_failure,
    report_file: result.jsonPath,
    secrets_included: false
  };
  const output = `${JSON.stringify(summary)}\n`;
  if (summary.ok) process.stdout.write(output);
  else process.stderr.write(output);
  return summary.ok ? 0 : 1;
}

function isDirectExecution(importMetaUrl, argvPath) {
  if (!argvPath) return false;
  return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: clean(error?.message || String(error)),
        code: error?.code || "production_runtime_parity_error",
        secrets_included: false
      }));
      process.exitCode = 1;
    });
}
