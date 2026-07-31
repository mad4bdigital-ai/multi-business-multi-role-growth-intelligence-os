import assert from "node:assert/strict";

import {
  _testingProviderConsentActivationPilotCertifiedService,
} from "./contextKernel/application/providerConsentActivationPilotCertifiedService.js";

const sha = "a".repeat(64);

assert.equal(
  _testingProviderConsentActivationPilotCertifiedService.normalizeSha256(
    sha.toUpperCase(),
    "bindingHash",
  ),
  sha,
);
assert.throws(
  () => _testingProviderConsentActivationPilotCertifiedService.normalizeSha256(
    "not-a-sha",
    "bindingHash",
  ),
  /must be a SHA-256 value/,
);

assert.throws(
  () => _testingProviderConsentActivationPilotCertifiedService.assertProviderCertification({
    adapter: { async exchangeAuthorizationCode() {} },
    certification: {
      status: "certified",
      providerKey: "google_drive",
      supportsIdempotency: true,
      timeoutMs: 15000,
    },
  }, "google_drive"),
  /versionRef/,
);

{
  const wrapped = _testingProviderConsentActivationPilotCertifiedService.wrapAuthorizationRepository({
    async issueAuthorizationState() {},
    async claimAuthorizationState() {},
    async completeClaimedAuthorization() {},
    async findAuthorizationState() {
      return { expectedProviderAccountBindingHash: "invalid" };
    },
  });
  await assert.rejects(
    wrapped.findAuthorizationState({ stateRef: "state-1" }),
    /must be a SHA-256 value/,
  );
}

{
  const wrapped = _testingProviderConsentActivationPilotCertifiedService.wrapCredentialEnvelopeService({
    certification: {
      status: "certified",
      algorithm: "aes-256-gcm",
      secretsExcludedFromProjection: true,
      metadataPolicyVersion: "safe.v1",
    },
    async sealProviderCredential() {
      return { providerAccountBindingHash: "invalid" };
    },
  });
  await assert.rejects(
    wrapped.sealProviderCredential({ providerKey: "google_drive" }),
    /must be a SHA-256 value/,
  );
}

console.log("context kernel provider consent activation certification guard tests passed");
