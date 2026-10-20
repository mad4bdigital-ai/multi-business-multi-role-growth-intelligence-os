import fs from "node:fs";
import { buildRecoveryOAuthServerCorrelationEvidence } from "../stagingRecoveryExternalEvidence.js";

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
if (!a["events-file"]) throw new Error("--events-file is required");
const eventsDocument = JSON.parse(fs.readFileSync(a["events-file"], "utf8"));
if (eventsDocument?.contract !== "mad4b.recovery-oauth-server-correlation-events.v1") {
  throw new Error("OAuth server correlation event contract is invalid.");
}
if (eventsDocument?.secrets_included !== false) {
  throw new Error("OAuth server correlation input must assert secrets_included=false.");
}
const evidence = buildRecoveryOAuthServerCorrelationEvidence({
  events: eventsDocument.events,
  deploymentSha: a["expected-sha"] || process.env.EXPECTED_SHA || "",
  targetFingerprint: a["target-fingerprint"] || process.env.EXPECTED_TARGET_FINGERPRINT || "",
});
const output = JSON.stringify(evidence, null, 2) + "\n";
if (a["output"]) fs.writeFileSync(a["output"], output, { mode: 0o600 });
else process.stdout.write(output);
