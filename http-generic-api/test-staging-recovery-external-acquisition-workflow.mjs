import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const acquisitionWorkflow = readFileSync("../.github/workflows/staging-recovery-external-evidence-acquisition.yml", "utf8");
const countersignWorkflow = readFileSync("../.github/workflows/staging-post-deploy-verification.yml", "utf8");
const registry = JSON.parse(readFileSync("./config/recovery-external-source-authorities.json", "utf8"));
const stagingEnvExample = readFileSync("./.env.staging.example", "utf8");
const stagingEnvironmentPs = readFileSync("../autopilot-portable-staging/Staging-Environment.ps1", "utf8");
const canaryPs = readFileSync("../autopilot-portable-staging/Invoke-StagingRecoveryCertificationCanary.ps1", "utf8");

assert.match(acquisitionWorkflow, /environment:\s*staging-recovery-acquisition/u);
assert.match(acquisitionWorkflow, /git rev-parse origin\/main/u);
assert.match(acquisitionWorkflow, /ACQUIRE_STAGING_RECOVERY_EXTERNAL_EVIDENCE/u);
assert.match(acquisitionWorkflow, /STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY/u);
assert.match(acquisitionWorkflow, /staging-recovery-acquire-network-evidence\.mjs/u);
assert.match(acquisitionWorkflow, /staging-recovery-acquire-oauth-evidence\.mjs/u);
assert.match(acquisitionWorkflow, /staging-recovery-acquire-registration-evidence\.mjs/u);
assert.match(acquisitionWorkflow, /staging-recovery-sign-acquisition-receipt\.mjs/u);
assert.match(acquisitionWorkflow, /receipt_issued/u);

assert.doesNotMatch(countersignWorkflow, /STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY/u);
assert.match(countersignWorkflow, /STAGING_RECOVERY_ACQUISITION_PUBLIC_KEY/u);
assert.match(countersignWorkflow, /STAGING_RECOVERY_ACQUISITION_KEY_ID/u);
assert.match(countersignWorkflow, /STAGING_RECOVERY_ACQUISITION_ISSUER/u);
assert.match(countersignWorkflow, /RECOVERY_STAGING_LIVE_NETWORK_EVIDENCE_FILE/u);
assert.match(countersignWorkflow, /staging-recovery-acquire-network-evidence\.mjs/u);

assert.equal(registry.contract, "mad4b.recovery-external-source-authority-registry.v1");
assert.equal(registry.environment, "staging");
assert.equal(registry.sources.network.status, "active");
assert.equal(registry.sources.oauth.status, "foundation_only");
assert.equal(registry.sources.registration.status, "unavailable");
assert.equal(registry.manual_override_allowed, false);
assert.equal(registry.caller_assertion_allowed, false);
assert.equal(registry.environment_flag_can_activate_source, false);
assert.equal(registry.production_authority, false);
assert.equal(registry.secrets_included, false);

assert.match(stagingEnvExample, /STAGING_RECOVERY_ACQUISITION_PUBLIC_KEY=/u);
assert.match(stagingEnvExample, /STAGING_RECOVERY_ACQUISITION_KEY_ID=/u);
assert.match(stagingEnvExample, /STAGING_RECOVERY_ACQUISITION_ISSUER=/u);
assert.doesNotMatch(stagingEnvExample, /^STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY=/mu);
assert.match(stagingEnvironmentPs, /STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY/u);
assert.match(stagingEnvironmentPs, /must never be persisted in \.env\.staging/u);

assert.match(canaryPs, /AcquisitionReceiptFile/u);
assert.match(canaryPs, /RECOVERY_STAGING_ACQUISITION_RECEIPT_FILE/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-recovery-external-acquisition-workflow-test.v1",
  registration_source_active: false,
  oauth_source_active: false,
  network_source_active: true,
  production_authority: false,
  secrets_included: false,
}));
