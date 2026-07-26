#!/usr/bin/env node
import { buildPhase1CapabilityDiscoveryReport } from "../phase1CapabilityDiscoveryReport.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=", 2);
    return [key.replaceAll("-", "_"), value];
  }),
);

buildPhase1CapabilityDiscoveryReport({
  limit: args.limit,
  scan_limit: args.scan_limit,
}).then((report) => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: error?.code || "phase1_capability_discovery_report_failed",
      message: error?.message || String(error),
    },
    secrets_included: false,
  })}\n`);
  process.exitCode = 1;
});
