#!/usr/bin/env node
import { loadRegistry, validateRegistry } from "./governed-command-core.mjs";

try {
  const registry = loadRegistry();
  const result = validateRegistry(registry);
  console.log(JSON.stringify({
    contract: registry.contract,
    outcome: "passed",
    command_count: result.commandCount,
  }));
} catch (error) {
  console.error(`Governed command registry validation failed: ${error.message}`);
  process.exit(1);
}
