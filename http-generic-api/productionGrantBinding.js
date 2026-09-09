import {
  computeGrantBindingHash,
  readRuntimeBootstrapContract,
  resolveBootstrapTarget,
} from "./runtimeBootstrapContract.js";

export const PRODUCTION_GRANT_BINDING_CONTRACT = "mad4b.production-grant-binding.v1";

export function readCanonicalProductionGrantBinding(env = process.env) {
  const bootstrapContract = readRuntimeBootstrapContract();
  const target = resolveBootstrapTarget({ ...env, BOOTSTRAP_MODE: "apply_grants" }, bootstrapContract);
  return Object.freeze({
    contract: PRODUCTION_GRANT_BINDING_CONTRACT,
    environment: "production",
    target_key: target.key,
    target_fingerprint: target.target_fingerprint,
    grant_binding_hash: computeGrantBindingHash(target, bootstrapContract),
    source: "server_resolved_bootstrap_target_and_repository_grant_contract",
    server_derived: true,
    raw_identifiers_exposed: false,
    secrets_included: false,
  });
}

