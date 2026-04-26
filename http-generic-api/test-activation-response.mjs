import { buildActivationEnvelope } from "./activationResponse.js";

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

console.log("== activation response envelope ==");

{
  const envelope = buildActivationEnvelope({
    transport_attempted: true,
    drive_ok: true,
    sheets_ok: false,
    rate_limited: true
  });

  assert(
    "envelope contains runtime classification",
    envelope.runtime_classification?.activation_status === "validation_rate_limited",
    JSON.stringify(envelope)
  );

  assert(
    "envelope contains recovery block",
    envelope.recovery?.recommended_action === "retry_after_backoff",
    JSON.stringify(envelope)
  );

  assert(
    "envelope contains operator view headline",
    typeof envelope.operator_view?.headline === "string" && envelope.operator_view.headline.length > 0,
    JSON.stringify(envelope)
  );

  assert(
    "envelope progress reflects drive completed",
    envelope.runtime_classification?.progress?.completed_stages?.includes("drive_validation"),
    JSON.stringify(envelope)
  );

  assert(
    "envelope blocked at sheets_validation",
    envelope.runtime_classification?.progress?.blocked_stage === "sheets_validation",
    JSON.stringify(envelope)
  );
}

{
  const envelope = buildActivationEnvelope({
    transport_attempted: true,
    drive_ok: true,
    sheets_ok: false,
    rate_limited: true,
    retry_count: 2
  });

  const expectedBackoff = 60 * Math.pow(2, 2);
  assert(
    "retry_count drives exponential backoff",
    envelope.recovery?.retry_after_seconds === expectedBackoff,
    JSON.stringify(envelope.recovery)
  );
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
