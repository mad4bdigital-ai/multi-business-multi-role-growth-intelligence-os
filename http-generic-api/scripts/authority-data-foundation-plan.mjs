#!/usr/bin/env node
import fs from "node:fs/promises";

import { compileAuthorityPathInventory } from "../authorityPathInventoryCompiler.js";
import { buildAuthorityDataFoundationPlan } from "../authorityDataFoundationPlanner.js";

function parseArgs(argv) {
  const options = {
    catalog: null,
    pathSources: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--catalog") {
      options.catalog = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg === "--path-sources") {
      options.pathSources = argv[index + 1] || null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.catalog || !options.pathSources) {
    throw new Error("Usage: authority-data-foundation-plan.mjs --catalog <catalog.json> --path-sources <sources.json>");
  }
  return options;
}

async function readJson(path, label) {
  const raw = await fs.readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error(`${label} must contain valid JSON.`);
    error.code = "AUTHORITY_DATA_INVALID_JSON";
    throw error;
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const catalog = await readJson(options.catalog, "catalog");
  const sourceBundle = await readJson(options.pathSources, "path-sources");
  const inventory = compileAuthorityPathInventory({
    source_snapshots: sourceBundle.source_snapshots,
    expected_source_keys: sourceBundle.expected_source_keys || [],
  });
  const plan = buildAuthorityDataFoundationPlan({
    catalog_census: catalog,
    path_inventory: inventory,
  });
  process.stdout.write(`${JSON.stringify({ inventory, plan }, null, 2)}\n`);
} catch (error) {
  const output = {
    ok: false,
    status: "fail",
    contract: "mad4b.ueacp.authority-data-foundation-cli-error.v1",
    error: {
      code: error?.code || "AUTHORITY_DATA_FOUNDATION_PLAN_FAILED",
      message: error?.message || "Authority data foundation planning failed.",
    },
    closure_state: {
      t001_complete: false,
      t002_complete: false,
      t021_complete: false,
      t022_complete: false,
      t023_complete: false,
      t024_complete: false,
      migration_execution_authorized: false,
    },
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = 1;
}
