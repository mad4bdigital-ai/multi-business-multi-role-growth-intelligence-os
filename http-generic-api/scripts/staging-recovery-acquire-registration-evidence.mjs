import fs from "node:fs";
import {
  buildRecoveryRegistrationParityEvidence,
  unavailableRegistrationSourceVerification,
} from "../stagingRecoveryExternalEvidence.js";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}
const a = args(process.argv);
if (!a["observed-file"]) throw new Error("--observed-file is required");
const observedRegistration = JSON.parse(fs.readFileSync(a["observed-file"], "utf8"));
const evidence = await buildRecoveryRegistrationParityEvidence({
  observedRegistration,
  deploymentSha: a["expected-sha"] || process.env.EXPECTED_SHA || "",
  targetFingerprint: a["target-fingerprint"] || process.env.EXPECTED_TARGET_FINGERPRINT || "",
});
const result = {
  contract: "mad4b.recovery-registration-acquisition-result.v1",
  evidence,
  source_verification: unavailableRegistrationSourceVerification(evidence),
  receipt_signable: false,
  reason_code: "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
  provider_mutation_performed: false,
  production_mutation_performed: false,
  secrets_included: false,
};
const output = JSON.stringify(result, null, 2) + "\n";
if (a["output"]) fs.writeFileSync(a["output"], output, { mode: 0o600 });
else process.stdout.write(output);
