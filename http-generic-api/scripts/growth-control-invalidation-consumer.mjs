#!/usr/bin/env node
import { createGrowthControlInvalidationConsumer } from "../src/application/growthControlPlane/growthControlInvalidationConsumer.js";
import { createGrowthControlInvalidationRepository } from "../src/infrastructure/growthControlPlane/growthControlInvalidationRepository.js";

function parseArgs(argv) {
  const options = { apply: false, limit: 25 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--limit") {
      options.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.apply && process.env.GROWTH_CONTROL_INVALIDATION_APPLY !== "true") {
  const error = new Error("Apply mode requires GROWTH_CONTROL_INVALIDATION_APPLY=true and an active internal consumer.");
  error.code = "GROWTH_CONTROL_INVALIDATION_APPLY_NOT_AUTHORIZED";
  throw error;
}

const repository = createGrowthControlInvalidationRepository();
const consumer = createGrowthControlInvalidationConsumer({ repository });
const result = options.apply
  ? await consumer.apply({ limit: options.limit })
  : await consumer.preview({ limit: options.limit });

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
