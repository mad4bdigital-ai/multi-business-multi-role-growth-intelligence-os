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
