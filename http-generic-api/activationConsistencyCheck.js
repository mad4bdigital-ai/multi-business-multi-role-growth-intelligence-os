function sheetsStepSatisfied(evidence = {}) {
  return evidence.sheets_ok || evidence.sheets_required === false || evidence.sheets_skipped === true;
}

export function checkActivationConsistency(evidence = {}) {
  const warnings = [];

  if (evidence.github_ok && !evidence.binding_resolved) {
    warnings.push("github_ok_without_binding_resolved");
  }

  if (evidence.validation_complete && !(evidence.drive_ok && sheetsStepSatisfied(evidence) && evidence.github_ok)) {
    warnings.push("validation_complete_without_full_provider_chain");
  }

  if (!evidence.transport_attempted && (evidence.drive_ok || evidence.sheets_ok || evidence.github_ok)) {
    warnings.push("provider_success_without_transport_attempt");
  }

  return {
    evidence_consistency: warnings.length ? "contradictory" : "consistent",
    consistency_warnings: warnings
  };
}
