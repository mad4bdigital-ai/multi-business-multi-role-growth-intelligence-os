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
const PRE_MUTATION_AUTHORITY_CONTRACT = "mad4b.hostinger-pre-mutation-authority.v1";
const ATTEMPT_JOURNAL_FILE = "hostinger-nodejs-production-restart-attempt.json";
const RESTART_MARKER_PREFIX = "HOSTINGER_PRODUCTION_NODEJS_RESTART";
const MARKER_KEY_PATTERN = /^[a-z][a-z0-9_]*$/u;
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

function collectDirectFields(body, fields) {
  if (!body || Array.isArray(body) || typeof body !== "object") return [];
  return fields
    .filter((field) => Object.hasOwn(body, field))
    .map((field) => ({ field, raw: body[field] }));
}

function resolveDirectConsensus(body, fields, normalize, validate) {
  const entries = collectDirectFields(body, fields);
  if (entries.length === 0) {
    return { value: null, present: false, invalid: false, conflict: false, fields: [] };
  }
  const normalized = [];
  let invalid = false;
  for (const entry of entries) {
    if (typeof entry.raw !== "string") {
      invalid = true;
      continue;
    }
    const value = normalize(entry.raw);
    if (!value || !validate(value)) {
      invalid = true;
      continue;
    }
    normalized.push(value);
  }
  const unique = [...new Set(normalized)];
  const conflict = unique.length > 1;
  return {
    value: !invalid && !conflict && unique.length === 1 ? unique[0] : null,
    present: true,
    invalid,
    conflict,
    fields: entries.map((entry) => entry.field),
  };
}

function extractDirectIdentity(body) {
  const shaConsensus = resolveDirectConsensus(
    body,
    DIRECT_SHA_FIELDS,
    (value) => value.trim().toLowerCase(),
    (value) => SHA_PATTERN.test(value),
  );
  const branchConsensus = resolveDirectConsensus(
    body,
    DIRECT_BRANCH_FIELDS,
    (value) => value.trim(),
    (value) => Boolean(value),
  );
  return {
    sha: shaConsensus.value,
    branch: branchConsensus.value,
    sha_invalid: shaConsensus.invalid,
    branch_invalid: branchConsensus.invalid,
    sha_conflict: shaConsensus.conflict,
    branch_conflict: branchConsensus.conflict,
    sha_fields: shaConsensus.fields,
    branch_fields: branchConsensus.fields,
  };
}

function hasCoherentExpectedIdentity(body, configuration) {
  const identity = extractDirectIdentity(body);
  return identity.sha_invalid === false
    && identity.branch_invalid === false
    && identity.sha_conflict === false
    && identity.branch_conflict === false
    && identity.sha === configuration.expectedSha
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
  const journalPath = attemptJournalPath(configuration);
  const temporaryPath = `${journalPath}.${process.pid}.${Date.now()}.tmp`;
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
    pre_mutation_authority: "passed",
    secrets_included: false,
  };
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(fileDescriptor, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    fs.fsyncSync(fileDescriptor);
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
  }
  fs.renameSync(temporaryPath, journalPath);
  let directoryDescriptor;
  try {
    directoryDescriptor = fs.openSync(configuration.outputDir, "r");
    fs.fsyncSync(directoryDescriptor);
  } finally {
    if (directoryDescriptor !== undefined) fs.closeSync(directoryDescriptor);
  }
}

function authorityError(code, message, status = 0) {
  const error = new Error(message);
  error.name = "PreMutationAuthorityError";
  error.code = code;
  error.status = status;
  return error;
}

export function parseTrustedRestartMarker(comment) {
  if (comment?.user?.login !== "github-actions[bot]" || comment?.user?.type !== "Bot") return null;
  const id = Number(comment?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof comment?.body !== "string") return null;
  const body = comment.body.trim();
  if (!body || /[\r\n]/u.test(body)) return null;
  const tokens = body.split(/\s+/u);
  if (tokens.shift() !== RESTART_MARKER_PREFIX) return null;
  const fields = Object.create(null);
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator <= 0 || separator === token.length - 1) return null;
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (!MARKER_KEY_PATTERN.test(key) || Object.hasOwn(fields, key)) return null;
    fields[key] = value;
  }
  if (!fields.status || !fields.binding) return null;
  return { id, fields };
}

async function readGithubJson(url, { token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "mad4b-hostinger-production-restart-authority",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw authorityError("github_authority_transport_failed", "GitHub authority read failed.");
  }
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) {
    throw authorityError("github_authority_response_too_large", "GitHub authority response exceeded the bounded size.", response.status);
  }
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw authorityError("github_authority_response_invalid", "GitHub authority response was not valid JSON.", response.status);
  }
  if (!response.ok) {
    throw authorityError(
      "github_authority_http_error",
      `GitHub authority read returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return body;
}

function validateAuthorityOptions(options) {
  const repository = String(options.repository || "").trim();
  const controlIssue = String(options.controlIssue || "").trim();
  const expectedHeadSha = String(options.expectedHeadSha || "").trim().toLowerCase();
  const expectedProductionSha = String(options.expectedProductionSha || "").trim().toLowerCase();
  const bindingId = String(options.bindingId || "").trim();
  const runId = String(options.runId || "").trim();
  const token = String(options.token || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw authorityError("github_authority_repository_invalid", "GitHub authority repository is invalid.");
  }
  if (!/^[1-9][0-9]*$/u.test(controlIssue)) {
    throw authorityError("github_authority_issue_invalid", "GitHub authority issue number is invalid.");
  }
  if (!SHA_PATTERN.test(expectedHeadSha) || !SHA_PATTERN.test(expectedProductionSha)) {
    throw authorityError("github_authority_sha_invalid", "GitHub authority requires full lowercase main and Production SHAs.");
  }
  if (!bindingId || !runId || !token) {
    throw authorityError("github_authority_configuration_missing", "GitHub authority binding, run ID, and token are required.");
  }
  return { repository, controlIssue, expectedHeadSha, expectedProductionSha, bindingId, runId, token };
}

export function createGitHubPreMutationAuthorityRevalidator(options, fetchImpl = fetch) {
  const authority = validateAuthorityOptions(options);
  const apiBase = `https://api.github.com/repos/${authority.repository}`;
  return async () => {
    const [issue, mainRef, productionRef] = await Promise.all([
      readGithubJson(`${apiBase}/issues/${authority.controlIssue}`, { token: authority.token, fetchImpl }),
      readGithubJson(`${apiBase}/git/ref/heads/main`, { token: authority.token, fetchImpl }),
      readGithubJson(`${apiBase}/git/ref/heads/Production`, { token: authority.token, fetchImpl }),
    ]);
    if (issue?.state !== "open") {
      throw authorityError("control_issue_closed_before_restart", "Control issue closed before the provider mutation.");
    }
    const mainSha = String(mainRef?.object?.sha || "").toLowerCase();
    const productionSha = String(productionRef?.object?.sha || "").toLowerCase();
    if (mainSha !== authority.expectedHeadSha) {
      throw authorityError("main_head_changed_before_restart", "main changed after authorization and before the provider mutation.");
    }
    if (productionSha !== authority.expectedProductionSha) {
      throw authorityError("production_head_changed_before_restart", "Production changed after authorization and before the provider mutation.");
    }

    const comments = [];
    for (let page = 1; page <= 100; page += 1) {
      const batch = await readGithubJson(
        `${apiBase}/issues/${authority.controlIssue}/comments?per_page=100&page=${page}`,
        { token: authority.token, fetchImpl },
      );
      if (!Array.isArray(batch)) {
        throw authorityError("github_authority_comments_invalid", "GitHub authority comments response was not an array.");
      }
      comments.push(...batch);
      if (batch.length < 100) break;
      if (page === 100) {
        throw authorityError("github_authority_pagination_limit", "GitHub authority comments exceeded the bounded pagination limit.");
      }
    }

    const relevant = comments
      .map(parseTrustedRestartMarker)
      .filter(Boolean)
      .filter((marker) => marker.fields.binding === authority.bindingId)
      .sort((left, right) => left.id - right.id);
    const claims = relevant.filter((marker) => marker.fields.status === "claiming");
    const currentClaim = claims.filter((marker) =>
      marker.fields.expected_head_sha === authority.expectedHeadSha
      && marker.fields.run_id === authority.runId).at(-1);
    const latestClaim = claims.at(-1);
    if (!currentClaim) {
      throw authorityError("current_run_claim_missing_before_restart", "The current run claim is missing before the provider mutation.");
    }
    if (!latestClaim || currentClaim.id !== latestClaim.id) {
      throw authorityError("current_run_claim_superseded_before_restart", "The current run claim is not the latest claim for the exact binding.");
    }

    const consumed = relevant.some((marker) =>
      marker.id !== currentClaim.id
      && (marker.fields.status === "completed"
        || marker.fields.restart_attempted === "true"
        || marker.fields.restart_performed === "true"));
    if (consumed) {
      throw authorityError("restart_binding_consumed_before_mutation", "The exact restart binding was consumed before the provider mutation.");
    }
    const laterMarkers = relevant.filter((marker) => marker.id > currentClaim.id);
    if (laterMarkers.length > 0) {
      throw authorityError("restart_claim_changed_before_mutation", "A later restart marker appeared after the current run claim.");
    }

    return {
      contract: PRE_MUTATION_AUTHORITY_CONTRACT,
      status: "passed",
      checked_at: new Date().toISOString(),
      repository: authority.repository,
      control_issue: Number(authority.controlIssue),
      issue_open: true,
      main_sha: mainSha,
      production_sha: productionSha,
      binding: authority.bindingId,
      run_id: authority.runId,
      claim_comment_id: currentClaim.id,
      claim_is_latest: true,
      later_marker_count: 0,
      marker_parser: "strict_single_line_exact_fields_v1",
      secrets_included: false,
    };
  };
}

export function createCoherentRuntimeFetch(
  configuration,
  fetchImpl = fetch,
  mutationState = { attempted: false },
  authorityState = { result: null },
  beforeProviderMutation = null,
) {
  const restartPath = authorizedRestartPath(configuration);
  return async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const pathname = new URL(String(url)).pathname;
    if (method === "POST" && pathname === restartPath) {
      if (typeof beforeProviderMutation === "function") {
        try {
          authorityState.result = await beforeProviderMutation();
        } catch (error) {
          authorityState.result = {
            contract: PRE_MUTATION_AUTHORITY_CONTRACT,
            status: "failed",
            checked_at: new Date().toISOString(),
            failure_code: String(error?.code || "pre_mutation_authority_failed"),
            failure_message: String(error?.message || "Pre-mutation authority failed.").slice(0, 1_000),
            secrets_included: false,
          };
          throw error;
        }
      }
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
  const authorityState = { result: null };
  const fetchImpl = createCoherentRuntimeFetch(
    configuration,
    rawFetch,
    mutationState,
    authorityState,
    dependencies.beforeProviderMutation || null,
  );
  const report = await executeBaseRestart(options, { ...dependencies, fetchImpl });

  report.restart = report.restart || { requested: false, performed: false, response_status: null };
  report.restart.attempted = mutationState.attempted;
  report.side_effects = report.side_effects || {};
  report.side_effects.provider_mutation_attempted = mutationState.attempted;
  report.pre_mutation_authority = authorityState.result;
  if (authorityState.result?.status === "failed" && mutationState.attempted === false) {
    report.classification = "restart_precondition_failed";
    report.first_failure = {
      code: authorityState.result.failure_code || "pre_mutation_authority_failed",
      message: authorityState.result.failure_message || "Pre-mutation authority failed.",
      http_status: 0,
    };
  }
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
    direct_field_consensus_required: true,
    conflicting_direct_fields_allowed: false,
    invalid_direct_fields_allowed: false,
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
      direct_field_consensus_required: true,
      conflicting_direct_fields_allowed: false,
      invalid_direct_fields_allowed: false,
      cross_endpoint_composition_allowed: false,
      cross_object_composition_allowed: false,
      version_endpoint_authoritative: false,
      mode: IDENTITY_AUTHORITY,
    },
    pre_mutation_authority: null,
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

function authorityOptionsFromEnvironment() {
  return {
    repository: process.env.GITHUB_AUTH_REPOSITORY || process.env.GITHUB_REPOSITORY || "",
    controlIssue: process.env.GITHUB_AUTH_CONTROL_ISSUE || process.env.CONTROL_ISSUE || "",
    expectedHeadSha: process.env.GITHUB_AUTH_EXPECTED_HEAD_SHA || process.env.GITHUB_SHA || "",
    expectedProductionSha: process.env.GITHUB_AUTH_EXPECTED_PRODUCTION_SHA || process.env.EXPECTED_PRODUCTION_SHA || "",
    bindingId: process.env.GITHUB_AUTH_BINDING_ID || process.env.BINDING_ID || "",
    runId: process.env.GITHUB_AUTH_RUN_ID || process.env.GITHUB_RUN_ID || "",
    token: process.env.GITHUB_AUTH_TOKEN || "",
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
    const beforeProviderMutation = createGitHubPreMutationAuthorityRevalidator(
      authorityOptionsFromEnvironment(),
      fetch,
    );
    report = await executeGovernedRestart(options, { beforeProviderMutation });
  } catch (error) {
    report = fallbackReport(error, options);
  }
  writeReport(report, outputDir);
  fs.writeFileSync(
    path.join(outputDir, "hostinger-runtime-identity-authority.json"),
    `${JSON.stringify(report.runtime_identity_authority, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(outputDir, "hostinger-pre-mutation-authority.json"),
    `${JSON.stringify(report.pre_mutation_authority, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify({
    outcome: report.outcome,
    classification: report.classification,
    restart_attempted: report.restart?.attempted === true,
    restart_performed: report.restart?.performed === true,
    pre_mutation_authority: report.pre_mutation_authority?.status || "not_required",
    runtime_identity_authority: report.runtime_identity_authority?.mode || IDENTITY_AUTHORITY,
    secrets_included: false,
  }));
  if (report.outcome !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
