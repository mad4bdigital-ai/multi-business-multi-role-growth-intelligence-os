import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { collectOpenApiEndpointInventory } from "./openApiEndpointInventorySync.js";

function yaml(value) {
  return YAML.stringify(value, { lineWidth: -1 });
}

function operation(operationId) {
  return {
    operationId,
    summary: `Fixture ${operationId}`,
    responses: { "200": { description: "OK" } },
  };
}

async function expectCode(run, code) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, code);
    assert.equal(error?.details?.secrets_included, false);
    return true;
  });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openapi-fragment-inventory-"));
try {
  const rootPath = path.join(tempRoot, "openapi.yaml");
  const fragmentDirectory = path.join(tempRoot, "openapi");
  const fragmentPath = path.join(fragmentDirectory, "fragment.yaml");
  const ignoredPath = path.join(fragmentDirectory, "ignored.yaml");
  await mkdir(fragmentDirectory, { recursive: true });

  await writeFile(rootPath, yaml({
    openapi: "3.1.0",
    info: { title: "Root inventory", version: "1.0.0" },
    paths: {
      "/root": { get: operation("rootOperation") },
      "/shared": { get: operation("sharedOperation") },
    },
  }), "utf8");
  await writeFile(fragmentPath, yaml({
    openapi: "3.1.0",
    info: { title: "Fragment inventory", version: "1.0.0" },
    paths: {
      "/fragment": { post: operation("fragmentOperation") },
      "/shared": { get: operation("sharedOperation") },
    },
  }), "utf8");
  await writeFile(ignoredPath, yaml({ metadata: { purpose: "not an OpenAPI document" } }), "utf8");

  const inventory = await collectOpenApiEndpointInventory({ openApiPath: rootPath });
  assert.equal(inventory.operation_count, 3);
  assert.equal(inventory.suppressed_route_duplicate_count, 1);
  assert.equal(inventory.source_document_count, 3);
  assert.deepEqual(
    inventory.operations.map((item) => item.endpoint_key),
    ["fragmentOperation", "rootOperation", "sharedOperation"],
  );
  assert.equal(
    inventory.operations.find((item) => item.endpoint_key === "fragmentOperation")?.source_file,
    "openapi/fragment.yaml",
  );
  assert.match(inventory.source_sha256, /^[a-f0-9]{64}$/);
  assert.match(inventory.source_fingerprint, /^[a-f0-9]{64}$/);

  const rootOnly = await collectOpenApiEndpointInventory({
    openApiPath: rootPath,
    includeSiblingFragments: false,
  });
  assert.equal(rootOnly.operation_count, 2);
  assert.equal(rootOnly.suppressed_route_duplicate_count, 0);
  assert.equal(rootOnly.source_document_count, 1);

  await writeFile(fragmentPath, yaml({
    openapi: "3.1.0",
    info: { title: "Conflicting route", version: "1.0.0" },
    paths: {
      "/shared": { get: operation("differentSharedOperation") },
    },
  }), "utf8");
  const routeConflictInventory = await collectOpenApiEndpointInventory({
    openApiPath: rootPath,
  });
  assert.equal(routeConflictInventory.operation_count, 2);
  assert.equal(routeConflictInventory.suppressed_route_duplicate_count, 0);
  assert.equal(routeConflictInventory.suppressed_route_conflict_count, 1);
  assert.deepEqual(routeConflictInventory.suppressed_route_conflicts, [
    {
      route: "GET /shared",
      authoritative_operation_id: "sharedOperation",
      suppressed_operation_id: "differentSharedOperation",
      source_file: "openapi/fragment.yaml",
    },
  ]);
  assert.equal(
    routeConflictInventory.operations.some(
      (item) => item.endpoint_key === "differentSharedOperation",
    ),
    false,
  );

  await writeFile(fragmentPath, yaml({
    openapi: "3.1.0",
    info: { title: "Conflicting operation id", version: "1.0.0" },
    paths: {
      "/different": { post: operation("rootOperation") },
    },
  }), "utf8");
  await expectCode(
    () => collectOpenApiEndpointInventory({ openApiPath: rootPath }),
    "openapi_inventory_duplicate_operation_id",
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("OpenAPI inventory fragment discovery tests passed");
