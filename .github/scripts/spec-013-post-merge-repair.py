import re
from pathlib import Path
from textwrap import dedent


def fail(label: str, detail: str) -> None:
    raise AssertionError(f"{label}: {detail}")


def indentation(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def operation_bounds(lines: list[str], path: str, method: str, label: str) -> tuple[int, int]:
    path_marker = f"  {path}:"
    path_matches = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == path_marker]
    if len(path_matches) != 1:
        fail(label, f"expected one path marker {path_marker!r}, found {len(path_matches)}")
    path_start = path_matches[0]
    path_end = len(lines)
    for index in range(path_start + 1, len(lines)):
        stripped = lines[index].rstrip("\r\n")
        if indentation(stripped) == 2 and stripped.lstrip().startswith("/") and stripped.endswith(":"):
            path_end = index
            break
        if indentation(stripped) == 0 and stripped and not stripped.startswith("#"):
            path_end = index
            break

    method_marker = f"    {method}:"
    method_matches = [
        index
        for index in range(path_start + 1, path_end)
        if lines[index].rstrip("\r\n") == method_marker
    ]
    if len(method_matches) != 1:
        fail(label, f"expected one method marker {method_marker!r}, found {len(method_matches)}")
    operation_start = method_matches[0]
    operation_end = path_end
    for index in range(operation_start + 1, path_end):
        stripped = lines[index].rstrip("\r\n")
        if indentation(stripped) == 4 and stripped and not stripped.lstrip().startswith("#"):
            operation_end = index
            break
    return operation_start, operation_end


def canonicalize_operation_security(
    text: str,
    path: str,
    method: str,
    security_lines: list[str],
    label: str,
) -> str:
    lines = text.splitlines(keepends=True)
    operation_start, operation_end = operation_bounds(lines, path, method, label)
    security_matches = [
        index
        for index in range(operation_start + 1, operation_end)
        if indentation(lines[index].rstrip("\r\n")) == 6
        and lines[index].lstrip().startswith("security:")
    ]
    if len(security_matches) != 1:
        excerpt = "".join(lines[operation_start:operation_end])[:1200]
        fail(label, f"expected one operation security declaration, found {len(security_matches)}; operation={excerpt!r}")
    security_start = security_matches[0]
    security_end = security_start + 1
    while security_end < operation_end:
        stripped = lines[security_end].rstrip("\r\n")
        if not stripped:
            break
        if indentation(stripped) <= 6:
            break
        security_end += 1
    replacement = [f"{line}\n" for line in security_lines]
    if lines[security_start:security_end] != replacement:
        lines[security_start:security_end] = replacement
    return "".join(lines)


def canonicalize_top_level_security(text: str, label: str) -> str:
    lines = text.splitlines(keepends=True)
    matches = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == "security:"]
    if len(matches) != 1:
        fail(label, f"expected one top-level security declaration, found {len(matches)}")
    start = matches[0]
    end = start + 1
    while end < len(lines):
        stripped = lines[end].rstrip("\r\n")
        if stripped and indentation(stripped) == 0 and not stripped.startswith("#"):
            break
        end += 1
    replacement = [
        "security:\n",
        "  - bearerAuth: []\n",
        "  - backendApiKeyAuth: []\n",
    ]
    if lines[start:end] != replacement:
        lines[start:end] = replacement
    return "".join(lines)


def ensure_backend_api_key_scheme(text: str, label: str) -> str:
    lines = text.splitlines(keepends=True)
    if any(line.rstrip("\r\n") == "    backendApiKeyAuth:" for line in lines):
        return text
    scheme_root_matches = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == "  securitySchemes:"]
    if len(scheme_root_matches) != 1:
        fail(label, f"expected one securitySchemes block, found {len(scheme_root_matches)}")
    root_start = scheme_root_matches[0]
    bearer_matches = [
        index
        for index in range(root_start + 1, len(lines))
        if lines[index].rstrip("\r\n") == "    bearerAuth:"
    ]
    if len(bearer_matches) != 1:
        fail(label, f"expected one bearerAuth scheme, found {len(bearer_matches)}")
    insert_at = bearer_matches[0] + 1
    while insert_at < len(lines):
        stripped = lines[insert_at].rstrip("\r\n")
        if stripped and indentation(stripped) <= 4:
            break
        insert_at += 1
    lines[insert_at:insert_at] = [
        "    backendApiKeyAuth:\n",
        "      type: apiKey\n",
        "      in: header\n",
        "      name: x-api-key\n",
    ]
    return "".join(lines)


routes_path = Path("http-generic-api/routes/systemLayerRoutes.js")
routes = routes_path.read_text()
admin_start = routes.find('router.get("/admin/system/tools"')
admin_end = routes.find('router.post("/admin/system/tools/call"', admin_start)
if admin_start < 0 or admin_end <= admin_start:
    fail("admin Catalog V2 handler", "handler boundaries are not discoverable")
admin_handler = routes[admin_start:admin_end]
required_admin_markers = (
    "try {",
    "sendSystemToolCatalogError",
    "admin_system_tool_catalog_list_failed",
)
if not all(marker in admin_handler for marker in required_admin_markers):
    legacy_body = re.compile(
        r'(?m)^(?P<indent>[ \t]+)const body = await buildSystemToolsListResponse\(req\.auth, req\.query \|\| \{\}\);\r?\n'
        r'(?P=indent)return res\.status\(200\)\.json\(await chunkSystemLayerResponse\(body, req\.query \|\| \{\}\)\);$'
    )
    matches = list(legacy_body.finditer(admin_handler))
    if len(matches) != 1:
        fail(
            "admin Catalog V2 handler",
            f"expected one legacy response body, found {len(matches)}; handler={admin_handler[:1200]!r}",
        )
    indent = matches[0].group("indent")
    repaired_body = (
        f"{indent}try {{\n"
        f"{indent}  const body = await buildSystemToolsListResponse(req.auth, req.query || {{}});\n"
        f"{indent}  return res.status(200).json(await chunkSystemLayerResponse(body, req.query || {{}}));\n"
        f"{indent}}} catch (error) {{\n"
        f"{indent}  return sendSystemToolCatalogError(res, error, \"admin_system_tool_catalog_list_failed\");\n"
        f"{indent}}}"
    )
    admin_handler = legacy_body.sub(repaired_body, admin_handler, count=1)
    routes = routes[:admin_start] + admin_handler + routes[admin_end:]
routes_path.write_text(routes)

root_path = Path("http-generic-api/openapi.yaml")
root = root_path.read_text()
for path, method, bearer in [
    ("/system/tools", "get", "backendBearerAuth"),
    ("/system/tools/catalog-observability", "get", "adminBearerAuth"),
    ("/system/tools/{toolName}", "get", "backendBearerAuth"),
    ("/system/capabilities/resolve", "post", "backendBearerAuth"),
    ("/system/tools/call", "post", "backendBearerAuth"),
]:
    root = canonicalize_operation_security(
        root,
        path,
        method,
        [f"      security: [{{ {bearer}: [] }}, {{ backendApiKeyAuth: [] }}]"],
        f"root OpenAPI auth alternatives for {method.upper()} {path}",
    )
root_path.write_text(root)

contract_path = Path("specs/013-system-tool-catalog-v2/contracts/system-tool-catalog-v2.openapi.yaml")
contract = contract_path.read_text()
contract = canonicalize_top_level_security(contract, "Spec 013 global auth alternatives")
contract = canonicalize_operation_security(
    contract,
    "/system/tools/catalog-observability",
    "get",
    [
        "      security:",
        "        - bearerAuth: [admin]",
        "        - backendApiKeyAuth: []",
    ],
    "Spec 013 observability auth alternatives",
)
contract = ensure_backend_api_key_scheme(contract, "Spec 013 API-key security scheme")
contract_path.write_text(contract)

platform_test_path = Path("http-generic-api/test-platform-routes.mjs")
platform_test = platform_test_path.read_text()
marker = "Catalog V2 admin invalid cursor returns stable error"
if marker not in platform_test:
    anchor_statement = '  const r = await get("/system/tools/runtime_endpoint_preview");'
    statement_index = platform_test.find(anchor_statement)
    if statement_index < 0:
        fail("Catalog V2 HTTP regression anchor", "runtime endpoint preview statement not found")
    statement_line_start = platform_test.rfind("\n", 0, statement_index) + 1
    block_line_start = platform_test.rfind("\n", 0, max(0, statement_line_start - 1)) + 1
    if platform_test[block_line_start:statement_line_start].strip() != "{":
        fail(
            "Catalog V2 HTTP regression anchor",
            f"expected opening block before runtime preview; context={platform_test[max(0, block_line_start - 200):statement_index + 200]!r}",
        )
    inserted = (
        '{\n'
        '  const r = await get("/admin/system/tools?cursor=not-a-valid-catalog-cursor");\n'
        '  ok("Catalog V2 admin invalid cursor returns 400", r.status === 400, `got ${r.status}`);\n'
        '  ok("Catalog V2 admin invalid cursor returns stable error", r.body.error?.code === "SYSTEM_TOOL_CATALOG_CURSOR_INVALID", JSON.stringify(r.body));\n'
        '  ok("Catalog V2 admin invalid cursor excludes secrets", r.body.secrets_included === false, JSON.stringify(r.body));\n'
        '}\n'
    )
    platform_test = platform_test[:block_line_start] + inserted + platform_test[block_line_start:]
platform_test_path.write_text(platform_test)

regression_path = Path("http-generic-api/test-system-tool-catalog-v2-post-merge-contract.mjs")
regression = dedent(r'''
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import YAML from "yaml";

    const routes = readFileSync("routes/systemLayerRoutes.js", "utf8");
    const root = YAML.parse(readFileSync("openapi.yaml", "utf8"));
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
        if closing < 0:
            fail("test manifest registration", "command array closing marker not found")
        manifest = manifest[:closing] + command + manifest[closing:]
manifest_path.write_text(manifest)
