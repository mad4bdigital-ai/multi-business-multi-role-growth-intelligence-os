import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const PRODUCTION_RUNTIME_IDENTITY_COMPATIBILITY_CONTRACT = "mad4b.production-runtime-identity-compatibility.v1";

/**
 * Phase-1 compatibility predicate for Recovery surfaces.
 *
 * Accepts:
 * - the canonical explicit Hostinger Production runtime; or
 * - the currently deployed legacy Production identity (production/prod only).
 *
 * Rejects:
 * - non-Production GitHub refs when supplied;
 * - Staging or mixed environment signals;
 * - unknown or conflicting legacy signals.
 *
 * Remove the legacy fallback only after production_hostinger_autodeploy is
 * deployed to Production and verified through the governed parity/recovery flow.
 */
export function productionEnvironmentIdentityIsValid(env = process.env) {
  const githubRef = String(env?.GITHUB_REF_NAME || "").trim().toLowerCase();
  if (githubRef && githubRef !== "production") return false;

  const runtime = resolveRuntimeEnvironmentStrict(env);

  const explicitProduction = Boolean(
    runtime?.ok === true
      && runtime.environment_key === "production"
      && runtime.runtime_class === "hostinger_autodeploy"
      && runtime.runtime_class_explicit === true
  );

  if (explicitProduction) return true;

  const legacySignals = [
    env?.NODE_ENV,
    env?.REMOTE_MCP_ENVIRONMENT,
    env?.DEPLOYMENT_ENVIRONMENT,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  return legacySignals.length > 0
    && legacySignals.every((value) => ["production", "prod"].includes(value));
}
