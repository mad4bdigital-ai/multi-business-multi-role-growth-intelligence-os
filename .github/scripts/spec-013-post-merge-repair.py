from pathlib import Path
from textwrap import dedent


def replace_or_confirm(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    assert count == 1, f"{label}: expected exactly one legacy match, found {count}"
    return text.replace(old, new)


routes_path = Path("http-generic-api/routes/systemLayerRoutes.js")
routes = routes_path.read_text()
old_admin = (
    '  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {\n'
    '    const body = await buildSystemToolsListResponse(req.auth, req.query || {});\n'
    '    return res.status(200).json(await chunkSystemLayerResponse(body, req.query || {}));\n'
    '  });'
)
new_admin = (
    '  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {\n'
    '    try {\n'
    '      const body = await buildSystemToolsListResponse(req.auth, req.query || {});\n'
    '      return res.status(200).json(await chunkSystemLayerResponse(body, req.query || {}));\n'
    '    } catch (error) {\n'
    '      return sendSystemToolCatalogError(res, error, "admin_system_tool_catalog_list_failed");\n'
    '    }\n'
    '  });'
)
routes_path.write_text(replace_or_confirm(routes, old_admin, new_admin, "admin Catalog V2 handler"))

root_path = Path("http-generic-api/openapi.yaml")
root = root_path.read_text()
root_targets = [
    ("/system/tools", "get", "backendBearerAuth"),
    ("/system/tools/catalog-observability", "get", "adminBearerAuth"),
    ("/system/tools/{toolName}", "get", "backendBearerAuth"),
    ("/system/capabilities/resolve", "post", "backendBearerAuth"),
    ("/system/tools/call", "post", "backendBearerAuth"),
]
for path, method, bearer in root_targets:
    old = (
        f"  {path}:\n"
        f"    {method}:\n"
        "      tags: [system-layer]\n"
        f"      security: [{bearer}: [], backendApiKeyAuth: []]"
    )
    new = (
        f"  {path}:\n"
        f"    {method}:\n"
        "      tags: [system-layer]\n"
        f"      security: [{{ {bearer}: [] }}, {{ backendApiKeyAuth: [] }}]"
    )
    root = replace_or_confirm(root, old, new, f"root OpenAPI auth alternatives for {method.upper()} {path}")
root_path.write_text(root)

contract_path = Path("specs/013-system-tool-catalog-v2/contracts/system-tool-catalog-v2.openapi.yaml")
contract = contract_path.read_text()
contract = replace_or_confirm(
    contract,
    "security:\n  - bearerAuth: []",
    "security:\n  - bearerAuth: []\n  - backendApiKeyAuth: []",
    "Spec 013 global auth alternatives",
)
contract = replace_or_confirm(
    contract,
    "      security:\n        - bearerAuth: [admin]",
    "      security:\n        - bearerAuth: [admin]\n        - backendApiKeyAuth: []",
    "Spec 013 observability auth alternatives",
)
contract = replace_or_confirm(
    contract,
    "    bearerAuth:\n      type: http\n      scheme: bearer\n      bearerFormat: JWT",
    "    bearerAuth:\n      type: http\n      scheme: bearer\n      bearerFormat: JWT\n"
    "    backendApiKeyAuth:\n      type: apiKey\n      in: header\n      name: x-api-key",
    "Spec 013 API-key security scheme",
)
contract_path.write_text(contract)

platform_test_path = Path("http-generic-api/test-platform-routes.mjs")
platform_test = platform_test_path.read_text()
marker = "Catalog V2 admin invalid cursor returns stable error"
if marker not in platform_test:
    anchor = '{\n  const r = await get("/system/tools/runtime_endpoint_preview");'
    inserted = (
        '{\n'
        '  const r = await get("/admin/system/tools?cursor=not-a-valid-catalog-cursor");\n'
        '  ok("Catalog V2 admin invalid cursor returns 400", r.status === 400, `got ${r.status}`);\n'
        '  ok("Catalog V2 admin invalid cursor returns stable error", r.body.error?.code === "SYSTEM_TOOL_CATALOG_CURSOR_INVALID", JSON.stringify(r.body));\n'
        '  ok("Catalog V2 admin invalid cursor excludes secrets", r.body.secrets_included === false, JSON.stringify(r.body));\n'
        '}\n'
        '{\n'
        '  const r = await get("/system/tools/runtime_endpoint_preview");'
    )
    platform_test = replace_or_confirm(platform_test, anchor, inserted, "Catalog V2 HTTP regression anchor")
    platform_test_path.write_text(platform_test)

regression_path = Path("http-generic-api/test-system-tool-catalog-v2-post-merge-contract.mjs")
regression = dedent(r'''
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import YAML from "yaml";

    const routes = readFileSync("routes/systemLayerRoutes.js", "utf8");
    const rootText = readFileSync("openapi.yaml", "utf8");
    const root = YAML.parse(rootText);
    const spec = YAML.parse(readFileSync("../specs/013-system-tool-catalog-v2/contracts/system-tool-catalog-v2.openapi.yaml", "utf8"));

    const adminStart = routes.indexOf('router.get("/admin/system/tools"');
    const adminEnd = routes.indexOf('router.post("/admin/system/tools/call"', adminStart);
    assert.ok(adminStart >= 0 && adminEnd > adminStart, "admin Catalog V2 list handler must be discoverable");
    const adminHandler = routes.slice(adminStart, adminEnd);
    assert.match(adminHandler, /try\s*\{/u);
    assert.match(adminHandler, /sendSystemToolCatalogError/u);
    assert.match(adminHandler, /admin_system_tool_catalog_list_failed/u);

    function assertAlternatives(document, path, method, schemes) {
      const security = document.paths?.[path]?.[method]?.security ?? document.security;
      assert.ok(Array.isArray(security), `${method.toUpperCase()} ${path} must declare security alternatives`);
      assert.ok(security.every((entry) => Object.keys(entry || {}).length === 1), `${method.toUpperCase()} ${path} must not combine auth schemes in one requirement object`);
      for (const scheme of schemes) {
        assert.ok(security.some((entry) => Object.hasOwn(entry || {}, scheme)), `${method.toUpperCase()} ${path} must independently allow ${scheme}`);
      }
    }

    for (const [path, method, schemes] of [
      ["/system/tools", "get", ["backendBearerAuth", "backendApiKeyAuth"]],
      ["/system/tools/catalog-observability", "get", ["adminBearerAuth", "backendApiKeyAuth"]],
      ["/system/tools/{toolName}", "get", ["backendBearerAuth", "backendApiKeyAuth"]],
      ["/system/capabilities/resolve", "post", ["backendBearerAuth", "backendApiKeyAuth"]],
      ["/system/tools/call", "post", ["backendBearerAuth", "backendApiKeyAuth"]],
    ]) assertAlternatives(root, path, method, schemes);

    for (const [path, method] of [
      ["/system/tools", "get"],
      ["/system/tools/catalog-observability", "get"],
      ["/system/tools/{toolName}", "get"],
      ["/system/capabilities/resolve", "post"],
    ]) assertAlternatives(spec, path, method, ["bearerAuth", "backendApiKeyAuth"]);
    assert.equal(spec.components?.securitySchemes?.backendApiKeyAuth?.name, "x-api-key");
    assert.equal(spec.components?.securitySchemes?.backendApiKeyAuth?.in, "header");

    console.log("System Tool Catalog V2 post-merge runtime and OpenAPI contract regressions passed");
''').lstrip()
if regression_path.exists():
    assert regression_path.read_text() == regression, "existing post-merge regression differs from bounded closure contract"
else:
    regression_path.write_text(regression)

manifest_path = Path("http-generic-api/scripts/test-manifest.mjs")
manifest = manifest_path.read_text()
command = '  "node test-system-tool-catalog-v2-post-merge-contract.mjs",\n'
if command not in manifest:
    anchor = '  "node test-status-component-readiness-freshness.mjs",\n'
    if anchor in manifest:
        manifest = manifest.replace(anchor, command + anchor, 1)
    else:
        closing = manifest.rfind("];")
        assert closing >= 0, "test manifest command array closing marker not found"
        manifest = manifest[:closing] + command + manifest[closing:]
    manifest_path.write_text(manifest)
