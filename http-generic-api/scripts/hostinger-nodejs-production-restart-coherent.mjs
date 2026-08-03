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
const ATTEMPT_JOURNAL_FILE = "hostinger-nodejs-production-restart-attempt.json";
const DIRECT_SHA_FIELDS = Object.freeze([
  "commit_sha",
  "commit",
  "deployed_commit_sha",
  "sha",
  "revision_sha",
  "revision",
]);
const DIRECT_BRANCH_FIELDS = Object.freeze([
  "branch",
  "deployment_branch",
]);

function firstDirectString(body, fields) {
  if (!body || Array.isArray(body) || typeof body !== "object") return null;
  for (const field of fields) {
    const value = body[field];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function extractDirectIdentity(body) {
  const rawSha = firstDirectString(body, DIRECT_SHA_FIELDS);
  const rawBranch = firstDirectString(body, DIRECT_BRANCH_FIELDS);
  const sha = rawSha && SHA_PATTERN.test(rawSha.toLowerCase()) ? rawSha.toLowerCase() : null;
  const branch = rawBranch || null;
  return { sha, branch };
}

function hasCoherentExpectedIdentity(body, configuration) {
  const identity = extractDirectIdentity(body);
  return identity.sha === configuration.expectedSha
    && identity.branch === configuration.expectedBranch;
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
  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  const rewritten = transform(body);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (!headers.get("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(rewritten), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function authorizedRestartPath(configuration) {
  return `/api/hosting/v1/accounts/${encodeURIComponent(configuration.accountUsername)}/websites/${encodeURIComponent(configuration.domain)}/nodejs/server/restart`;
}

function attemptJournalPath(configuration) {
  return path.join(configuration.outputDir, ATTEMPT_JOURNAL_FILE);
}

function persistAttemptJournal(configuration) {
  fs.mkdirSync(configuration.outputDir, { recursive: true });
  const journal = {
    contract: "mad4b.hostinger-nodejs-production-restart-attempt.v1",
    recorded_at: new Date().toISOString(),
    expected_sha: configuration.expectedSha,
    expected_branch: configuration.expectedBranch,
    expected_build_uuid: configuration.expectedBuildUuid,
    domain: configuration.domain,
    provider_method: "POST",
    provider_path: authorizedRestartPath(configuration),
    restart_attempted: true,
    provider_mutation_attempted: true,
    secrets_included: false,
  };
  fs.writeFileSync(
    attemptJournalPath(configuration),
    `${JSON.stringify(journal, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function createCoherentRuntimeFetch(configuration, fetchImpl = fetch, mutationState = { attempted: false }) {
  const restartPath = authorizedRestartPath(configuration);
  return async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const pathname = new URL(String(url)).pathname;
    if (method === "POST" && pathname === restartPath) {
      persistAttemptJournal(configuration);
      mutationState.attempted = true;
    }

    const response = await fetchImpl(url, init);
    if (method !== "GET") return response;

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
  const mutationState = { attempted: false };
  const fetchImpl = createCoherentRuntimeFetch(configuration, rawFetch, mutationState);
  const report = await executeBaseRestart(options, { ...dependencies, fetchImpl });

  report.restart = report.restart || { requested: false, performed: false, response_status: null };
  report.restart.attempted = mutationState.attempted;
  report.side_effects = report.side_effects || {};
  report.side_effects.provider_mutation_attempted = mutationState.attempted;
  if (mutationState.attempted && report.restart.performed !== true && report.outcome !== "passed") {
    report.classification = "restart_attempted_outcome_unconfirmed";
  }

  report.runtime_identity_authority = {
    contract: "mad4b.hostinger-runtime-identity-authority.v1",
    authoritative_endpoint: "/deployment-info",
    required_pair: {
      sha: configuration.expectedSha,
      branch: configuration.expectedBranch,
    },
    schema_scope: "top_level_direct_identity_fields",
    accepted_sha_fields: [...DIRECT_SHA_FIELDS],
    accepted_branch_fields: [...DIRECT_BRANCH_FIELDS],
    cross_endpoint_composition_allowed: false,
    cross_object_composition_allowed: false,
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
      schema_scope: "top_level_direct_identity_fields",
      accepted_sha_fields: [...DIRECT_SHA_FIELDS],
      accepted_branch_fields: [...DIRECT_BRANCH_FIELDS],
      cross_endpoint_composition_allowed: false,
      cross_object_composition_allowed: false,
      version_endpoint_authoritative: false,
      mode: IDENTITY_AUTHORITY,
    },
    outcome: "failed",
    classification: "restart_configuration_failed",
    precondition: null,
    pre_runtime: null,
    restart: { requested: false, attempted: false, performed: false, response_status: null },
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
      provider_mutation_attempted: false,
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
    restart_attempted: report.restart?.attempted === true,
    restart_performed: report.restart?.performed === true,
    runtime_identity_authority: report.runtime_identity_authority?.mode || IDENTITY_AUTHORITY,
    secrets_included: false,
  }));
  if (report.outcome !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
