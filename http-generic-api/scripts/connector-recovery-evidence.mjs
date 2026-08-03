#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

export const CONNECTOR_RECOVERY_EVIDENCE_CONTRACT = "mad4b.connector-recovery-evidence.v1";
const DEFAULT_URL = "https://connector.mad4b.com/health";
const DEFAULT_OUTPUT_DIR = path.join("artifacts", "connector-recovery-evidence");
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DNS_ADDRESSES = 16;

class EvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
  }
}

function clean(value, maxLength = 2_000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]")
    .replace(/\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|password|cookie|secret)\b(\s*[:=]\s*)([^\s,;]+)/giu, "$1$2[REDACTED]")
    .slice(0, maxLength);
}

function isPublicAddress(value) {
  const address = String(value ?? "").toLowerCase();
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 2 || b === 168)) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    if (address === "::" || address === "::1") return false;
    if (address.startsWith("::ffff:")) return isPublicAddress(address.slice(7));
    if (address.startsWith("fc") || address.startsWith("fd")) return false;
    if (/^fe[89ab]/u.test(address)) return false;
    if (address.startsWith("100:") || address.startsWith("64:ff9b:1:")) return false;
    if (address.startsWith("2001:2:") || address.startsWith("2001:db8:")) return false;
    if (/^2001:(?:1[0-9a-f]|2[0-9a-f]):/u.test(address)) return false;
    if (address.startsWith("ff")) return false;
    return true;
  }
  return false;
}

async function withTimeout(promise, timeoutMs, code, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new EvidenceError(code, message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function validateConfiguration({
  connectorUrl = DEFAULT_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new EvidenceError("timeout_invalid", "Timeout must be an integer between 1000 and 60000 milliseconds.");
  }
  let parsed;
  try {
    parsed = new URL(connectorUrl);
  } catch {
    throw new EvidenceError("connector_url_invalid", "Connector URL is invalid.");
  }
  if (parsed.protocol !== "https:") throw new EvidenceError("connector_https_required", "Connector URL must use HTTPS.");
  if (parsed.username || parsed.password) throw new EvidenceError("connector_credentials_forbidden", "Connector URL must not contain credentials.");
  if (parsed.hostname.toLowerCase() !== "connector.mad4b.com") throw new EvidenceError("connector_host_mismatch", "Connector URL must use connector.mad4b.com.");
  if (parsed.port && parsed.port !== "443") throw new EvidenceError("connector_port_forbidden", "Connector URL must use port 443.");
  if (parsed.pathname !== "/health") throw new EvidenceError("connector_path_invalid", "Connector URL must target exactly /health.");
  if (parsed.search || parsed.hash) throw new EvidenceError("connector_query_forbidden", "Connector URL must not contain query or fragment data.");
  return {
    connectorUrl: parsed.toString(),
    endpoint: { name: "connector", host: "connector.mad4b.com", port: 443 },
    timeoutMs
  };
}

async function readBoundedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new EvidenceError("response_too_large", `Response exceeded ${MAX_BODY_BYTES} bytes.`);
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
      reject(new EvidenceError("tls_timeout", "Connector TLS handshake timed out."));
    }, timeoutMs);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new EvidenceError("tls_handshake_failed", `Connector TLS handshake failed: ${clean(error.message)}`));
    });
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const certificate = socket.getPeerCertificate();
      const result = {
        authorized: socket.authorized === true,
        protocol: clean(socket.getProtocol(), 32) || null,
        valid_from: clean(certificate?.valid_from, 128) || null,
        valid_to: clean(certificate?.valid_to, 128) || null,
        fingerprint256: clean(certificate?.fingerprint256, 128) || null,
        subject_cn: clean(certificate?.subject?.CN, 256) || null,
        issuer_cn: clean(certificate?.issuer?.CN, 256) || null
      };
      socket.end();
      if (!result.authorized) reject(new EvidenceError("tls_unauthorized", "Connector TLS certificate was not authorized."));
      else resolve(result);
    });
  });
}

function safeFailure(error, fallbackCode) {
  const candidateCode = String(error?.code ?? "");
  return {
    code: /^[a-z][a-z0-9_]{1,63}$/u.test(candidateCode) ? candidateCode : fallbackCode,
    message: clean(error?.message ?? String(error))
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Connector recovery evidence",
    "",
    `- Outcome: **${report.outcome}**`,
    `- Endpoint: \`${report.endpoint.url}\``,
    `- Contract: \`${report.contract}\``,
    `- Tooling SHA: \`${report.identity.tooling_sha || "unavailable"}\``,
    "- Secrets included: `false`",
    "",
    "## Readback",
    "",
    `- DNS resolved: \`${report.endpoint.dns?.resolved === true}\``,
    `- TLS authorized: \`${report.endpoint.tls?.authorized === true}\``,
    `- HTTP status: \`${report.endpoint.http?.status ?? "n/a"}\``,
    `- Service: \`${report.endpoint.runtime?.service || "unavailable"}\``,
    `- Platform: \`${report.endpoint.runtime?.platform || "unavailable"}\``,
    `- Hostname hash present: \`${Boolean(report.endpoint.runtime?.hostname_sha256)}\``,
    `- Uptime seconds: \`${report.endpoint.runtime?.uptime_seconds ?? "unavailable"}\``
  ];
  if (report.first_failure) {
    lines.push("", "## First blocking failure", "", `- Code: \`${report.first_failure.code}\``, `- Message: ${report.first_failure.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeReport(outputDir, report) {
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, { recursive: true });
  const jsonPath = path.join(resolved, "connector-recovery-evidence.json");
  const markdownPath = path.join(resolved, "connector-recovery-evidence.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}

export async function runConnectorRecoveryEvidence({
  connectorUrl = DEFAULT_URL,
  outputDir = DEFAULT_OUTPUT_DIR,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  lookup = dns.lookup,
  tlsProbe = defaultTlsProbe,
  fetchImpl = fetch,
  now = () => Date.now()
} = {}) {
  const configuration = validateConfiguration({ connectorUrl, timeoutMs });
  const startedAt = now();
  const endpoint = {
    name: "connector",
    url: configuration.connectorUrl,
    host: configuration.endpoint.host,
    status: "failed",
    dns: null,
    tls: null,
    http: null,
    runtime: null,
    failure: null,
    duration_ms: 0
  };

  try {
    const addresses = await withTimeout(
      Promise.resolve().then(() => lookup(configuration.endpoint.host, { all: true, verbatim: true })),
      configuration.timeoutMs,
      "dns_timeout",
      "Connector DNS resolution timed out."
    );
    if (!Array.isArray(addresses) || addresses.length < 1) throw new EvidenceError("dns_resolution_empty", "Connector DNS returned no addresses.");
    if (addresses.length > MAX_DNS_ADDRESSES) throw new EvidenceError("dns_address_count_exceeded", "Connector DNS returned too many addresses.");
    if (addresses.some((entry) => !isPublicAddress(entry?.address))) throw new EvidenceError("dns_address_forbidden", "Connector DNS returned a non-public address.");
    endpoint.dns = {
      resolved: true,
      address_count: addresses.length,
      families: [...new Set(addresses.map((entry) => Number(entry.family)).filter(Boolean))].sort(),
      addresses: addresses.map((entry) => createHash("sha256").update(String(entry.address)).digest("hex"))
    };

    endpoint.tls = await tlsProbe(configuration.endpoint, configuration.timeoutMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    let response;
    let body;
    try {
      response = await fetchImpl(configuration.connectorUrl, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json", "user-agent": "mad4b-connector-recovery-evidence/1" },
        signal: controller.signal
      });
      body = await readBoundedBody(response);
    } catch (error) {
      if (error instanceof EvidenceError) throw error;
      if (controller.signal.aborted) throw new EvidenceError("http_timeout", "Connector HTTP response timed out.");
      throw new EvidenceError("http_request_failed", `Connector HTTP request failed: ${clean(error.message)}`);
    } finally {
      clearTimeout(timer);
    }

    const contentType = clean(response.headers.get("content-type"), 256) || null;
    endpoint.http = {
      status: response.status,
      content_type: contentType,
      body_bytes: body.byteLength,
      body_sha256: createHash("sha256").update(body).digest("hex"),
      redirected: response.status >= 300 && response.status < 400,
      location_present: Boolean(response.headers.get("location"))
    };
    if (response.status !== 200) throw new EvidenceError("http_status_mismatch", `Connector returned HTTP ${response.status}.`);
    if (!String(contentType ?? "").toLowerCase().includes("application/json")) throw new EvidenceError("response_content_type_invalid", "Connector did not return application/json.");

    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new EvidenceError("response_json_invalid", "Connector did not return valid JSON.");
    }

    const rawHostname = typeof payload?.hostname === "string" ? payload.hostname.trim() : "";
    const rawUptime = Number(payload?.uptime);
    endpoint.runtime = {
      ok: payload?.ok === true,
      service: payload?.service === "local-connector" ? "local-connector" : null,
      platform: payload?.platform === "win32" ? "win32" : null,
      hostname_present: rawHostname.length > 0,
      hostname_sha256: rawHostname ? createHash("sha256").update(rawHostname).digest("hex") : null,
      uptime_seconds: Number.isFinite(rawUptime) && rawUptime >= 0 ? rawUptime : null
    };
    if (payload?.ok !== true) throw new EvidenceError("connector_health_not_ok", "Connector health did not report ok=true.");
    if (payload?.service !== "local-connector") throw new EvidenceError("service_identity_mismatch", "Connector returned an unexpected service identity.");
    if (payload?.platform !== "win32") throw new EvidenceError("platform_identity_mismatch", "Connector did not report the required Windows platform.");
    if (!rawHostname) throw new EvidenceError("hostname_missing", "Connector did not report a hostname.");
    if (!Number.isFinite(rawUptime) || rawUptime < 0) throw new EvidenceError("uptime_invalid", "Connector did not report a valid uptime.");
    endpoint.status = "passed";
  } catch (error) {
    endpoint.failure = safeFailure(error, "connector_probe_failed");
  } finally {
    endpoint.duration_ms = Math.max(0, now() - startedAt);
  }

  const report = {
    contract: CONNECTOR_RECOVERY_EVIDENCE_CONTRACT,
    generated_at: new Date().toISOString(),
    identity: {
      repository: clean(env.GITHUB_REPOSITORY || "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", 256),
      tooling_sha: /^[0-9a-f]{40}$/u.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA : null,
      workflow: clean(env.GITHUB_WORKFLOW || "Connector Recovery Evidence", 256),
      run_id: /^\d+$/u.test(String(env.GITHUB_RUN_ID ?? "")) ? String(env.GITHUB_RUN_ID) : null
    },
    outcome: endpoint.status === "passed" ? "passed" : "failed",
    endpoint,
    first_failure: endpoint.failure ? { code: endpoint.failure.code, message: endpoint.failure.message } : null,
    routing: { source_of_truth: "structured_report", job_logs_role: "diagnostic_only", consult_job_logs: false },
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

export function parseArgs(argv) {
  const options = {
    connectorUrl: DEFAULT_URL,
    outputDir: process.env.CONNECTOR_RECOVERY_EVIDENCE_DIR || DEFAULT_OUTPUT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new EvidenceError("argument_value_missing", `${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--connector-url") options.connectorUrl = take();
    else if (arg.startsWith("--connector-url=")) options.connectorUrl = arg.slice(16);
    else if (arg === "--output-dir") options.outputDir = take();
    else if (arg.startsWith("--output-dir=")) options.outputDir = arg.slice(13);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(take());
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice(13));
    else throw new EvidenceError("argument_unknown", `Unknown argument: ${clean(arg)}`);
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const result = await runConnectorRecoveryEvidence(parseArgs(argv));
  const summary = {
    ok: result.report.outcome === "passed",
    contract: result.report.contract,
    outcome: result.report.outcome,
    first_failure: result.report.first_failure,
    report_file: result.jsonPath,
    secrets_included: false
  };
  (summary.ok ? process.stdout : process.stderr).write(`${JSON.stringify(summary)}\n`);
  return summary.ok ? 0 : 1;
}

function isDirectExecution(importMetaUrl, argvPath) {
  return Boolean(argvPath) && path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: clean(error?.message ?? String(error)),
        code: /^[a-z][a-z0-9_]{1,63}$/u.test(String(error?.code ?? "")) ? error.code : "connector_recovery_evidence_error",
        secrets_included: false
      }));
      process.exitCode = 1;
    });
}
