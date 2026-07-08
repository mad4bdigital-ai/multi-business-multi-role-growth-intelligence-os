#!/usr/bin/env node

import { getPool } from "../db.js";
import {
  CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS,
  transitionCapabilityEnvelopeLifecycle,
} from "../capabilityResolutionEnvelopeGuard.js";

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return String(args[index + 1] || "").trim();
  const prefix = `${name}=`;
  const match = args.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match).slice(prefix.length).trim() : "";
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    envelopeId: argValue(argv, "--envelope-id"),
    action: argValue(argv, "--action"),
    executionRef: argValue(argv, "--execution-ref"),
    reason: argValue(argv, "--reason"),
  };
}

async function main() {
  const args = parseArgs();
  if (!args.envelopeId) {
    throw Object.assign(new Error("--envelope-id is required."), { code: "capability_resolution_envelope_id_missing" });
  }
  if (!CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS.includes(args.action)) {
    throw Object.assign(new Error(`--action must be one of: ${CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS.join(", ")}.`), { code: "capability_resolution_envelope_lifecycle_action_invalid" });
  }
  const result = await transitionCapabilityEnvelopeLifecycle({
    pool: getPool(),
    envelopeId: args.envelopeId,
    action: args.action,
    executionRef: args.executionRef,
    reason: args.reason,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code || "capability_envelope_lifecycle_failed", message: error.message }, secrets_included: false }, null, 2)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await getPool().end().catch(() => null);
    });
}

export const __test__ = { parseArgs };
