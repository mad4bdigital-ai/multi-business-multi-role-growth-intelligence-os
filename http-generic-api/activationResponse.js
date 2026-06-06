import { classifyActivationFromEvidence } from "./activationStatusClassifier.js";
import { buildProgressState } from "./activationProgress.js";
import { getRecoveryPolicy } from "./activationRecoveryPolicy.js";
import { buildActivationOperatorView } from "./activationOperatorView.js";
import { checkActivationConsistency } from "./activationConsistencyCheck.js";

function sheetsStepSatisfied(evidence = {}) {
  return evidence.sheets_ok || evidence.sheets_required === false || evidence.sheets_skipped === true;
}

function deriveCompletedStages(evidence) {
  const stages = [];
  if (evidence.transport_attempted) stages.push("transport_attempting");
  if (evidence.drive_ok) stages.push("drive_validation");
  if (evidence.sheets_ok) stages.push("sheets_validation");
  else if (evidence.sheets_required === false || evidence.sheets_skipped === true) stages.push("sheets_not_required");
  if (evidence.bootstrap_row_read && evidence.binding_resolved) stages.push("bootstrap_resolution");
  if (evidence.github_ok) stages.push("github_validation");
  if (evidence.validation_complete) stages.push("final_validation");
  return stages;
}

function deriveBlockedStage(evidence) {
  if (!evidence.transport_attempted) return "transport_attempting";
  if (!evidence.drive_ok) return "drive_validation";
  if (!sheetsStepSatisfied(evidence)) return "sheets_validation";
  if (!(evidence.bootstrap_row_read && evidence.binding_resolved)) return "bootstrap_resolution";
  if (!evidence.github_ok) return "github_validation";
  if (!evidence.validation_complete) return "final_validation";
  return "";
}

function buildStateRecovery(classification, evidence) {
  const status = classification.activation_status;
  const reason = classification.reason_code;

  if (status === "validation_rate_limited") {
    return getRecoveryPolicy(Number(evidence.retry_count) || 0);
  }
  if (status === "active") {
    return { retryable: false, recommended_action: "none", retry_after_seconds: null };
  }
  if (status === "authorization_gated") {
    return { retryable: false, recommended_action: "repair_credentials", retry_after_seconds: null };
  }
  if (status === "validating") {
    return { retryable: false, recommended_action: "continue_validation", retry_after_seconds: null };
  }
  // degraded — reason-specific guidance
  if (reason === "executable_binding_mismatch") {
    return { retryable: false, recommended_action: "repair_binding", retry_after_seconds: null };
  }
  return { retryable: false, recommended_action: "re_read_bootstrap", retry_after_seconds: null };
}

export function buildActivationEnvelope(evidence = {}) {
  const completedStages = deriveCompletedStages(evidence);
  const blockedStage = deriveBlockedStage(evidence);
  const progress = buildProgressState(completedStages, blockedStage);
  const classification = classifyActivationFromEvidence(evidence);
  const recovery = buildStateRecovery(classification, evidence);
  const operator_view = buildActivationOperatorView(
    { ...classification, evidence },
    progress,
    recovery
  );
  const consistency = checkActivationConsistency(evidence);

  return {
    runtime_classification: {
      ...classification,
      progress,
      ...consistency
    },
    recovery,
    operator_view
  };
}
