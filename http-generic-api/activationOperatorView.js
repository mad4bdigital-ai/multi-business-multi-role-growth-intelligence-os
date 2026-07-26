export function buildActivationOperatorView(classification = {}, progress = {}, recovery = {}) {
  const evidence = classification.evidence || {};
  const succeeded = [];

  if (evidence.drive_ok) succeeded.push("Google Drive");
  if (evidence.sheets_ok) succeeded.push("Google Sheets");
  else if (evidence.sheets_required === false || evidence.sheets_skipped === true) succeeded.push("DB bootstrap config");
  if (evidence.github_ok) succeeded.push("GitHub");

  let headline = "Activation is being evaluated.";
  let blocked = "";

  switch (classification.activation_status) {
    case "active":
      headline = "Activation is complete.";
      break;
    case "validating":
      headline = "Activation is partially validated.";
      blocked = progress.blocked_stage
        ? `Validation is currently blocked at ${progress.blocked_stage}.`
        : "Validation is still in progress.";
      break;
    case "validation_rate_limited":
      headline = "Activation is rate-limited.";
      blocked = "Google Sheets activation binding reads are currently rate-limited.";
      break;
    case "authorization_gated":
      headline = "Activation is blocked by authorization.";
      blocked = "A required provider authorization step failed.";
      break;
    case "degraded":
      headline = "Activation is degraded.";
      blocked = classification.reason_code
        ? `Current blocker: ${classification.reason_code}.`
        : "A governed activation requirement is not satisfied.";
      break;
    default:
      break;
  }

  return {
    headline,
    what_succeeded: succeeded,
    what_is_blocked: blocked,
    next_best_action: recovery.recommended_action || "none"
  };
}
