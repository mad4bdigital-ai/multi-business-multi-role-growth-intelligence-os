// Pure, side-effect-free status source policy primitives.
// GitHub Any source is *not* equivalent to app-bound server enforcement.
export const ANY_SOURCE_TRUSTED_READBACK = "any_source_with_independent_finalizer_readback";

export function isAuthorizedMainAnySource(policy = {}) {
  return policy.required_check_source_mode === ANY_SOURCE_TRUSTED_READBACK
    && policy.required_check_producer === "trusted_github_app_attestor"
    && policy.any_source_governed_merge_requires === "same_cycle_trusted_attestor_status_creator_and_exact_candidate"
    && policy.native_auto_merge_forbidden === true;
}

export function allowedCheckSource(binding, { context, appId, anySourceOptIn } = {}) {
  if (!binding || binding.context !== context || !Number.isInteger(appId) || appId <= 0) return false;
  return binding.integration_id === appId || (anySourceOptIn === true && binding.integration_id === null);
}

export function latestSameCycleAttestorStatus(statuses, { context, statusId, creatorId } = {}) {
  if (!Array.isArray(statuses) || !context || !Number.isSafeInteger(statusId) || statusId <= 0
    || !Number.isSafeInteger(creatorId) || creatorId <= 0) return false;
  // GitHub's combined-status history is newest first. Never search for an
  // older trusted success after another publisher overwrote the context.
  const newest = statuses.find((status) => status?.context === context);
  return newest?.state === "success"
    && Number(newest?.id || 0) === statusId
    && Number(newest?.creator?.id || 0) === creatorId;
}

// Pure required-check evaluator. Never treat an arbitrary commit status as
// a replacement for actual CI Check Runs. If a context has both types,
// require both to pass, as GitHub's branch policy does.
export function evaluateRequiredHeadChecks(bindings, { checkRuns = [], statuses = [], attestorContext = "Derived State Closure" } = {}) {
  const passing = new Set(["success", "neutral", "skipped"]);
  if (!Array.isArray(bindings) || !bindings.length || !Array.isArray(checkRuns) || !Array.isArray(statuses)) return { ok: false, missing: ["required_check_evidence_unavailable"], failing: [] };
  const missing = [], failing = [];
  for (const binding of bindings) {
    const context = String(binding?.context || "");
    if (!context) { missing.push("empty_context"); continue; }
    const runs = checkRuns.filter(run => run?.name === context && (binding.integration_id == null || Number(run?.app?.id || 0) === binding.integration_id));
    const latestStatus = statuses.find(status => status?.context === context);
    if (context === attestorContext) {
      if (!latestStatus) { missing.push(context); continue; }
      if (latestStatus.state !== "success" || runs.some(run => run.status !== "completed" || !passing.has(run.conclusion))) failing.push(context);
      continue;
    }
    // Registered CI contexts are emitted by GitHub Actions; a foreign app
    // cannot make up a success result by posting an identically named status.
    const ciRuns = runs.filter(run => run?.app?.slug === "github-actions");
    if (!ciRuns.length) { missing.push(context); continue; }
    const current = [...ciRuns].sort((a,b) => Date.parse(b.started_at || b.completed_at || "1970-01-01") - Date.parse(a.started_at || a.completed_at || "1970-01-01"))[0];
    if (current.status !== "completed" || !passing.has(current.conclusion) || (latestStatus && latestStatus.state !== "success")) failing.push(context);
  }
  return { ok: missing.length === 0 && failing.length === 0, missing, failing };
}
