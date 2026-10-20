import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const INSPECTION_DISPATCH_CONTRACT = "mad4b.production-host-local-inspection-dispatch.v1";
export const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
export const CONTROL_ISSUE = 6625;
export const OWNER_ID = 271942579;
export const TOKEN_PREFIX = "RUN_PRODUCTION_HOST_LOCAL_FULL_INSPECTION expected_production_sha=";
export const WORKFLOW = "production-runtime-parity-evidence.yml";
const SHA40 = /^[0-9a-f]{40}$/;

export function validateInspectionRequest({ event, eventName, eventSha, eventRef, main, production } = {}) {
  const errors = [];
  const add = (valid, reason) => { if (!valid) errors.push(reason); };
  const comment = event?.comment || {};
  const exactBody = typeof comment.body === "string" ? comment.body : "";
  const targetSha = exactBody.startsWith(TOKEN_PREFIX) ? exactBody.slice(TOKEN_PREFIX.length) : "";
  const mainSha = String(main?.commit?.sha || "").toLowerCase();
  const productionSha = String(production?.commit?.sha || "").toLowerCase();
  add(eventName === "issue_comment" && event?.action === "created", "event_not_created_issue_comment");
  add(event?.repository?.full_name === REPOSITORY, "repository_mismatch");
  add(event?.issue?.number === CONTROL_ISSUE && !event?.issue?.pull_request, "control_issue_mismatch");
  add(comment?.user?.id === OWNER_ID && comment?.author_association === "OWNER", "owner_identity_mismatch");
  add(SHA40.test(targetSha) && exactBody === TOKEN_PREFIX + targetSha, "invalid_exact_token");
  add(eventRef === "refs/heads/main", "untrusted_dispatch_ref");
  add(SHA40.test(String(eventSha || "").toLowerCase()) && String(eventSha).toLowerCase() === mainSha, "main_source_drift");
  add(SHA40.test(mainSha) && main?.protected === true, "main_not_proven_protected");
  add(SHA40.test(productionSha) && production?.protected === true, "production_not_proven_protected");
  add(targetSha === productionSha, "production_sha_drift");
  return Object.freeze({
    contract: INSPECTION_DISPATCH_CONTRACT,
    ok: errors.length === 0,
    blockers: errors,
    main_sha: SHA40.test(mainSha) ? mainSha : null,
    production_sha: SHA40.test(productionSha) ? productionSha : null,
    expected_production_sha: SHA40.test(targetSha) ? targetSha : null,
    source_event_comment_id: Number(comment?.id || 0) || null,
    read_only: true,
    target_database_mutation: false,
    provider_mutation: false,
    protected_branch_mutation: false,
    secrets_included: false,
  });
}

export function buildInspectionDispatch(targetSha) {
  if (!SHA40.test(String(targetSha || ""))) throw new Error("Invalid exact Production SHA");
  return Object.freeze({
    ref: "main",
    inputs: {
      expected_sha: targetSha,
      strategy: "disabled",
      apply_execution: "false",
      bootstrap_mode: "full_role_inspection",
      bootstrap_target_key: "production-runtime",
      bootstrap_target_source: "host_local_role_env",
    },
  });
}

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

export async function executeInspectionDispatch({ event, eventName, eventSha, eventRef, token, fetchImpl = fetch } = {}) {
  if (!token) fail("github_actions_token_unavailable");
  const base = "https://api.github.com/repos/" + REPOSITORY;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  async function readBranch(branch) {
    const res = await fetchImpl(base + "/branches/" + branch, { method: "GET", headers, redirect: "error" });
    if (res.status !== 200) fail("branch_readback_failed", { branch, http_status: res.status });
    return res.json();
  }
  const [main, production] = await Promise.all([readBranch("main"), readBranch("Production")]);
  const checked = validateInspectionRequest({ event, eventName, eventSha, eventRef, main, production });
  if (!checked.ok) fail("inspection_dispatch_admission_denied", { blockers: checked.blockers });
  const [freshMain, freshProduction] = await Promise.all([readBranch("main"), readBranch("Production")]);
  const fresh = validateInspectionRequest({ event, eventName, eventSha, eventRef, main: freshMain, production: freshProduction });
  if (!fresh.ok || fresh.main_sha !== checked.main_sha || fresh.production_sha !== checked.production_sha) {
    fail("inspection_dispatch_ref_drift", { blockers: fresh.blockers });
  }
  // No retries for an ambiguous workflow_dispatch POST. The target workflow
  // independently rejects Production ref drift and all mutation authorities.
  const payload = buildInspectionDispatch(checked.expected_production_sha);
  const response = await fetchImpl(base + "/actions/workflows/" + WORKFLOW + "/dispatches", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
  });
  if (response.status !== 204) fail("inspection_dispatch_not_accepted", { http_status: response.status });
  return Object.freeze({
    ...checked,
    outcome: "dispatched",
    dispatch_http_status: 204,
    workflow: WORKFLOW,
    target_key: "production-runtime",
    inspection_mode: "full_role_inspection",
    target_source: "host_local_role_env",
    apply_execution: false,
    dispatch_requested: true,
  });
}

async function main() {
  const dir = String(process.env.EVIDENCE_DIR || ".artifacts/host-local-readonly-dispatch");
  const write = (value) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "decision.json"), JSON.stringify(value, null, 2) + "\n");
  };
  try {
    const eventFile = process.env.GITHUB_EVENT_PATH;
    if (!eventFile) fail("github_event_unavailable");
    const event = JSON.parse(fs.readFileSync(eventFile, "utf8"));
    const result = await executeInspectionDispatch({
      event,
      eventName: process.env.GITHUB_EVENT_NAME,
      eventSha: process.env.GITHUB_SHA,
      eventRef: process.env.GITHUB_REF,
      token: process.env.GH_TOKEN,
    });
    write(result);
    process.stdout.write(JSON.stringify({
      contract: result.contract,
      outcome: result.outcome,
      expected_production_sha: result.expected_production_sha,
      source_event_comment_id: result.source_event_comment_id,
      read_only: true,
      secrets_included: false,
    }) + "\n");
  } catch (error) {
    write({
      contract: INSPECTION_DISPATCH_CONTRACT,
      outcome: "blocked",
      error_code: String(error.code || "inspection_dispatch_failed").slice(0, 110),
      blockers: error.details?.blockers || [],
      dispatch_outcome_unknown: error.code === undefined,
      read_only: true,
      target_database_mutation: false,
      provider_mutation: false,
      protected_branch_mutation: false,
      secrets_included: false,
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
