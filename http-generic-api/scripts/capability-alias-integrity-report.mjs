#!/usr/bin/env node

import { getPool } from "../db.js";
import { CapabilityInventoryService } from "../src/application/capability/capabilityInventoryService.js";
import { CapabilityRegistryRepository } from "../src/infrastructure/capability/capabilityRegistryRepository.js";

const pool = getPool();
try {
  const repository = new CapabilityRegistryRepository(pool);
  const service = new CapabilityInventoryService(repository);
  const [inventory, integrity] = await Promise.all([
    service.buildInventory(),
    service.buildIntegrityReport(),
  ]);
  console.log(JSON.stringify({
    ok: integrity.status === "pass" && inventory.status === "pass",
    report_key: "canonical_capability_alias_integrity",
    inventory,
    integrity,
    generated_at: new Date().toISOString(),
    secrets_included: false,
  }, null, 2));
  if (integrity.status !== "pass" || inventory.status !== "pass") process.exitCode = 2;
} finally {
  await pool.end();
}
