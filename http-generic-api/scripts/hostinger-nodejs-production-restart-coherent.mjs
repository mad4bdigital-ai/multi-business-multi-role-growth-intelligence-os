#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  executeGovernedRestart as executeBaseRestart,
  HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
  parseArgs,
  validateConfiguration,
  writeReport,
} from "./hostinger-nodejs-production-restart.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const IDENTITY_AUTHORITY = "deployment_info_coherent_pair";

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

function extractIdentity(body) {
  const shas = new Set();
  const branches = new Set();
  for (const entry of collectByKey(body, (key, value) => /(sha|commit|revision)/iu.test(key) && typeof value === "string")) {
    const normalized = String(entry).trim().toLowerCase();
    if (SHA_PATTERN.test(normalized)) shas.add(normalized);
  }
  for (const entry of collectByKey(body, (key, value) => /branch/iu.test(key) && typeof value === "string")) {
    const normalized = String(entry).trim();
    if (normalized) branches.add(normalized);
  }
  return { shas: [...shas], branches: [...branches] };
}

function hasCoherentExpectedIdentity(body, configuration) {
  const identity = extractIdentity(body);
  return identity.shas.includes(configuration.expectedSha)
    && identity.branches.includes(configuration.expectedBranch);
}

function suppressExpectedIdentity(value, configuration, depth = 0) {
  if (depth > 10 || value === null || value === undefined) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === configuration.expectedSha) return "[NON_AUTHORITATIVE_EXPECTED_SHA]";
    if (trimmed === configuration.expectedBranch) return "[NON_AUTHORITATIVE_EXPECTED_BRANCH]";
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => suppressExpectedIdentity(entry, configuration, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, suppressExpectedIdentity(entry, configuration, depth + 1)]),
    );
  }
  return value;
}

async function rewriteJsonResponse(response, transform) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return response;
  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  const rewritten = transform(body);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(rewritten), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createCoherentRuntimeFetch(configuration, fetchImpl = fetch) {
  return async (url, init = {}) => {
    const response = await fetchImpl(url, init);
    if (String(init.method || "GET").toUpperCase() !== "GET") return response;

    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/version")) {
      return rewriteJsonResponse(response, (body) => suppressExpectedIdentity(body, configuration));
    }
    if (pathname.endsWith("/deployment-info")) {
      return rewriteJsonResponse(response, (body) => (
        hasCoherentExpectedIdentity(body, configuration)
          ? body
          : suppressExpectedIdentity(body, configuration)
      ));
    }
    return response;
  };
}

export async function executeGovernedRestart(options, dependencies = {}) {
  const configuration = validateConfiguration(options);
  const rawFetch = dependencies.fetchImpl || fetch;
  const fetchImpl = createCoherentRuntimeFetch(configuration, rawFetch);
  const report = await executeBaseRestart(options, { ...dependencies, fetchImpl });
  report.runtime_identity_authority = {
    contract: "mad4b.hostinger-runtime-identity-authority.v1",
    authoritative_endpoint: "/deployment-info",
    required_pair: {
      sha: configuration.expectedSha,
      branch: configuration.expectedBranch,
    },
    cross_endpoint_composition_allowed: false,
    version_endpoint_authoritative: false,
    mode: IDENTITY_AUTHORITY,
  };
  return report;
}

function fallbackReport(error, options = {}) {
  const expectedSha = String(options.expectedSha || process.env.EXPECTED_PRODUCTION_SHA || "");
  const expectedBuildUuid = String(options.expectedBuildUuid || process.env.EXPECTED_HOSTINGER_BUILD_UUID || "");
  const domain = String(options.domain || process.env.HOSTINGER_NODEJS_DOMAIN || "auth.mad4b.com");
  return {
    contract: HOSTINGER_NODEJS_PRODUCTION_RESTART_CONTRACT,
    generated_at: new Date().toISOString(),
    identity: {
      expected_sha: expectedSha,
      expected_branch: "Production",
      expected_build_uuid: expectedBuildUuid,
      production_merged_at: String(options.productionMergedAt || process.env.PRODUCTION_MERGED_AT || ""),
      domain,
      account_username_masked: "[UNAVAILABLE]",
      api_base_url: "https://developers.hostinger.com",
    },
    runtime_identity_authority: {
      contract: "mad4b.hostinger-runtime-identity-authority.v1",
      authoritative_endpoint: "/deployment-info",
      required_pair: { sha: expectedSha, branch: "Production" },
      cross_endpoint_composition_allowed: false,
      version_endpoint_authoritative: false,
      mode: IDENTITY_AUTHORITY,
    },
    outcome: "failed",
    classification: "restart_configuration_failed",
    precondition: null,
    pre_runtime: null,
    restart: { requested: false, performed: false, response_status: null },
    post_runtime: null,
    poll_attempts_used: 0,
    first_failure: {
      code: /^[a-z][a-z0-9_]{1,63}$/u.test(String(error?.code || "")) ? String(error.code) : "restart_configuration_failed",
      message: String(error?.message || error).slice(0, 1_000),
      http_status: Number.isInteger(error?.status) ? error.status : 0,
    },
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

async function main() {
  let options = {};
  let outputDir = process.env.HOSTINGER_NODEJS_RESTART_EVIDENCE_DIR
    || path.join("artifacts", "hostinger-nodejs-production-restart");
  let report;
  try {
    options = parseArgs(process.argv.slice(2));
    outputDir = options.outputDir;
    report = await executeGovernedRestart(options);
  } catch (error) {
    report = fallbackReport(error, options);
  }
  writeReport(report, outputDir);
  fs.writeFileSync(
    path.join(outputDir, "hostinger-runtime-identity-authority.json"),
    `${JSON.stringify(report.runtime_identity_authority, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify({
    outcome: report.outcome,
    classification: report.classification,
    restart_performed: report.restart?.performed === true,
    runtime_identity_authority: report.runtime_identity_authority?.mode || IDENTITY_AUTHORITY,
    secrets_included: false,
  }));
  if (report.outcome !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
