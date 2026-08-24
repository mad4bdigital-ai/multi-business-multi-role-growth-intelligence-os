import { Router } from "express";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readDeploymentManifest } from "../deploymentManifest.js";
import { getGovernanceDbPrivilegeReadinessSnapshot } from "../governanceDbPrivilegeReadinessRuntime.js";
import {
  getMcpCatalogSchemaStartupPreflight,
  readMcpCatalogSchemaReadinessSafe,
} from "../mcpCatalogSchemaGuard.js";
import { inspectRuntimeIntegrity } from "../runtimeIntegrity.js";
import { runProductionActivationReadiness } from "../productionActivationReadiness.js";
import { getRuntimeBootstrapStatus } from "../runtimeBootstrapStatus.js";
import {
  readRuntimeBootstrapContract,
  runBootstrap,
  sanitizeBootstrapError,
} from "../runtimeBootstrapContract.js";
import {
  buildHostLocalRoleInspectionRequest,
  executeHostLocalRoleInspection,
} from "../hostLocalRuntimeInspection.js";

async function fileMtimeIso(file) {
  try {
    const s = await stat(file);
    return s?.mtime ? new Date(s.mtime).toISOString() : null;
  } catch {
    return null;
  }
}

async function readJsonFile(file) {
  try {
    const raw = await readFile(file, "utf8");
    const json = JSON.parse(raw);
    return { json, mtime: await fileMtimeIso(file), file };
  } catch {
    return null;
  }
}

async function readDeploymentCommit() {
  const candidates = [
    path.resolve(process.cwd(), "DEPLOYMENT_COMMIT.json"),
    path.resolve(process.cwd(), "http-generic-api", "DEPLOYMENT_COMMIT.json"),
  ];
  for (const file of candidates) {
    const value = await readJsonFile(file);
    if (value?.json) return { ...value.json, _source_file: value.file, _source_mtime: value.mtime };
  }
  return null;
}

function sanitizeDeploymentManifest(deployment, fallbackSource = "DEPLOYMENT_COMMIT.json") {
  if (!deployment) return { present: false };
  const safe = { ...deployment };
  delete safe._source_file;
  safe.present = true;
  safe.source = String(deployment.source || fallbackSource);
  safe.source_file_detected = Boolean(deployment._source_file || deployment.source);
  safe.source_mtime = deployment._source_mtime || null;
  return safe;
}

function firstString(...values) {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return null;
}

function normalizeIso(value) {
  const str = String(value || "").trim();
  if (!str) return null;
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstIso(...values) {
  for (const value of values) {
    const iso = normalizeIso(value);
    if (iso) return iso;
  }
  return null;
}

function hashRuntimeValue(value) {
  const normalized = String(value || "").trim();
  return normalized ? crypto.createHash("sha256").update(normalized, "utf8").digest("hex") : null;
}

function buildRuntimeBindingEvidence(env = {}) {
  const database = String(env.DB_NAME || "").trim();
  const governanceDatabase = String(env.GOVERNANCE_DB_NAME || database).trim();
  const principal = String(env.DB_USER || "").trim();
  const principalHost = String(env.DB_PRINCIPAL_HOST || "localhost").trim();
  return {
    contract: "mad4b.hostinger.runtime-binding-evidence.v1",
    configured: Boolean(database && principal),
    database_sha256: hashRuntimeValue(database),
    governance_database_sha256: hashRuntimeValue(governanceDatabase),
    principal_sha256: hashRuntimeValue(principal),
    principal_host_sha256: hashRuntimeValue(principalHost),
    source: "runtime_process_env",
    raw_values_exposed: false,
    secrets_included: false,
    database_connection_performed: false,
    database_mutation_performed: false,
  };
}

function readRuntimeSourceIdentity() {
  const manifestResult = readDeploymentManifest();
  const manifest = manifestResult.ok ? manifestResult.manifest : null;
  const commit = firstString(
    manifest?.commit_sha,
    process.env.GITHUB_SHA,
    process.env.DEPLOY_COMMIT,
    process.env.COMMIT_SHA,
    process.env.REVISION_SHA,
  );
  const branch = firstString(
    manifest?.branch,
    process.env.GITHUB_REF_NAME,
    process.env.DEPLOY_BRANCH,
    process.env.BRANCH_NAME,
  );
  return {
    commit: commit ? commit.toLowerCase() : null,
    branch,
    repository: firstString(manifest?.repository, process.env.GITHUB_REPOSITORY, process.env.DEPLOY_REPOSITORY),
    source: manifest?.source || (manifest ? "deployment_manifest" : "runtime_env"),
  };
}

function sourceFor(value, pairs = []) {
  if (!value) return "unavailable";
  for (const [source, candidate] of pairs) {
    if (String(candidate || "").trim() === value) return source;
    if (normalizeIso(candidate) && normalizeIso(candidate) === value) return source;
  }
  return "derived";
}

function looksLikeSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || "").trim());
}

function branchFromRef(refName) {
  const value = String(refName || "").trim();
  if (!value.startsWith("refs/heads/")) return null;
  return value.slice("refs/heads/".length) || null;
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function findGitDir() {
  const candidates = [
    path.resolve(process.cwd(), ".git"),
    path.resolve(process.cwd(), "..", ".git"),
    path.resolve(process.cwd(), "http-generic-api", "..", ".git"),
  ];
  for (const candidate of candidates) {
    const head = await readText(path.join(candidate, "HEAD"));
    if (head) return candidate;
  }
  return null;
}

async function readPackedRef(gitDir, refName) {
  const raw = await readText(path.join(gitDir, "packed-refs"));
  if (!raw) return null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === refName && looksLikeSha(sha)) return sha;
  }
  return null;
}

async function readGitCheckoutInfo() {
  const gitDir = await findGitDir();
  if (!gitDir) return null;
  const headFile = path.join(gitDir, "HEAD");
  const headRaw = String(await readText(headFile) || "").trim();
  if (!headRaw) return null;
  const headMtime = await fileMtimeIso(headFile);

  if (looksLikeSha(headRaw)) {
    return { branch: null, commit_sha: headRaw, git_source: "git_head_detached", git_dir_detected: true, head_mtime: headMtime };
  }

  const m = headRaw.match(/^ref:\s*(.+)$/);
  if (!m) return null;
  const refName = m[1].trim();
  const refFile = path.join(gitDir, refName);
  const directSha = String(await readText(refFile) || "").trim();
  const packedSha = directSha ? null : await readPackedRef(gitDir, refName);
  const commitSha = looksLikeSha(directSha) ? directSha : packedSha;
  const refMtime = await fileMtimeIso(refFile);
  return {
    branch: branchFromRef(refName),
    commit_sha: commitSha || null,
    git_ref: refName,
    git_source: commitSha ? (directSha ? "git_ref_file" : "git_packed_refs") : "git_ref_unresolved",
    git_dir_detected: true,
    head_mtime: headMtime,
    ref_mtime: refMtime,
  };
}

function runtimeIntegrityFailure(reason = "runtime_integrity_readback_failed") {
  return {
    contract: "mad4b.runtime-integrity.v1",
    state: "degraded",
    verified: false,
    tracked_checkout_clean: false,
    local_application_code_mutation_detected: false,
    dirty_tracked_file_count: 0,
    expected_commit_sha_available: false,
    checkout_commit_sha_available: false,
    commit_matches: null,
    checkout_detected: false,
    readback_available: false,
    provenance_verified: false,
    provenance_source: null,
    read_only_check: true,
    untracked_files_ignored: true,
    reason_codes: [reason],
    secrets_included: false,
  };
}

export function buildDeploymentInfoRoutes({
  runtimeIntegrityReader = inspectRuntimeIntegrity,
  governanceDbReadinessReader = getGovernanceDbPrivilegeReadinessSnapshot,
  mcpCatalogSchemaReadinessReader = readMcpCatalogSchemaReadinessSafe,
  productionActivationReadinessReader = runProductionActivationReadiness,
  runtimeBootstrapStatusReader = getRuntimeBootstrapStatus,
  runtimeBootstrapReader = runBootstrap,
  hostLocalInspectionReader = executeHostLocalRoleInspection,
  requireBackendApiKey,
} = {}) {
  const router = Router();

  async function requireBackendServiceApiKey(req, res) {
    if (typeof requireBackendApiKey !== "function") {
      res.status(503).json({
        ok: false,
        error: {
          code: "runtime_bootstrap_auth_unconfigured",
          message: "Host-side runtime bootstrap requires the backend API-key guard.",
          status: 503,
        },
        secrets_included: false,
      });
      return false;
    }
    let guardCompleted = false;
    const proceed = () => {
      guardCompleted = true;
    };
    await requireBackendApiKey(req, res, proceed);
    if (!guardCompleted || res.headersSent) return false;
    if (req.auth?.mode !== "backend_api_key" || req.auth?.is_admin !== true) {
      res.status(403).json({
        ok: false,
        error: {
          code: "backend_service_api_key_required",
          message: "This runtime bootstrap read path requires the dedicated backend service API key.",
          status: 403,
        },
        secrets_included: false,
      });
      return false;
    }
    return true;
  }

  router.post("/deployment-info/runtime-bootstrap-dry-run", async (req, res, next) => {
    if (!(await requireBackendServiceApiKey(req, res))) return;
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const expectedSha = String(body.expected_sha || "").trim().toLowerCase();
      const expectedBranch = String(body.expected_branch || "Production").trim();
      const expectedRepository = String(body.expected_repository || "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os").trim();
      const targetKey = String(body.target_key || "production-runtime").trim();
      const migration = String(body.migration || "").trim();
      if (!/^[0-9a-f]{40}$/iu.test(expectedSha)) {
        return res.status(400).json({ ok: false, error: { code: "runtime_bootstrap_expected_sha_invalid", message: "expected_sha must be a full 40-character SHA", details: {}, secrets_included: false }, secrets_included: false });
      }
      if (expectedBranch !== "Production" || expectedRepository !== "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" || !targetKey) {
        return res.status(400).json({ ok: false, error: { code: "runtime_bootstrap_binding_invalid", message: "Runtime bootstrap binding is invalid", details: {}, secrets_included: false }, secrets_included: false });
      }
      const runtimeIdentity = readRuntimeSourceIdentity();
      if (!runtimeIdentity.commit || runtimeIdentity.commit !== expectedSha || runtimeIdentity.branch !== expectedBranch) {
        return res.status(412).json({ ok: false, error: { code: "runtime_bootstrap_deployment_identity_mismatch", message: "The running deployment identity does not match expected_sha/expected_branch", details: { runtime_source: runtimeIdentity.source, runtime_commit_available: Boolean(runtimeIdentity.commit), runtime_branch_available: Boolean(runtimeIdentity.branch) }, secrets_included: false }, database_connection_performed: false, database_mutation_performed: false, migration_apply_performed: false, grant_mutation_performed: false, mutation_evidence: { mutation_attempted: false, mutation_state: "none", secrets_included: false }, raw_values_exposed: false, secrets_included: false });
      }
      const env = {
        ...process.env,
        BOOTSTRAP_MODE: "dry_run",
        BOOTSTRAP_TARGET_SOURCE: "runtime_env",
        BOOTSTRAP_EXPECTED_SHA: expectedSha,
        BOOTSTRAP_EXPECTED_BRANCH: expectedBranch,
        BOOTSTRAP_EXPECTED_REPOSITORY: expectedRepository,
        BOOTSTRAP_TARGET_KEY: targetKey,
        HOST_BREAKGLASS_OPERATION: "database.inspect",
        ...(migration ? { BOOTSTRAP_MIGRATION: migration } : {}),
      };
      const result = await runtimeBootstrapReader({ env, contract: readRuntimeBootstrapContract() });
      if (result.database_mutation_performed || result.migration_apply_performed || result.grant_mutation_performed) {
        return res.status(500).json({ ok: false, error: { code: "runtime_bootstrap_dry_run_mutation_flagged", message: "Dry-run returned an unsafe mutation flag", details: {}, secrets_included: false }, database_connection_performed: result.database_connection_performed === true, database_mutation_performed: false, migration_apply_performed: false, grant_mutation_performed: false, mutation_evidence: result.mutation_evidence, secrets_included: false });
      }
      return res.status(200).json({
        ...result,
        ok: result.ok !== false,
        operation: "read_only",
        target_source: "runtime_env",
        runtime_source: runtimeIdentity.source,
        runtime_deployment_sha: runtimeIdentity.commit,
        raw_values_exposed: false,
        secrets_included: false,
      });
    } catch (error) {
      const details = error?.details && typeof error.details === "object" ? { ...error.details } : {};
      return res.status(412).json({
        ok: false,
        contract: "mad4b.hostinger.runtime-bootstrap-evidence.v1",
        mode: "dry_run",
        operation: "read_only",
        target_source: "runtime_env",
        error: sanitizeBootstrapError(error),
        database_connection_performed: details.database_connection_performed === true,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        mutation_evidence: details.mutation_evidence || { mutation_attempted: false, mutation_state: "none", secrets_included: false },
        raw_values_exposed: false,
        secrets_included: false,
      });
    }
  });

  router.post("/deployment-info/runtime-bootstrap-role-dry-run", async (req, res) => {
    if (!(await requireBackendServiceApiKey(req, res))) return;
    try {
      const request = buildHostLocalRoleInspectionRequest(req.body && typeof req.body === "object" ? req.body : {});
      const runtimeIdentity = readRuntimeSourceIdentity();
      if (runtimeIdentity.commit !== request.expected_sha || runtimeIdentity.branch !== request.expected_branch || runtimeIdentity.repository !== request.expected_repository) {
        return res.status(412).json({
          ok: false,
          contract: "mad4b.host-breakglass-host-local-inspection.v1",
          mode: "dry_run",
          operation: "read_only",
          target_source: "host_local_role_env",
          error: {
            code: "host_local_runtime_identity_mismatch",
            message: "The running deployment identity does not match the exact Production SHA, branch, and repository.",
            details: {
              runtime_identity: {
                source: runtimeIdentity.source,
                commit_available: Boolean(runtimeIdentity.commit),
                branch_available: Boolean(runtimeIdentity.branch),
                repository_available: Boolean(runtimeIdentity.repository),
              },
              expected_sha_available: true,
              expected_branch: request.expected_branch,
              expected_repository: request.expected_repository,
              secrets_included: false,
            },
            secrets_included: false,
          },
          database_connection_performed: false,
          database_mutation_performed: false,
          migration_apply_performed: false,
          grant_mutation_performed: false,
          workflow_dispatch_performed: false,
          raw_values_exposed: false,
          secrets_included: false,
        });
      }
      const result = await hostLocalInspectionReader(request, { env: process.env });
      return res.status(200).json({
        ...result,
        ok: result?.ok !== false,
        contract: "mad4b.host-breakglass-host-local-inspection.v1",
        mode: "dry_run",
        operation: "read_only",
        target_source: "host_local_role_env",
        migration: null,
        migration_selected: false,
        migration_selection: "full_inspection_catalog",
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        workflow_dispatch_performed: false,
        raw_values_exposed: false,
        secrets_included: false,
      });
    } catch (error) {
      const details = error?.details && typeof error.details === "object" ? { ...error.details } : {};
      return res.status(Number(error?.status || 412)).json({
        ok: false,
        contract: "mad4b.host-breakglass-host-local-inspection.v1",
        mode: "dry_run",
        operation: "read_only",
        target_source: "host_local_role_env",
        error: error?.hostLocalAdapter
          ? { code: error.code || "host_local_inspection_failed", category: "bootstrap_error", message: String(error.message || "Host-local inspection failed").slice(0, 500), details, secrets_included: false }
          : sanitizeBootstrapError(error),
        database_connection_performed: details.database_connection_performed === true,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        workflow_dispatch_performed: false,
        raw_values_exposed: false,
        secrets_included: false,
      });
    }
  });

  router.get("/deployment-info/runtime-binding", async (req, res, next) => {
    if (!(await requireBackendServiceApiKey(req, res))) return;
    return next();
  }, (req, res) => {
    res.status(200).json({ ok: true, runtime_binding: buildRuntimeBindingEvidence(process.env), secrets_included: false });
  });

  router.get("/deployment-info", async (req, res) => {
    const legacyDeployment = await readDeploymentCommit();
    const manifestResult = readDeploymentManifest();
    const canonicalDeployment = manifestResult.ok ? manifestResult.manifest : null;
    const deployment = canonicalDeployment || legacyDeployment;
    const deploymentSource = canonicalDeployment?.source || (legacyDeployment ? "DEPLOYMENT_COMMIT.json" : "unavailable");
    const canonicalCommitFull = looksLikeSha(canonicalDeployment?.commit_sha)
      ? String(canonicalDeployment.commit_sha).trim().toLowerCase()
      : null;
    const canonicalBranch = firstString(canonicalDeployment?.branch);
    const git = await readGitCheckoutInfo();
    const host = String(req.headers.host || "").toLowerCase();
    const isDevHostname = host.startsWith("dev.mad4b.com");
    const expectedDevBranch = firstString(process.env.DEV_DEPLOYMENT_BRANCH, process.env.GOVERNED_DEV_BRANCH, "main");
    const branch = firstString(
      deployment?.branch,
      process.env.GITHUB_REF_NAME,
      process.env.DEPLOY_BRANCH,
      process.env.BRANCH_NAME,
      git?.branch,
      isDevHostname ? expectedDevBranch : null
    );
    const commitSha = firstString(
      deployment?.commit_sha,
      deployment?.commit,
      process.env.GITHUB_SHA,
      process.env.DEPLOY_COMMIT,
      process.env.COMMIT_SHA,
      process.env.REVISION_SHA,
      git?.commit_sha
    );
    const deployedAt = firstIso(
      deployment?.deployed_at,
      deployment?.generated_at,
      deployment?._source_mtime,
      process.env.DEPLOYED_AT,
      process.env.BUILD_TIMESTAMP,
      process.env.RELEASE_CREATED_AT,
      git?.ref_mtime,
      git?.head_mtime
    );
    const generatedAt = new Date().toISOString();
    let runtimeIntegrity;
    try {
      runtimeIntegrity = await Promise.resolve(runtimeIntegrityReader({
        expectedCommitSha: commitSha,
        checkoutCommitSha: git?.commit_sha || null,
        provenanceCommitSha: canonicalDeployment?.commit_sha || null,
        provenanceDetected: Boolean(canonicalDeployment?.commit_sha),
        provenanceSource: canonicalDeployment?.source || null,
      }));
    } catch {
      runtimeIntegrity = runtimeIntegrityFailure();
    }
    if (!runtimeIntegrity || typeof runtimeIntegrity !== "object") {
      runtimeIntegrity = runtimeIntegrityFailure("runtime_integrity_invalid_readback");
    }
    const includeGovernanceDbReadiness = String(req.query?.include_governance_db_readiness || "").trim() === "1";
    const governanceDbPrivilegeReadiness = includeGovernanceDbReadiness
      ? await governanceDbReadinessReader()
      : undefined;
    const includeMcpCatalogSchemaReadiness = String(req.query?.include_mcp_catalog_schema_readiness || "").trim() === "1";
    const mcpCatalogSchemaReadiness = includeMcpCatalogSchemaReadiness
      ? await mcpCatalogSchemaReadinessReader()
      : undefined;
    const includeProductionActivationReadiness = String(req.query?.include_production_activation_readiness || "").trim() === "1";
    const productionActivationReadiness = includeProductionActivationReadiness
      ? await productionActivationReadinessReader()
      : undefined;
    const mcpCatalogSchemaStartupPreflight = getMcpCatalogSchemaStartupPreflight();
    let runtimeBootstrapStatus;
    try {
      runtimeBootstrapStatus = await Promise.resolve(runtimeBootstrapStatusReader(process.env));
    } catch {
      runtimeBootstrapStatus = {
        contract: "mad4b.hostinger.runtime-bootstrap-status.v1",
        status: "bootstrap_required",
        hook: { required: true, configured: false, auto_apply: false, startup_apply: false, prestart_apply: false, docker_start_apply: false, values_exposed: false },
        database_connection_performed: false,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        normal_route_bypass: false,
        reasons: ["bootstrap_status_read_failed"],
        secrets_included: false,
      };
    }

    res.status(200).json({
      ok: true,
      service: "growth-intelligence-platform",
      hostname: req.headers.host || null,
      gitCommitFull: canonicalCommitFull,
      gitBranch: canonicalBranch,
      provenanceSource: canonicalDeployment?.source || null,
      branch,
      branch_source: sourceFor(branch, [
        [deploymentSource, deployment?.branch],
        ["GITHUB_REF_NAME", process.env.GITHUB_REF_NAME],
        ["DEPLOY_BRANCH", process.env.DEPLOY_BRANCH],
        ["BRANCH_NAME", process.env.BRANCH_NAME],
        ["git_checkout", git?.branch],
        ["dev_hostname_fallback", isDevHostname ? expectedDevBranch : null],
      ]),
      commit: commitSha,
      commit_sha: commitSha,
      commit_source: sourceFor(commitSha, [
        [deploymentSource, deployment?.commit_sha || deployment?.commit],
        ["GITHUB_SHA", process.env.GITHUB_SHA],
        ["DEPLOY_COMMIT", process.env.DEPLOY_COMMIT],
        ["COMMIT_SHA", process.env.COMMIT_SHA],
        ["REVISION_SHA", process.env.REVISION_SHA],
        [git?.git_source || "git_checkout", git?.commit_sha],
      ]),
      deployed_at: deployedAt,
      deployed_at_source: sourceFor(deployedAt, [
        [`${deploymentSource}.deployed_at`, deployment?.deployed_at],
        [`${deploymentSource}.generated_at`, deployment?.generated_at],
        [`${deploymentSource}.mtime`, deployment?._source_mtime],
        ["DEPLOYED_AT", process.env.DEPLOYED_AT],
        ["BUILD_TIMESTAMP", process.env.BUILD_TIMESTAMP],
        ["RELEASE_CREATED_AT", process.env.RELEASE_CREATED_AT],
        ["git_ref_mtime", git?.ref_mtime],
        ["git_head_mtime", git?.head_mtime],
      ]),
      deployment: sanitizeDeploymentManifest(deployment, deploymentSource),
      git: git ? {
        branch: git.branch || null,
        ref: git.git_ref || null,
        source: git.git_source,
        detected: Boolean(git.git_dir_detected),
        head_mtime: git.head_mtime || null,
        ref_mtime: git.ref_mtime || null,
      } : { detected: false },
      runtime_integrity: runtimeIntegrity,
      runtime_bootstrap_status: runtimeBootstrapStatus,
      ...(includeGovernanceDbReadiness ? {
        governance_db_privilege_readiness: governanceDbPrivilegeReadiness,
      } : {}),
      ...(includeMcpCatalogSchemaReadiness ? {
        mcp_catalog_schema_readiness: mcpCatalogSchemaReadiness,
        mcp_catalog_schema_startup_preflight: mcpCatalogSchemaStartupPreflight,
      } : {}),
      ...(includeProductionActivationReadiness ? {
        production_activation_readiness: productionActivationReadiness,
      } : {}),
      evidence: {
        commit_sha_available: Boolean(commitSha),
        branch_available: Boolean(branch),
        canonical_commit_sha_available: Boolean(canonicalCommitFull),
        canonical_branch_available: Boolean(canonicalBranch),
        deployed_at_available: Boolean(deployedAt),
        git_detected: Boolean(git?.git_dir_detected),
        manifest_detected: Boolean(deployment),
        canonical_manifest_detected: Boolean(canonicalDeployment),
        legacy_deployment_commit_detected: Boolean(legacyDeployment),
        runtime_integrity_state: runtimeIntegrity.state || "degraded",
        runtime_integrity_verified: runtimeIntegrity.verified === true,
        runtime_integrity_read_only: runtimeIntegrity.read_only_check === true,
        manifest_error: manifestResult.ok ? null : manifestResult.error,
        secrets_included: false,
      },
      app_env: process.env.APP_ENV || process.env.NODE_ENV || null,
      expected_dev_branch: expectedDevBranch,
      is_dev_hostname: isDevHostname,
      generated_at: generatedAt,
    });
  });

  return router;
}
