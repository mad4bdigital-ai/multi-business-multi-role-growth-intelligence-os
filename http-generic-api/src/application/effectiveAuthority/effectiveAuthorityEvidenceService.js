import { EffectiveAuthorityError } from "../../domain/effectiveAuthority/effectiveAuthority.js";
import { normalizeEffectiveAuthorityEvidenceMode } from "../../domain/effectiveAuthority/effectiveAuthorityEvidence.js";

function safeCauseCode(error) {
  const code = String(error?.code || "AUTHORITY_EVIDENCE_WRITE_FAILED").trim();
  return /^[A-Z0-9_]{1,191}$/.test(code) ? code : "AUTHORITY_EVIDENCE_WRITE_FAILED";
}

export function createEffectiveAuthorityEvidenceService({
  repository = null,
  mode = "disabled",
  logger = null,
  now = () => new Date(),
} = {}) {
  const normalizedMode = normalizeEffectiveAuthorityEvidenceMode(mode);
  const enabled = normalizedMode !== "disabled";
  if (
    enabled &&
    (!repository ||
      typeof repository.insertDecision !== "function" ||
      typeof repository.insertDriftEvent !== "function")
  ) {
    throw new TypeError(
      "Enabled effective authority evidence requires decision and drift repository methods."
    );
  }

  async function record({ manifest, projectionConsistency = null, source = "ueacp_runtime" }) {
    if (!enabled) {
      return Object.freeze({ status: "disabled", mode: normalizedMode, driftEventCount: 0 });
    }

    try {
      const decision = await repository.insertDecision({
        manifest,
        persistenceMode: normalizedMode,
        evidenceSource: source,
      });
      const driftEvents = [];
      if (projectionConsistency?.driftDetected === true) {
        for (const issueCode of projectionConsistency.issueCodes || []) {
          driftEvents.push(
            await repository.insertDriftEvent({
              decisionId: manifest.decisionId,
              tenantId: manifest.subjectScope?.tenantId || null,
              projectionConsistency,
              issueCode,
              detectedAt: now(),
            })
          );
        }
      }
      return Object.freeze({
        status: "persisted",
        mode: normalizedMode,
        decisionId: decision.decisionId,
        manifestSha256: decision.manifestSha256,
        readbackVerified: decision.readbackVerified === true,
        driftEventCount: driftEvents.length,
      });
    } catch (error) {
      const causeCode = safeCauseCode(error);
      if (normalizedMode === "best_effort") {
        if (typeof logger?.warn === "function") {
          logger.warn({
            event: "ueacp_shadow_evidence_degraded",
            code: causeCode,
            decisionId: manifest?.decisionId || null,
            secretsIncluded: false,
          });
        }
        return Object.freeze({
          status: "degraded",
          mode: normalizedMode,
          code: causeCode,
          driftEventCount: 0,
        });
      }
      throw new EffectiveAuthorityError(
        "AUTHORITY_EVIDENCE_PERSISTENCE_REQUIRED",
        "Effective authority evidence could not be persisted.",
        503,
        { causeCode }
      );
    }
  }

  return Object.freeze({ enabled, mode: normalizedMode, record });
}
