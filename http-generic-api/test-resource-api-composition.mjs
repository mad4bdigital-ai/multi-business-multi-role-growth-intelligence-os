import assert from "node:assert/strict";
import { createDefaultResourceApiService } from "./src/infrastructure/resourceApi/resourceApiComposition.js";

const dbEnvKeys = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const savedDbEnv = Object.fromEntries(dbEnvKeys.map((key) => [key, process.env[key]]));

try {
  dbEnvKeys.forEach((key) => delete process.env[key]);
  const lazyService = createDefaultResourceApiService();
  assert.equal(lazyService.listResourceTypes().count >= 5, true, "manifest-only startup must not resolve DB config");
  await assert.rejects(
    () => lazyService.adminListResources("sessions", {}),
    (error) => error?.code === "DB_CONFIG_MISSING",
    "first DB-backed request must resolve and validate DB config"
  );
} finally {
  for (const key of dbEnvKeys) {
    if (savedDbEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedDbEnv[key];
  }
}

console.log("resource API lazy composition tests passed");