#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CONTRACT = "mad4b.hostinger-guard-summary.v1";
export const WORKFLOW = "Hostinger Storage Tenant Canary Guard";
export const GUARD_KEY = "hostinger-storage-tenant-canary";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_DIAGNOSTIC_CHARS = 2000;
const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

const SYNTAX_FILES = [
  "http-generic-api/hostingerStorageTenantCanaryPolicyBase.js",
  "http-generic-api/hostingerStorageTenantCanaryPolicy.js",
  "http-generic-api/hostingerStorageTenantCanaryBase.js",
  "http-generic-api/hostingerStorageTenantCanary.js",
  "http-generic-api/test-hostinger-storage-tenant-canary.mjs",
  "http-generic-api/test-hostinger-storage-tenant-canary-authority-cas.mjs",
  "http-generic-api/test-hostinger-storage-tenant-canary-postmerge-hardening.mjs",
  "http-generic-api/test-hostinger-storage-tenant-canary-token-normalization.mjs",
  "http-generic-api/test-hostinger-storage-tenant-canary-token-delegation.mjs",
  "http-generic-api/test-hostinger-storage-tenant-canary-store-provenance.mjs",
  ".github/tests/spec014/tenant-canary-repository-provenance.mjs",
  "http-generic-api/test-hostinger-storage-tenant-canary-base-import-boundary.mjs",
  "http-generic-api/scripts/hostinger-tenant-canary-ci.mjs"
];

const TENANT_RUNTIME_FILES = [
  "http-generic-api/hostingerStorageTenantCanaryPolicyBase.js",
  "http-generic-api/hostingerStorageTenantCanaryPolicy.js",
  "http-generic-api/hostingerStorageTenantCanaryBase.js",
  "http-generic-api/hostingerStorageTenantCanary.js"
];

const TENANT_TESTS = [
  "test-hostinger-storage-tenant-canary.mjs",
  "test-hostinger-storage-tenant-canary-authority-cas.mjs",
  "test-hostinger-storage-tenant-canary-postmerge-hardening.mjs",
  "test-hostinger-storage-tenant-canary-token-normalization.mjs",
  "test-hostinger-storage-tenant-canary-token-delegation.mjs",
  "test-hostinger-storage-tenant-canary-store-provenance.mjs",
  "../.github/tests/spec014/tenant-canary-repository-provenance.mjs"
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function requireIncludes(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`${label}: missing required marker ${needle}`);
}

function requireExcludes(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`${label}: forbidden pattern ${pattern}`);
}

export function redactBounded(value, max = MAX_DIAGNOSTIC_CHARS) {
  return String(value ?? "")
    .replace(/gh[pousr]_[A-Za-z0-9_]{16,}/gu, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(/\b(authorization|api[_-]?key|token|password|secret)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .slice(-max);
}

function runCommand(command, args, { cwd = ROOT, timeout = 180000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, CI: "true" }
  });
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const errorText = result.error ? `${result.error.name}: ${result.error.message}` : "";
  return {
    exit_code: exitCode,
    duration_ms: Date.now() - started,
    stdout_tail: redactBounded(result.stdout),
    stderr_tail: redactBounded([result.stderr, errorText].filter(Boolean).join("\n"))
  };
}

function runNodeFiles(files, options = {}) {
  const outputs = [];
  let duration = 0;
  for (const file of files) {
    const result = runCommand("node", [file], options);
    duration += result.duration_ms;
    outputs.push({ file, ...result });
    if (result.exit_code !== 0) {
      return {
        exit_code: result.exit_code,
        duration_ms: duration,
        stdout_tail: redactBounded(outputs.map((item) => `[${item.file}]\n${item.stdout_tail}`).join("\n")),
        stderr_tail: redactBounded(outputs.map((item) => `[${item.file}]\n${item.stderr_tail}`).join("\n"))
      };
    }
  }
  return {
    exit_code: 0,
    duration_ms: duration,
    stdout_tail: redactBounded(outputs.map((item) => `[${item.file}]\n${item.stdout_tail}`).join("\n")),
    stderr_tail: redactBounded(outputs.map((item) => `[${item.file}]\n${item.stderr_tail}`).join("\n"))
  };
}

function runInProcess(check) {
  const started = Date.now();
  try {
    check();
    return { exit_code: 0, duration_ms: Date.now() - started, stdout_tail: "", stderr_tail: "" };
  } catch (error) {
    return {
      exit_code: 1,
      duration_ms: Date.now() - started,
      stdout_tail: "",
      stderr_tail: redactBounded(error?.stack || error?.message || String(error))
    };
  }
}

function checkSyntheticBoundary() {
  const combined = TENANT_RUNTIME_FILES.map((file) => read(file)).join("\n");
  requireExcludes(
    combined,
    /from ['"]node:(?:child_process|fs|fs\/promises|net|tls)['"]|require\(['"](?:child_process|fs|net|tls)['"]\)|\b(?:exec|execFile|spawn|fork)\s*\(|shell\s*:\s*true|StrictHostKeyChecking=no|rm\s+-rf/gu,
    "Tenant runtime"
  );
  const base = read("http-generic-api/hostingerStorageTenantCanaryBase.js");
  const policyBase = read("http-generic-api/hostingerStorageTenantCanaryPolicyBase.js");
  requireIncludes(base, "synthetic_only: true", "Tenant base");
  requireIncludes(base, "production_ready: false", "Tenant base");
  for (const marker of [
    "dispatch_allowed: false",
    "manual_one_shot",
    "tenant_exclusive",
    "immutable_plan",
    "STORAGE_TENANT_CANARY_CANDIDATE_ITEMS_MISMATCH",
    "STORAGE_TENANT_CANARY_PATH_PREFIX_BOUNDARY_REQUIRED",
    "STORAGE_TENANT_CANARY_PROTOCOL_VERSION_INVALID"
  ]) requireIncludes(policyBase, marker, "Tenant policy base");
}

function checkRuntimeProvenance() {
  const base = read("http-generic-api/hostingerStorageTenantCanaryBase.js");
  const wrapper = read("http-generic-api/hostingerStorageTenantCanary.js");
  const storeTest = read("http-generic-api/test-hostinger-storage-tenant-canary-store-provenance.mjs");
  const repositoryTest = read(".github/tests/spec014/tenant-canary-repository-provenance.mjs");
  const importTest = read("http-generic-api/test-hostinger-storage-tenant-canary-base-import-boundary.mjs");
  for (const marker of [
    "const tenantCanaryAdapters = new WeakSet()",
    "const tenantCanaryRepositories = new WeakSet()",
    "const tenantCanaryAuthorityStores = new WeakSet()",
    "const tenantCanaryEnablementRegistries = new WeakSet()",
    "tenantCanaryAdapters.add(adapter)",
    "tenantCanaryAdapters.has(adapter)",
    "tenantCanaryRepositories.add(repository)",
    "tenantCanaryRepositories.has(repository)",
    "tenantCanaryAuthorityStores.add(store)",
    "tenantCanaryAuthorityStores.has(store)",
    "tenantCanaryEnablementRegistries.add(registry)",
    "tenantCanaryEnablementRegistries.has(registry)",
    "isCanonicalHostingerStorageSyntheticAdapter(adapter)",
    "isCanonicalHostingerStorageControlPlaneRepository(repository)",
    "tenant_and_synthetic_factory_owned_required",
    "tenant_and_control_plane_factory_owned_required",
    "authority_store_provenance",
    "enablement_registry_provenance",
    "Object.getOwnPropertyDescriptors",
    "STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID",
    "STORAGE_TENANT_CANARY_ALLOWLIST_TOKEN_REUSED",
    "STORAGE_TENANT_CANARY_APPROVAL_TOKEN_REUSED",
    "authority_context_hash",
    "ownership_revision",
    "policy_revision"
  ]) requireIncludes(base, marker, "Tenant base provenance");
  requireIncludes(wrapper, "from './hostingerStorageTenantCanaryBase.js';", "Tenant wrapper");
  requireExcludes(wrapper, /executeBaseTenantCanary/gu, "Tenant wrapper");
  requireIncludes(storeTest, "authority_store_factory_brand_required: true", "Store provenance test");
  requireIncludes(storeTest, "enablement_registry_factory_brand_required: true", "Store provenance test");
  requireIncludes(repositoryTest, "direct_control_plane_repository_rejected: true", "Repository provenance test");
  requireIncludes(repositoryTest, "missing_adapter_is_explicit_null: true", "Repository provenance test");
  requireIncludes(repositoryTest, "existing_ast_and_store_provenance_tests_preserved: true", "Repository provenance test");
  requireIncludes(importTest, "typescript_ast", "Base import boundary test");
}

function checkPolicyNotBefore() {
  const policy = read("http-generic-api/hostingerStorageTenantCanaryPolicy.js");
  const test = read("http-generic-api/test-hostinger-storage-tenant-canary.mjs");
  for (const marker of [
    "STORAGE_TENANT_CANARY_EVALUATION_NOT_STARTED",
    "STORAGE_TENANT_CANARY_ALLOWLIST_NOT_STARTED",
    "STORAGE_TENANT_CANARY_APPROVAL_NOT_STARTED",
    "STORAGE_TENANT_CANARY_ENABLEMENT_NOT_STARTED"
  ]) requireIncludes(policy, marker, "Tenant policy");
  requireIncludes(test, "Object.isFrozen(verified.blockers)", "Tenant canary test");
}

function checkPreConsumptionOrder() {
  const source = read("http-generic-api/hostingerStorageTenantCanaryBase.js");
  const executeStart = source.indexOf("export function executeHostingerStorageTenantCanary({");
  if (executeStart < 0) throw new Error("Tenant execute function is missing.");
  const body = source.slice(executeStart);
  const ordered = [
    "requireAuthorityStore(authority_store);",
    "requireRegistry(enablement_registry);",
    "requireControlPlaneRepository(repository);",
    "revalidateCurrentAuthority({ authorization, authorityStore: authority_store, now });",
    "preflightSyntheticExecutorInputs({ protocol, protocolDigest: protocol_digest, repository, adapter, now });",
    "enablement_registry.consume({"
  ].map((needle) => ({ needle, index: body.indexOf(needle) }));
  for (const item of ordered) if (item.index < 0) throw new Error(`Missing ordered marker: ${item.needle}`);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].index <= ordered[index - 1].index) {
      throw new Error(`Tenant validation order violation: ${ordered[index].needle}`);
    }
  }
  const preflightStart = source.indexOf("function preflightSyntheticExecutorInputs({");
  if (preflightStart < 0 || preflightStart >= executeStart) throw new Error("Tenant preflight function boundary is invalid.");
  const preflightBody = source.slice(preflightStart, executeStart);
  const preflightOrdered = [
    "tenantCanaryAdapters.has(adapter)",
    "isCanonicalHostingerStorageSyntheticAdapter(adapter)",
    "repository.readAggregate(protocol.operation_id)",
    "plan.authority_context_hash !== aggregate.operation.authority_context_hash",
    "plan.ownership_revision !== aggregate.operation.ownership_revision",
    "plan.policy_revision !== aggregate.operation.policy_revision"
  ].map((needle) => ({ needle, index: preflightBody.indexOf(needle) }));
  for (const item of preflightOrdered) if (item.index < 0) throw new Error(`Missing preflight marker: ${item.needle}`);
  for (let index = 1; index < preflightOrdered.length; index += 1) {
    if (preflightOrdered[index].index <= preflightOrdered[index - 1].index) {
      throw new Error(`Tenant preflight order violation: ${preflightOrdered[index].needle}`);
    }
  }
}

const CHECKS = Object.freeze([
  {
    id: "deterministic-dependencies",
    run: () => runCommand("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { timeout: 240000 })
  },
  {
    id: "syntax",
    run: () => {
      const results = [];
      let duration = 0;
      for (const file of SYNTAX_FILES) {
        const result = runCommand("node", ["--check", file]);
        results.push({ file, ...result });
        duration += result.duration_ms;
        if (result.exit_code !== 0) {
          return {
            exit_code: result.exit_code,
            duration_ms: duration,
            stdout_tail: redactBounded(results.map((item) => `[${item.file}]\n${item.stdout_tail}`).join("\n")),
            stderr_tail: redactBounded(results.map((item) => `[${item.file}]\n${item.stderr_tail}`).join("\n"))
          };
        }
      }
      return { exit_code: 0, duration_ms: duration, stdout_tail: "", stderr_tail: "" };
    }
  },
  { id: "synthetic-boundary", run: () => runInProcess(checkSyntheticBoundary) },
  {
    id: "base-import-boundary",
    run: () => runCommand("node", ["http-generic-api/test-hostinger-storage-tenant-canary-base-import-boundary.mjs"])
  },
  { id: "runtime-provenance", run: () => runInProcess(checkRuntimeProvenance) },
  { id: "policy-not-before", run: () => runInProcess(checkPolicyNotBefore) },
  { id: "pre-consumption-order", run: () => runInProcess(checkPreConsumptionOrder) },
  {
    id: "tenant-canary-suite",
    run: () => runNodeFiles(TENANT_TESTS, { cwd: path.join(ROOT, "http-generic-api"), timeout: 240000 })
  }
]);

export function buildTenantCanaryReport({ candidateSha, rawResults, generatedAt = new Date().toISOString() }) {
  const results = rawResults.map((item) => ({
    check_id: item.check_id,
    outcome: item.exit_code === 0 ? "passed" : "failed",
    exit_code: item.exit_code,
    duration_ms: item.duration_ms,
    stdout_tail: redactBounded(item.stdout_tail),
    stderr_tail: redactBounded(item.stderr_tail),
    secrets_included: false
  }));
  const passed = results.filter((item) => item.outcome === "passed").length;
  const failed = results.length - passed;
  const firstFailed = results.find((item) => item.outcome === "failed") || null;
  const integrityFindings = [];
  if (!SHA_PATTERN.test(candidateSha || "")) {
    integrityFindings.push({ code: "INVALID_CANDIDATE_SHA", detail: "CI_SOURCE_HEAD_SHA must be a full lowercase SHA." });
  }
  if (results.length !== CHECKS.length) {
    integrityFindings.push({ code: "INCOMPLETE_CHECK_SET", detail: `Expected ${CHECKS.length} checks and received ${results.length}.` });
  }
  const outcome = failed === 0 && integrityFindings.length === 0 ? "passed" : "failed";
  return {
    contract: CONTRACT,
    schema_version: 1,
    workflow: WORKFLOW,
    guard_key: GUARD_KEY,
    identity: {
      candidate_kind: "head",
      candidate_sha: candidateSha || "unknown"
    },
    generated_at: generatedAt,
    outcome,
    checks: {
      selected_count: results.length,
      passed_count: passed,
      failed_count: failed
    },
    results,
    first_failure: firstFailed ? {
      code: "HOSTINGER_GUARD_CHECK_FAILED",
      check_id: firstFailed.check_id,
      exit_code: firstFailed.exit_code,
      stdout_tail: firstFailed.stdout_tail,
      stderr_tail: firstFailed.stderr_tail
    } : null,
    integrity_findings: integrityFindings,
    repository_mutation_performed: false,
    provider_dispatch_performed: false,
    credential_access_performed: false,
    job_logs_consulted: false,
    secrets_included: false
  };
}

export function validateTenantCanaryReport(report) {
  if (report?.contract !== CONTRACT) throw new Error("Canonical Hostinger report contract mismatch.");
  if (report?.workflow !== WORKFLOW || report?.guard_key !== GUARD_KEY) throw new Error("Canonical Hostinger report identity mismatch.");
  if (report?.identity?.candidate_kind !== "head" || !SHA_PATTERN.test(report?.identity?.candidate_sha || "")) {
    throw new Error("Canonical Hostinger report candidate identity is invalid.");
  }
  if (report?.secrets_included !== false || report?.job_logs_consulted !== false) {
    throw new Error("Canonical Hostinger report must be secret-free and log-independent.");
  }
  if (!Array.isArray(report?.results) || !Array.isArray(report?.integrity_findings)) {
    throw new Error("Canonical Hostinger report result arrays are invalid.");
  }
  const selected = report?.checks?.selected_count;
  const passed = report?.checks?.passed_count;
  const failed = report?.checks?.failed_count;
  if (![selected, passed, failed].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error("Canonical Hostinger report counts are invalid.");
  }
  if (selected !== report.results.length || passed + failed !== selected || selected !== CHECKS.length) {
    throw new Error("Canonical Hostinger report counts are inconsistent.");
  }
  if (report.outcome === "passed") {
    if (failed !== 0 || report.integrity_findings.length !== 0 || report.first_failure !== null) {
      throw new Error("Passed Canonical Hostinger report contains a failure.");
    }
  } else if (report.outcome === "failed") {
    if (failed === 0 && report.integrity_findings.length === 0) throw new Error("Failed Canonical Hostinger report has no blocker.");
  } else {
    throw new Error("Canonical Hostinger report outcome is invalid.");
  }
  return true;
}

function renderMarkdown(report) {
  const lines = [
    "# Hostinger Storage Tenant Canary — Canonical CI Evidence",
    "",
    `- Contract: \`${report.contract}\``,
    `- Candidate kind: \`${report.identity.candidate_kind}\``,
    `- Candidate SHA: \`${report.identity.candidate_sha}\``,
    `- Outcome: **${report.outcome}**`,
    `- Checks: ${report.checks.passed_count}/${report.checks.selected_count} passed; ${report.checks.failed_count} failed`,
    `- Integrity findings: ${report.integrity_findings.length}`,
    "- Job logs consulted: false",
    "- Secrets included: false",
    "- Repository mutation performed: false",
    "- Provider dispatch performed: false",
    "",
    "## Check results",
    ""
  ];
  for (const result of report.results) {
    lines.push(`- \`${result.check_id}\`: **${result.outcome}** (exit ${result.exit_code}, ${result.duration_ms} ms)`);
  }
  if (report.first_failure) {
    lines.push("", "## First failure", "", `- Check: \`${report.first_failure.check_id}\``, `- Code: \`${report.first_failure.code}\``);
    if (report.first_failure.stderr_tail) lines.push("", "```text", report.first_failure.stderr_tail, "```");
  }
  if (report.integrity_findings.length) {
    lines.push("", "## Integrity findings", "");
    for (const finding of report.integrity_findings) lines.push(`- \`${finding.code}\`: ${finding.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseReportDir(argv) {
  const index = argv.indexOf("--report-dir");
  if (index < 0) return process.env.REPORT_DIR || path.join(ROOT, ".ci-evidence", GUARD_KEY);
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--report-dir requires a value.");
  return path.resolve(value);
}

export async function runTenantCanaryCi(argv = process.argv.slice(2)) {
  const reportDir = parseReportDir(argv);
  fs.mkdirSync(reportDir, { recursive: true });
  const rawResults = [];
  for (const check of CHECKS) {
    const result = check.run();
    rawResults.push({ check_id: check.id, ...result });
  }
  const report = buildTenantCanaryReport({
    candidateSha: process.env.CI_SOURCE_HEAD_SHA || process.env.GITHUB_SHA || "unknown",
    rawResults
  });
  fs.writeFileSync(path.join(reportDir, "hostinger-storage-tenant-canary-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "hostinger-storage-tenant-canary-summary.md"), renderMarkdown(report));
  validateTenantCanaryReport(report);
  process.stdout.write(`${JSON.stringify({
    ok: report.outcome === "passed",
    contract: report.contract,
    candidate_sha: report.identity.candidate_sha,
    outcome: report.outcome,
    selected_count: report.checks.selected_count,
    passed_count: report.checks.passed_count,
    failed_count: report.checks.failed_count,
    first_failure: report.first_failure?.check_id || null,
    job_logs_consulted: false,
    secrets_included: false
  })}\n`);
  if (report.outcome !== "passed") process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runTenantCanaryCi().catch((error) => {
    console.error(redactBounded(error?.stack || error?.message || String(error)));
    process.exitCode = 1;
  });
}
