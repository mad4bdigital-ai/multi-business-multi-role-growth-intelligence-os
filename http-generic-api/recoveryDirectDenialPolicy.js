export const DIRECT_RECOVERY_DENIALS = Object.freeze([
  Object.freeze({
    status: 403,
    reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
    denial_class: "trusted_ingress_required",
  }),
  Object.freeze({
    status: 404,
    reason: "RECOVERY_STAGING_HOST_UNAVAILABLE",
    denial_class: "staging_host_unavailable",
  }),
]);

export function classifyRecoveryDirectDenial({ status, reason } = {}) {
  return (
    DIRECT_RECOVERY_DENIALS.find(
      (candidate) =>
        candidate.status === status &&
        candidate.reason === reason,
    ) || null
  );
}
