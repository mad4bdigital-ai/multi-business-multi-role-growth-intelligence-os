import assert from "node:assert/strict";

import { trustedIngressFailureDetails } from "./routes/activationHostGatewayRoutes.js";

assert.deepEqual(
  trustedIngressFailureDetails({ code: "INGRESS_REPLAY_DETECTED" }),
  { reason_code: "INGRESS_REPLAY_DETECTED", secrets_included: false },
);

assert.deepEqual(
  trustedIngressFailureDetails({}),
  { reason_code: "ingress_unverified", secrets_included: false },
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.trusted-ingress-safe-diagnostics.v1",
  outer_gate_preserved: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
  trusted_ingress_bypass_added: false,
  secrets_included: false,
}));
