import { buildRateLimitedClassification } from "./activationClassification.js";
import { buildProgressState } from "./activationProgress.js";
import { getRecoveryPolicy } from "./activationRecoveryPolicy.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

console.log("== activation classification ==");

{
  const progress = buildProgressState(["drive_validation"], "sheets_validation");
  const result = buildRateLimitedClassification(progress);
  assert(
    "rate-limited classification has correct activation_status",
    result.activation_status === "validation_rate_limited",
    JSON.stringify(result)
  );
  assert(
    "rate-limited classification has correct reason_code",
    result.reason_code === "google_sheets_rate_limited",
    JSON.stringify(result)
  );
  assert(
    "rate-limited classification embeds progress",
    result.progress?.blocked_stage === "sheets_validation",
    JSON.stringify(result)
  );
}

{
  const progress = buildProgressState(["transport_attempting", "drive_validation"], "sheets_validation");
  assert(
    "buildProgressState sets current_stage to blockedStage",
    progress.current_stage === "sheets_validation",
    JSON.stringify(progress)
  );
  assert(
    "buildProgressState preserves completed_stages",
    progress.completed_stages.includes("drive_validation"),
    JSON.stringify(progress)
  );
  assert(
    "buildProgressState sets blocked_stage",
    progress.blocked_stage === "sheets_validation",
    JSON.stringify(progress)
  );
}

{
  const policy = getRecoveryPolicy(0);
  assert(
    "first retry is retryable",
    policy.retryable === true && policy.recommended_action === "retry_after_backoff",
    JSON.stringify(policy)
  );
  assert(
    "first retry backoff is bounded",
    typeof policy.retry_after_seconds === "number" && policy.retry_after_seconds <= 900,
    JSON.stringify(policy)
  );
}

{
  const policy = getRecoveryPolicy(5);
  assert(
    "exhausted retries is not retryable",
    policy.retryable === false && policy.recommended_action === "manual_intervention_required",
    JSON.stringify(policy)
  );
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
