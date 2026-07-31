import { evaluateShadowAuthorityParity } from "../domain/shadowAuthorityParityDecision.js";
import {
  freezeApplicationValue,
  optionalApplicationString,
  requireApplicationObject,
  sanitizeApplicationValue,
} from "./applicationSupport.js";

function assertShadowOnlyResult(result) {
  if (
    result?.shadowMode !== true
    || result?.parityOnly !== true
    || result?.rolloutApproved !== false
    || result?.authorityGranted !== false
    || result?.executionAuthorized !== false
    || result?.executionPerformed !== false
    || result?.runtimeAuthorityChanged !== false
    || result?.automaticWritePerformed !== false
    || result?.providerCallMade !== false
    || result?.credentialPayloadRead !== false
    || result?.secretsIncluded !== false
  ) {
    const error = new Error("Shadow authority parity result violated no-effect invariants.");
    error.code = "shadow_authority_parity_security_invariant_failed";
    throw error;
  }
}

export function createShadowAuthorityParityService() {
  function compare(input = {}) {
    const legacySnapshot = requireApplicationObject(input.legacySnapshot, "legacySnapshot");
    const effectiveSnapshot = requireApplicationObject(input.effectiveSnapshot, "effectiveSnapshot");
    const correlationRef = optionalApplicationString(input.correlationRef);
    const now = input.now instanceof Date ? input.now : new Date();
    if (Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date.");

    const decision = evaluateShadowAuthorityParity({
      legacySnapshot: sanitizeApplicationValue(legacySnapshot),
      effectiveSnapshot: sanitizeApplicationValue(effectiveSnapshot),
      now,
    });
    assertShadowOnlyResult(decision);

    return freezeApplicationValue({
      ...decision,
      comparisonRef: correlationRef,
      comparator: "ueacp_shadow_authority_parity_v1",
      persistenceRequested: false,
      evidencePersisted: false,
      rolloutApproved: false,
      authorityGranted: false,
      executionAuthorized: false,
      executionPerformed: false,
      runtimeAuthorityChanged: false,
      automaticWritePerformed: false,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ compare });
}

export const _testingShadowAuthorityParityService = Object.freeze({
  assertShadowOnlyResult,
});
