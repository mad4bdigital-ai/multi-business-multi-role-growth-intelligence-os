import assert from "node:assert/strict";
import { _testingSurfaceMetadata } from "./surfaceMetadata.js";

let sheetCalls = 0;
let sqlCalls = 0;
const resolved = await _testingSurfaceMetadata.resolveSurfaceCatalogRow("surface-a", {
  dataSourceMode: "sql",
  sqlReadTableDirect: async (tableName) => {
    sqlCalls += 1;
    assert.equal(tableName, "Registry Surfaces Catalog");
    return [{
      surface_id: "surface-a",
      surface_name: "Surface A",
      worksheet_name: "Surface A",
      active_status: "active",
      authority_status: "authoritative",
      required_for_execution: "TRUE",
      schema_ref: "schema:surface-a",
      schema_version: "1",
      header_signature: "a|b",
      expected_column_count: "2",
      binding_mode: "sql_primary",
      sheet_role: "registry",
      audit_mode: "exact_header_match",
    }];
  },
  getRegistrySurfaceCatalogRowBySurfaceId: async () => {
    sheetCalls += 1;
    throw new Error("Sheets must not be called in SQL mode");
  },
});

assert.equal(sqlCalls, 1);
assert.equal(sheetCalls, 0);
assert.equal(resolved.source, "sql_registry_surface_catalog");
assert.equal(resolved.row.surface_id, "surface-a");
assert.equal(resolved.row.schema_ref, "schema:surface-a");

await assert.rejects(
  () => _testingSurfaceMetadata.resolveSurfaceCatalogRow("duplicate", {
    dataSourceMode: "sql",
    sqlReadTableDirect: async () => [
      { surface_id: "duplicate" },
      { surface_id: "duplicate" },
    ],
  }),
  (error) => error?.code === "registry_surface_catalog_ambiguous" && error?.status === 409,
);

console.log("surface metadata SQL authority tests passed");
