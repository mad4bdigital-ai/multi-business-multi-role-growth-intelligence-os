/**
 * Startup write policy for the exact Windows/Docker Staging deployment class.
 *
 * Quiescent is the default for this Staging class. Turning on background
 * startup mutations requires an explicit governed change to "allow_governed".
 * Production and other runtime classes are not changed by this policy.
 */
const localWindowsStagingDeploymentClass = "staging_local_windows_docker";
const ALLOWED_MODES = new Set(["quiescent", "allow_governed"]);

export function isLocalWindowsStaging(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "staging"
    && String(env.DEPLOYMENT_ENVIRONMENT || "").trim().toLowerCase() === localWindowsStagingDeploymentClass;
}

export function readStagingStartupMutationPolicy(env = process.env) {
  if (!isLocalWindowsStaging(env)) {
    return Object.freeze({ active: false, quiescent: false, mode: "not_applicable", secrets_included: false });
  }
  const mode = String(env.STAGING_STARTUP_BACKGROUND_MUTATIONS_MODE || "quiescent").trim().toLowerCase();
  if (!ALLOWED_MODES.has(mode)) {
    const error = new Error("Unknown Windows Staging startup mutation policy; background startup tasks must fail closed.");
    error.code = "STAGING_STARTUP_MUTATION_MODE_INVALID";
    throw error;
  }
  return Object.freeze({
    active: true,
    quiescent: mode === "quiescent",
    mode,
    secrets_included: false,
  });
}

export function requireDedicatedStagingControlPlaneWriteIdentity(env = process.env) {
  if (!isLocalWindowsStaging(env)) return;
  const enabled = ["true", "1", "yes"].includes(
    String(env.CONTROL_PLANE_WRITE_AUTHORITY_ENABLED || "").trim().toLowerCase(),
  );
  if (!enabled) {
    const error = new Error(
      "Windows Staging control-plane writes require a dedicated identity; Runtime DB fallback is denied.",
    );
    error.code = "STAGING_CONTROL_PLANE_WRITE_IDENTITY_REQUIRED";
    throw error;
  }
}
