// frontend-surface-operation: GET /platform
// frontend-surface-operation: GET /platform/assets/{file}
// frontend-surface-operation: GET /platform/ui-surfaces

import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlatformFrontendRoutes, buildUiSurfaceCatalog } from "./routes/platformFrontendRoutes.js";

const digest = "a".repeat(64);
const plan = {
  schema_version: "frontend-surface-dispatch-v1",
  baseline: { source_digest: digest },
  families: [
    {
      family_key: "platform-frontend",
      label: "Platform frontend",
      source_file: "routes/platformFrontendRoutes.js",
      source_refs: ["routes/platformFrontendRoutes.js", "public/platform/index.html"],
      scope: "public",
      group: "platform-core",
      wave: "F1-tenant-shell",
      embedded_ui: true,
      surface_decision: { decision: "unified_ui", owner: "frontend-platform", rationale: "Governed platform shell." },
      operations: [{ method: "GET", path: "/platform", mutation: false }],
      evidence_routes: [],
    },
    {
      family_key: "tenant-growth",
      label: "Tenant growth",
      source_file: "routes/tenantGrowthRoutes.js",
      source_refs: ["routes/tenantGrowthRoutes.js"],
      scope: "tenant",
      group: "growth",
      wave: "F1-tenant-shell",
      embedded_ui: false,
      surface_decision: { decision: "unified_ui", owner: "growth-platform", rationale: "Approved but contract-blocked tenant experience." },
      operations: [{ method: "GET", path: "/me/growth", mutation: false }],
      evidence_routes: [],
    },
    {
      family_key: "admin-runtime",
      label: "Admin runtime",
      source_file: "routes/adminRuntimeRoutes.js",
      source_refs: ["routes/adminRuntimeRoutes.js"],
      scope: "admin",
      group: "operations",
      wave: "F3-admin-workspaces",
      surface_decision: { decision: "unified_ui", owner: "runtime-operations", rationale: "Admin only." },
      operations: [{ method: "GET", path: "/admin/runtime", mutation: false }],
      evidence_routes: [],
    },
    {
      family_key: "public-internal",
      label: "Internal status",
      source_file: "routes/internalRoutes.js",
      source_refs: ["routes/internalRoutes.js"],
      scope: "public",
      group: "operations",
      wave: "F1-tenant-shell",
      surface_decision: { decision: "internal_only", owner: "runtime-operations", rationale: "Not browser cataloged." },
      operations: [{ method: "GET", path: "/internal", mutation: false }],
      evidence_routes: [],
    },
  ],
  tasks: [
    { task_key: "frontend.platform-frontend", state: "ready" },
    { task_key: "frontend.tenant-growth", state: "blocked" },
    { task_key: "frontend.admin-runtime", state: "ready" },
    { task_key: "frontend.public-internal", state: "ready" },
  ],
};

const directCatalog = buildUiSurfaceCatalog(plan);
assert.equal(directCatalog.ok, true);
assert.equal(directCatalog.secrets_included, false);
assert.deepEqual(directCatalog.surfaces.map((surface) => surface.surface_key), ["tenant-growth", "platform-frontend"]);
assert.equal(directCatalog.surfaces.find((surface) => surface.surface_key === "platform-frontend").status, "live");
assert.equal(directCatalog.surfaces.find((surface) => surface.surface_key === "tenant-growth").status, "locked");
assert.equal(directCatalog.surfaces.find((surface) => surface.surface_key === "tenant-growth").read_endpoint, null);
assert.equal(JSON.stringify(directCatalog).includes("admin-runtime"), false);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "platform-frontend-"));
const dispatchPath = path.join(tempRoot, "dispatch.json");
fs.writeFileSync(dispatchPath, JSON.stringify(plan));

const app = express();
app.use(buildPlatformFrontendRoutes({ dispatchPath }));
app.get("/platform/graph", (_req, res) => res.json({ sentinel: true }));
const server = await new Promise((resolve) => {
  const listener = app.listen(0, () => resolve(listener));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const shell = await fetch(`${baseUrl}/platform`);
  const html = await shell.text();
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get("content-type") || "", /text\/html/);
  assert.match(shell.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="theme-select"/);
  assert.equal(/https?:\/\//.test(html), false, "shell must not load CDN resources");

  for (const [file, contentType] of [["tokens.css", "text/css"], ["shell.css", "text/css"], ["shell.js", "text/javascript"]]) {
    const response = await fetch(`${baseUrl}/platform/assets/${file}`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", new RegExp(contentType));
    assert.equal(body.includes("BACKEND_API_KEY"), false);
  }

  const shellJs = fs.readFileSync("public/platform/shell.js", "utf8");
  const tokensCss = fs.readFileSync("public/platform/tokens.css", "utf8");
  const shellCss = fs.readFileSync("public/platform/shell.css", "utf8");
  assert.match(shellJs, /mad4b_platform_theme/);
  assert.match(shellJs, /prefers-color-scheme: dark/);
  assert.match(tokensCss, /\[data-theme="dark"\]/);
  assert.match(shellCss, /prefers-reduced-motion/);
  assert.match(shellCss, /:focus-visible/);

  const missing = await fetch(`${baseUrl}/platform/assets/not-allowed.js`);
  assert.equal(missing.status, 404);
  const traversal = await fetch(`${baseUrl}/platform/assets/%2e%2e%2fshell.js`);
  assert.equal(traversal.status, 404);

  const catalogResponse = await fetch(`${baseUrl}/platform/ui-surfaces`);
  const catalog = await catalogResponse.json();
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalog.version, "ui-surfaces-v1");
  assert.equal(catalog.baseline_digest, digest);
  assert.equal(catalog.secrets_included, false);
  assert.equal(catalog.surfaces.some((surface) => surface.scope === "admin"), false);

  const graph = await fetch(`${baseUrl}/platform/graph`);
  assert.deepEqual(await graph.json(), { sentinel: true });

  fs.writeFileSync(dispatchPath, "{}");
  const unavailable = await fetch(`${baseUrl}/platform/ui-surfaces`);
  const unavailableBody = await unavailable.json();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailableBody.secrets_included, false);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("platform frontend route, catalog, theme, and containment tests passed");
