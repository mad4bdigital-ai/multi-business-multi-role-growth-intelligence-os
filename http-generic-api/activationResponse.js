import { buildRateLimitedClassification } from "./activationClassification.js";
import { buildProgressState } from "./activationProgress.js";
import { getRecoveryPolicy } from "./activationRecoveryPolicy.js";
import { buildActivationOperatorView } from "./activationOperatorView.js";
import { checkActivationConsistency } from "./activationConsistencyCheck.js";

function deriveCompletedStages(evidence) {
  const stages = [];
  if (evidence.transport_attempted) stages.push("transport_attempting");
  if (evidence.drive_ok) stages.push("drive_validation");
  if (evidence.sheets_ok) stages.push("sheets_validation");
  if (evidence.bootstrap_row_read && evidence.binding_resolved) stages.push("bootstrap_resolution");
  if (evidence.github_ok) stages.push("github_validation");
  if (evidence.validation_complete) stages.push("final_validation");
  return stages;
}

function deriveBlockedStage(evidence) {
  if (!evidence.transport_attempted) return "transport_attempting";
  if (!evidence.drive_ok) return "drive_validation";
  if (!evidence.sheets_ok) return "sheets_validation";
  if (!(evidence.bootstrap_row_read && evidence.binding_resolved)) return "bootstrap_resolution";
  if (!evidence.github_ok) return "github_validation";
  if (!evidence.validation_complete) return "final_validation";
  return "";
}

export function buildActivationEnvelope(evidence = {}) {
  const completedStages = deriveCompletedStages(evidence);
  const blockedStage = deriveBlockedStage(evidence);
  const progress = buildProgressState(completedStages, blockedStage);
  const runtime_classification = buildRateLimitedClassification(progress);
  const recovery = getRecoveryPolicy(Number(evidence.retry_count) || 0);
  const operator_view = buildActivationOperatorView(
    { ...runtime_classification, evidence },
    progress,
    recovery
  );
  const consistency = checkActivationConsistency(evidence);

  return {
    runtime_classification: {
      ...runtime_classification,
      ...consistency
    },
    recovery,
    operator_view
  };
}
