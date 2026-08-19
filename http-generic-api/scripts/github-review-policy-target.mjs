const BRANCHES = Object.freeze(["main", "Production"]);

function clean(value) {
  return String(value ?? "").trim();
}

export const REGISTERED_POLICY_BRANCHES = BRANCHES;

export function resolveTargetBranch(value = "main") {
  const branch = clean(value) || "main";
  if (!BRANCHES.includes(branch)) {
    throw new Error(`TARGET_BRANCH must be one of: ${BRANCHES.join(", ")}.`);
  }
  return branch;
}

export function branchKey(branch) {
  return resolveTargetBranch(branch).toLowerCase();
}

export function branchConfirmation(branch) {
  const target = resolveTargetBranch(branch);
  return target === "main" ? "APPLY_GITHUB_MAIN_REVIEW_POLICY" : "APPLY_GITHUB_PRODUCTION_POLICY";
}

export function readinessConfirmation(branch) {
  const target = resolveTargetBranch(branch);
  return target === "main"
    ? "AUTHORIZE_GITHUB_MAIN_REVIEW_POLICY_READINESS"
    : "AUTHORIZE_GITHUB_PRODUCTION_POLICY_READINESS";
}

export function verifyConfirmation(branch) {
  const target = resolveTargetBranch(branch);
  return target === "main" ? "VERIFY_GITHUB_MAIN_REVIEW_POLICY" : "VERIFY_GITHUB_PRODUCTION_POLICY";
}

export function readinessMarkerPrefix(branch) {
  const target = resolveTargetBranch(branch);
  return target === "main" ? "GITHUB_MAIN_REVIEW_POLICY_READINESS result=pass " : "GITHUB_PRODUCTION_POLICY_READINESS result=pass ";
}

export function capabilityBindingKey(branch) {
  resolveTargetBranch(branch);
  return "growth_intelligence_platform.github.primary.production";
}

export function activationRequester(branch) {
  return `github_actions_github_${branchKey(branch)}_review_policy_apply`;
}

export function targetShaField(branch) {
  return `${branchKey(branch)}_sha`;
}
