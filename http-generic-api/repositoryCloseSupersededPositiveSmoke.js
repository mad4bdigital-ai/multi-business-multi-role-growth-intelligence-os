import { randomUUID } from "node:crypto";

import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { writeAuditLogAsync } from "./auditLogger.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { githubLifecycleRequest } from "./githubRepositoryLifecycle.js";
import {
  assertCloseSupersededEvidenceV6,
  buildCloseSupersededWriteV6,
  reanalyzeMutationItemV6,
} from "./repositoryGovernanceV6.js";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PART_PATTERN = /^[A-Za-z0-9_.-]+$/;

function smokeError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeSha(value = "") {
  const sha = String(value || "").trim().toLowerCase();
  return SHA_PATTERN.test(sha) ? sha : "";
}

function encodeBranch(branch = "") {
  return String(branch || "").split("/").map(encodeURIComponent).join("/");
}

function smokeRefName(kind, seed = "") {
  const safeSeed = String(seed || randomUUID())
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || randomUUID().slice(0, 12);
  return `gpt/close-superseded-smoke-${kind}-${safeSeed}`;
}

export function repositoryCloseSupersededSmokeConfirmation(expectedMainSha = "") {
  const sha = normalizeSha(expectedMainSha);
  return sha ? `RUN_CLOSE_SUPERSEDED_SMOKE_${sha.slice(0, 12).toUpperCase()}` : "";
}

async function resolveSmokeTarget(args = {}) {
  let owner = String(args.owner || "").trim();
  let repo = String(args.repo || "").trim();
  let defaultBranch = String(args.default_branch || "").trim();
  if (!owner || !repo || !defaultBranch) {
    const cfg = await resolveActivationBootstrapConfig({});
    owner ||= String(cfg?.config?.github_owner || "").trim();
    repo ||= String(cfg?.config?.github_repo || "").trim();
    defaultBranch ||= String(cfg?.config?.github_branch || "main").trim() || "main";
  }
  if (!REPOSITORY_PART_PATTERN.test(owner) || !REPOSITORY_PART_PATTERN.test(repo) || !defaultBranch) {
    throw smokeError(400, "repository_close_superseded_smoke_target_invalid", "A valid GitHub owner, repository, and default branch are required.", { owner: owner || null, repo: repo || null, default_branch: defaultBranch || null, secrets_included: false });
  }
  return { owner, repo, defaultBranch };
}

async function deleteDisposableRef({ call, branch }) {
  try {
    const response = await call({ apiPath: `/git/refs/heads/${encodeBranch(branch)}`, method: "DELETE", allowNotFound: true });
    return { ok: true, branch, deleted: response.status !== 404, already_missing: response.status === 404, secrets_included: false };
  } catch (error) {
    return { ok: false, branch, deleted: false, error: { code: error?.code || "repository_close_superseded_smoke_ref_cleanup_failed", message: error?.message || "Disposable ref cleanup failed.", details: error?.details || null }, secrets_included: false };
  }
}

export async function runRepositoryCloseSupersededPositiveSmokeV6(args = {}, deps = {}) {
  const { owner, repo, defaultBranch } = await resolveSmokeTarget(args);
  const expectedMainSha = normalizeSha(args.expected_main_sha);
  if (!expectedMainSha) {
    throw smokeError(400, "repository_close_superseded_smoke_expected_main_sha_required", "expected_main_sha must be a 40-character Git commit SHA.");
  }
  const expectedConfirm = repositoryCloseSupersededSmokeConfirmation(expectedMainSha);
  if (String(args.confirm || "") !== expectedConfirm) {
    throw smokeError(400, "repository_close_superseded_smoke_confirmation_required", `Positive smoke requires confirm=${expectedConfirm}.`, { expected_confirm: expectedConfirm, secrets_included: false });
  }

  const token = deps.token || await getGitHubAppInstallationToken({});
  const requestImpl = deps.requestImpl || githubLifecycleRequest;
  const reanalyzeImpl = deps.reanalyzeImpl || reanalyzeMutationItemV6;
  const assertEvidenceImpl = deps.assertEvidenceImpl || assertCloseSupersededEvidenceV6;
  const auditImpl = deps.auditImpl || writeAuditLogAsync;
  const seed = String(args.smoke_id || randomUUID());
  const baseBranch = smokeRefName("base", seed);
  const headBranch = smokeRefName("head", seed);
  const call = (request) => requestImpl({ owner, repo, token, fetchImpl: deps.fetchImpl, ...request });

  let prNumber = null;
  let result = null;
  let caughtError = null;
  let cleanup = { ok: false, pending: true, base_branch: baseBranch, head_branch: headBranch, secrets_included: false };

  try {
    const mainRef = await call({ apiPath: `/git/ref/heads/${encodeBranch(defaultBranch)}` });
    const currentMainSha = normalizeSha(mainRef?.payload?.object?.sha);
    if (currentMainSha !== expectedMainSha) {
      throw smokeError(409, "repository_close_superseded_smoke_main_moved", "Default-branch SHA changed after smoke approval.", { expected_main_sha: expectedMainSha, current_main_sha: currentMainSha || null, secrets_included: false });
    }

    const mainCommit = await call({ apiPath: `/git/commits/${encodeURIComponent(currentMainSha)}` });
    const parentSha = normalizeSha(mainCommit?.payload?.parents?.[0]?.sha);
    if (!parentSha) {
      throw smokeError(409, "repository_close_superseded_smoke_parent_unavailable", "Default-branch parent commit is required for disposable PR setup.", { main_sha: currentMainSha, secrets_included: false });
    }

    await call({ apiPath: "/git/refs", method: "POST", body: { ref: `refs/heads/${baseBranch}`, sha: parentSha } });
    await call({ apiPath: "/git/refs", method: "POST", body: { ref: `refs/heads/${headBranch}`, sha: currentMainSha } });

    const createdPr = await call({
      apiPath: "/pulls",
      method: "POST",
      body: {
        title: `Governed close-superseded positive smoke ${seed}`,
        head: headBranch,
        base: baseBranch,
        body: "Disposable governed certification PR. It must be closed and its branches cleaned in the same smoke cycle.",
        draft: false,
      },
    });
    prNumber = Number(createdPr?.payload?.number);
    if (!Number.isInteger(prNumber) || prNumber < 1) {
      throw smokeError(502, "repository_close_superseded_smoke_pr_create_failed", "GitHub did not return a valid disposable pull-request number.");
    }

    const current = await reanalyzeImpl({
      repoRef: { owner, repo, resource_uri: `github://${owner}/${repo}` },
      item: { pr_number: prNumber },
      token,
    });
    const evidence = assertEvidenceImpl({ plannedHeadSha: currentMainSha, analysis: current?.analysis || {} });
    const write = buildCloseSupersededWriteV6({ owner, repo, prNumber, headSha: currentMainSha });
    const repositoryPrefix = `/repos/${owner}/${repo}`;
    if (!write.path.startsWith(repositoryPrefix)) {
      throw smokeError(500, "repository_close_superseded_smoke_write_contract_invalid", "Close-superseded write contract did not resolve to the approved repository.");
    }
    const closeResponse = await call({ apiPath: write.path.slice(repositoryPrefix.length), method: write.method, body: write.body });
    const readbackResponse = await call({ apiPath: `/pulls/${prNumber}` });
    const readbackState = String(readbackResponse?.payload?.state || "").toLowerCase();
    const readbackHeadSha = normalizeSha(readbackResponse?.payload?.head?.sha);
    const verification = {
      ok: readbackState === write.expected_readback.state && readbackHeadSha === write.expected_readback.head_sha,
      expected_state: write.expected_readback.state,
      actual_state: readbackState || null,
      expected_head_sha: write.expected_readback.head_sha,
      actual_head_sha: readbackHeadSha || null,
      secrets_included: false,
    };
    if (!verification.ok) {
      throw smokeError(502, "repository_close_superseded_smoke_readback_failed", "Disposable PR close returned without matching state/head readback.", verification);
    }

    result = {
      ok: true,
      status: "completed",
      tool: "repository_close_superseded_positive_smoke",
      recipe_key: "repo.pr.close_superseded.smoke",
      target: { owner, repo, default_branch: defaultBranch, expected_main_sha: expectedMainSha },
      setup: { base_branch: baseBranch, head_branch: headBranch, base_sha: parentSha, head_sha: currentMainSha, pr_number: prNumber, pr_url: createdPr?.payload?.html_url || null, secrets_included: false },
      evidence: { classification: current?.analysis?.classification_v6 || null, confidence: current?.analysis?.confidence_v6 || null, main_equivalence: current?.analysis?.main_equivalence || null, predicate: evidence, secrets_included: false },
      write: { method: write.method, path: write.path, state: closeResponse?.payload?.state || null, secrets_included: false },
      verification,
      cleanup: { pending: true, secrets_included: false },
      capability_envelope_id: args.capability_envelope_id || null,
      production_recipe_activated: false,
      production_apply_authority_changed: false,
      secrets_included: false,
    };
  } catch (error) {
    caughtError = error;
  } finally {
    let pullRequestCleanup = { ok: true, pr_number: prNumber, closed: false, already_closed: false, skipped: !prNumber, secrets_included: false };
    if (prNumber) {
      try {
        const prReadback = await call({ apiPath: `/pulls/${prNumber}`, allowNotFound: true });
        if (prReadback.status === 404) {
          pullRequestCleanup = { ok: true, pr_number: prNumber, already_missing: true, closed: false, secrets_included: false };
        } else if (String(prReadback?.payload?.state || "").toLowerCase() === "open") {
          const closed = await call({ apiPath: `/pulls/${prNumber}`, method: "PATCH", body: { state: "closed" } });
          pullRequestCleanup = { ok: String(closed?.payload?.state || "").toLowerCase() === "closed", pr_number: prNumber, closed: true, already_closed: false, secrets_included: false };
        } else {
          pullRequestCleanup = { ok: true, pr_number: prNumber, closed: false, already_closed: true, secrets_included: false };
        }
      } catch (error) {
        pullRequestCleanup = { ok: false, pr_number: prNumber, closed: false, error: { code: error?.code || "repository_close_superseded_smoke_pr_cleanup_failed", message: error?.message || "Disposable PR cleanup failed.", details: error?.details || null }, secrets_included: false };
      }
    }

    const headRefCleanup = await deleteDisposableRef({ call, branch: headBranch });
    const baseRefCleanup = await deleteDisposableRef({ call, branch: baseBranch });
    let audit = { ok: true, secrets_included: false };
    try {
      await auditImpl({
        action: "repository_close_superseded_positive_smoke",
        resource_type: "github_pull_request",
        resource_id: `${owner}/${repo}:${prNumber || "setup_failed"}`,
        payload: {
          target: { owner, repo, default_branch: defaultBranch, expected_main_sha: expectedMainSha },
          setup: result?.setup || { base_branch: baseBranch, head_branch: headBranch, pr_number: prNumber, secrets_included: false },
          evidence: result?.evidence || null,
          verification: result?.verification || null,
          cleanup: { pull_request: pullRequestCleanup, head_ref: headRefCleanup, base_ref: baseRefCleanup, secrets_included: false },
          capability_envelope_id: args.capability_envelope_id || null,
          principal: deps?.auth?.user_id || deps?.auth?.mode || "admin",
          production_recipe_activated: false,
          production_apply_authority_changed: false,
          secrets_included: false,
        },
      });
    } catch (error) {
      audit = { ok: false, error: { code: error?.code || "repository_close_superseded_smoke_audit_failed", message: error?.message || "Smoke audit write failed." }, secrets_included: false };
    }
    cleanup = {
      ok: pullRequestCleanup.ok === true && headRefCleanup.ok === true && baseRefCleanup.ok === true && audit.ok === true,
      pull_request: pullRequestCleanup,
      head_ref: headRefCleanup,
      base_ref: baseRefCleanup,
      audit,
      secrets_included: false,
    };
    if (result) {
      result.cleanup = cleanup;
      result.ok = result.ok === true && cleanup.ok === true;
      result.status = result.ok ? "completed" : "partial_success";
    }
  }

  if (caughtError) {
    caughtError.details = { ...(caughtError.details || {}), cleanup, secrets_included: false };
    throw caughtError;
  }
  if (!cleanup.ok) {
    throw smokeError(502, "repository_close_superseded_smoke_cleanup_failed", "Positive smoke completed its close/readback but disposable cleanup or audit failed.", { result, cleanup, secrets_included: false });
  }
  return result;
}
