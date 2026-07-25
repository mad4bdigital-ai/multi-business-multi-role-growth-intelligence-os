import { evaluatePlatformTopologyEvidence } from "../../domain/authorityScope/platformTopologyVerification.js";

function requireRepository(repository) {
  if (!repository || typeof repository.readEvidence !== "function") {
    throw new TypeError("Platform topology verification service requires readEvidence().");
  }
}

export function createPlatformTopologyVerificationService({ repository, auditWriter, clock = () => new Date() }) {
  requireRepository(repository);
  if (typeof auditWriter !== "function") {
    throw new TypeError("Platform topology verification service requires an audit writer.");
  }

  async function verify({ actorId = "platform_admin", requestId = null } = {}) {
    const evidence = await repository.readEvidence();
    const assessment = evaluatePlatformTopologyEvidence(evidence);
    try {
      await auditWriter({
        action: "platform_topology_verification_read",
        actorId,
        requestId,
        readinessCode: assessment.readinessCode,
        gapCodes: assessment.gaps.map((item) => item.code),
        gapCount: assessment.summary.gapCount,
      });
    } catch (cause) {
      const error = new Error("Platform topology verification audit event could not be persisted.");
      error.code = "platform_topology_verification_audit_failed";
      error.status = 503;
      error.details = [{ stage: "write_topology_verification_audit" }];
      error.cause = cause;
      throw error;
    }

    return Object.freeze({
      ok: true,
      verificationMode: "read_only",
      verifiedAt: clock().toISOString(),
      ...assessment,
    });
  }

  return Object.freeze({ verify });
}
