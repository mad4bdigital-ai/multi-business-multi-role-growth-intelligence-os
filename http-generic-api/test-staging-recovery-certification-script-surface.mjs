import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canaryPs = readFileSync("../autopilot-portable-staging/Invoke-StagingRecoveryCertificationCanary.ps1", "utf8");
const publishPs = readFileSync("../autopilot-portable-staging/Invoke-StagingRecoveryCertificationPublish.ps1", "utf8");
const workflow = readFileSync("../.github/workflows/staging-post-deploy-verification.yml", "utf8");
const verifier = readFileSync("../.github/scripts/staging-recovery-verify-and-countersign.mjs", "utf8");
const negative = readFileSync("../.github/scripts/staging-recovery-negative-test-evidence.mjs", "utf8");
const acquisitionSigner = readFileSync("../.github/scripts/staging-recovery-sign-acquisition-receipt.mjs", "utf8");
const networkAcquisition = readFileSync("./scripts/staging-recovery-acquire-network-evidence.mjs", "utf8");

assert.match(canaryPs, /git" -Arguments @\("fetch", "origin", "main"\)/u);
assert.match(canaryPs, /\$branch -ne "main"/u);
assert.match(canaryPs, /\$head -ne \$originMain/u);
assert.match(canaryPs, /RECOVERY_STAGING_REGISTRATION_EVIDENCE_FILE/u);
assert.match(canaryPs, /RECOVERY_STAGING_OAUTH_EVIDENCE_FILE/u);
assert.match(canaryPs, /RECOVERY_STAGING_NETWORK_EVIDENCE_FILE/u);
assert.match(canaryPs, /RECOVERY_STAGING_ACQUISITION_RECEIPT_FILE/u);
assert.match(canaryPs, /AcquisitionReceiptFile/u);
assert.match(canaryPs, /RECOVERY_STAGING_WORKER_EVIDENCE_FILE/u);
assert.match(canaryPs, /RECOVERY_STAGING_INGRESS_BUILD_IDENTITY_FILE/u);
assert.match(canaryPs, /COUNTERSIGN_STAGING_RECOVERY/u);
assert.match(canaryPs, /evidence_bundle_zip_base64/u);
assert.match(canaryPs, /production_live_enabled/u);

assert.match(workflow, /evidence_bundle_zip_base64:/u);
assert.match(workflow, /Run exact-SHA Recovery negative regression suites/u);
assert.match(workflow, /staging-recovery-negative-test-evidence\.mjs/u);
assert.match(workflow, /RECOVERY_STAGING_NEGATIVE_TEST_EVIDENCE_FILE/u);
assert.match(workflow, /STAGING_RECOVERY_ACQUISITION_PUBLIC_KEY/u);
assert.match(workflow, /STAGING_RECOVERY_ACQUISITION_KEY_ID/u);
assert.match(workflow, /STAGING_RECOVERY_ACQUISITION_ISSUER/u);
assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$\{\{ inputs\.expected_sha \}\}"/u);

assert.match(verifier, /negativeTestEvidence/u);
assert.match(verifier, /RECOVERY_STAGING_NEGATIVE_TEST_EVIDENCE_FILE/u);
assert.match(verifier, /createRecoveryExternalAcquisitionAuthority/u);
assert.match(verifier, /externalEvidenceAcquisitionAuthority/u);
assert.match(negative, /STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS/u);
assert.match(negative, /RECOVERY_STAGING_NEGATIVE_TEST_SUITES_PASSED/u);
assert.match(workflow, /acquire_external_evidence/u);
assert.match(workflow, /staging-recovery-external-acquisition/u);
assert.match(workflow, /RECOVERY_OAUTH_SERVER_CORRELATION_SOURCE_UNAVAILABLE/u);
assert.match(workflow, /RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE/u);
assert.match(workflow, /receipt_signed: false/u);
assert.doesNotMatch(workflow, /STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY/u);
assert.match(acquisitionSigner, /STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY/u);
assert.match(acquisitionSigner, /unavailableRegistrationSourceVerification/u);
assert.match(networkAcquisition, /sourceCommit/u);
assert.match(networkAcquisition, /workerBuildSha/u);
assert.match(networkAcquisition, /workerBundleSha256/u);
assert.match(networkAcquisition, /policyHash/u);
assert.match(networkAcquisition, /secretsIncluded/u);
assert.match(networkAcquisition, /RECOVERY_NETWORK_GATEWAY_IDENTITY_MISMATCH/u);

assert.match(publishPs, /gh run view/u);
assert.match(publishPs, /conclusion -ne "success"/u);
assert.match(publishPs, /headSha/u);
assert.match(publishPs, /signed-certification\.json/u);
assert.match(publishPs, /staging-recovery-publish-countersign\.mjs/u);
assert.match(publishPs, /production_live_enabled/u);

console.log(JSON.stringify({ ok: true, contract: "mad4b.staging-recovery-certification-script-surface-test.v1", secrets_included: false }));
