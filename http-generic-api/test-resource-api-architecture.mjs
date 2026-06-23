import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDefaultResourceApiService } from "./src/infrastructure/resourceApi/resourceApiComposition.js";

const files = {
  routes: readFileSync("routes/resourceApiRoutes.js", "utf8"),
  controller: readFileSync("src/api/resourceApi/resourceApiController.js", "utf8"),
  application: readFileSync("src/application/resourceApi/resourceApiService.js", "utf8"),
  domain: readFileSync("src/domain/resourceApi/resourceCatalog.js", "utf8"),
  repository: readFileSync("src/infrastructure/resourceApi/resourceRepository.js", "utf8"),
  composition: readFileSync("src/infrastructure/resourceApi/resourceApiComposition.js", "utf8"),
};

const sqlStatementPattern = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM|CREATE\s+(?:TABLE|VIEW))\b/i;

assert(!sqlStatementPattern.test(files.routes), "route layer must not contain SQL");
assert(!sqlStatementPattern.test(files.controller), "controller layer must not contain SQL");
assert(!sqlStatementPattern.test(files.application), "application layer must not contain SQL");
assert(!sqlStatementPattern.test(files.domain), "domain layer must not contain SQL");
assert(sqlStatementPattern.test(files.repository), "repository must own resource SQL");

assert(!files.routes.includes("../db.js"), "route layer must not import the database");
assert(!files.routes.includes("sessionSummaryService"), "route layer must not import summary infrastructure");
assert(!files.routes.includes("resourceApiCoverageService"), "route layer must not import audit infrastructure");
assert(!files.controller.includes("db.js"), "controller must not import the database");
assert(!files.application.includes("db.js"), "application service must not import the database");
assert(!files.application.includes("express"), "application service must not depend on Express");
assert(!files.application.includes("jsonwebtoken"), "application service must not parse transport authentication");
assert(!files.domain.includes("express"), "domain must not depend on Express");
assert(!files.domain.includes("jsonwebtoken"), "domain must not parse JWTs");
assert(!files.repository.includes("express"), "repository must not depend on Express");
assert(!files.repository.includes("jsonwebtoken"), "repository must not parse JWTs");

assert(files.composition.includes("../../../db.js"), "composition root must wire the SQL pool");
assert(files.composition.includes("sessionSummaryService.js"), "composition root must wire summary infrastructure");
assert(files.composition.includes("resourceApiCoverageService.js"), "composition root must wire audit infrastructure");
assert(files.routes.includes("createDefaultResourceApiService"), "route layer must resolve an application service through composition");
assert(files.routes.includes("createResourceApiController"), "route layer must delegate to a controller");

const routeLines = files.routes.split(/\r?\n/).length;
assert(routeLines <= 130, `resourceApiRoutes.js must remain transport-only; found ${routeLines} lines`);

for (const route of [
  'router.get("/admin/resource-types"',
  'router.get("/admin/resource-coverage/audit"',
  'router.get("/me/workspaces/:tenant_id/resources"',
  'router.get("/gpt/sessions/:id/turns"',
]) {
  assert(files.routes.includes(route), `missing route registration ${route}`);
}

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
console.log("resource API architecture boundary tests passed");
