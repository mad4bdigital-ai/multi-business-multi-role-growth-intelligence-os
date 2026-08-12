import { readFileSync, writeFileSync } from "node:fs";
import { runGithubRepositoryPolicyController, GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS } from "../githubRepositoryPolicyController.js";

const token = String(process.env.GITHUB_TOKEN || "").trim();
if (!token) throw new Error("GITHUB_TOKEN is required in the process environment.");

const args = {
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  default_branch: "main",
  required_checks: [...GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS],
};

const readback = await runGithubRepositoryPolicyController({ ...args, mode: "readback" }, { token });
const plan = await runGithubRepositoryPolicyController({ ...args, mode: "plan" }, { token });
const evidence = {
  generated_at: new Date().toISOString(),
  readback: {
    mode: readback.mode,
    target: readback.target,
    main_sha: readback.main_sha,
    branch_protected: readback.branch_protected,
    repository_auto_merge_allowed: readback.repository_auto_merge_allowed,
    managed_ruleset_count: readback.managed_ruleset_count,
    repository_managed_ruleset_count: readback.repository_managed_ruleset_count,
    bypass_actors: readback.bypass_actors,
    eligible_human_collaborators: readback.eligible_human_collaborators,
    review_policy_mode: readback.review_policy_mode,
    finalizer_identity: readback.finalizer_identity,
    required_checks: readback.required_checks,
    observed_required_checks: readback.observed_required_checks,
    proof: readback.proof,
    findings: readback.findings,
    mutation_executed: readback.mutation_executed,
    secrets_included: false,
  },
  plan: {
    mode: plan.mode,
    target: plan.target,
    expected_main_sha: plan.expected_main_sha,
    desired_ruleset_fingerprint: plan.desired_ruleset_fingerprint,
    policy_fingerprint: plan.policy_fingerprint,
    review_policy_mode: plan.review_policy_mode,
    single_owner_mode: plan.single_owner_mode,
    operation: plan.operation,
    existing_ruleset_id: plan.existing_ruleset_id,
    preconditions: plan.preconditions,
    mutation_executed: plan.mutation_executed,
    force_push_allowed: plan.force_push_allowed,
    repository_content_mutation_allowed: plan.repository_content_mutation_allowed,
    secrets_included: false,
  },
};
writeFileSync("../docs/issue-execution/github-policy-live-plan-20260812.json", `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
