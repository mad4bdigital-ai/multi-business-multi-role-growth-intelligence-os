from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "scripts" / "surface-callability-closure" / "generate_closure_contracts.mjs"
source = PATH.read_text(encoding="utf-8")

old_import = 'import { extractRegistryToolRegistrations } from "../surface-contract-sql-registry-extractor.mjs";'
new_import = '''import { extractRegistryToolRegistrations } from "../surface-contract-sql-registry-extractor.mjs";
import { canonicalOpenApiAuthority, parseOpenApiContracts } from "../frontend-surface-dispatch.mjs";'''
if old_import in source:
    source = source.replace(old_import, new_import, 1)
elif new_import not in source:
    raise SystemExit("closure_generator_openapi_import_marker_missing")

old_openapi = '''function openApiEvidence(family, method, httpPath) {
  if (family.key === "system_layer") {
    return { file: "openapi.yaml", markers: ["/system/tools/call:", "operationId: callSystemTool", "backendBearerAuth", "backendApiKeyAuth"] };
  }
  return { file: "openapi/frontend-runtime-routes.generated.yaml", markers: [`  ${httpPath}:`, `${method.toLowerCase()}:`, `x-source-file: ${family.route_file}`] };
}'''
new_openapi = '''function relativeApiPath(file) {
  return path.relative(ROOT, file).replace(/\\\\/g, "/");
}
function buildOpenApiEvidenceIndex() {
  const index = new Map();
  const register = (sourcePath, priority) => {
    if (!fs.existsSync(sourcePath)) return;
    const contracts = parseOpenApiContracts(fs.readFileSync(sourcePath, "utf8"), { sourcePath, apiRoot: ROOT });
    for (const [signature, contract] of contracts) {
      const file = contract.source_file || relativeApiPath(sourcePath);
      const existing = index.get(signature);
      if (existing && existing.priority === priority && existing.file !== file) {
        throw new Error(`surface_openapi_operation_ambiguous:${signature}:${existing.file}:${file}`);
      }
      if (!existing || priority < existing.priority) {
        index.set(signature, {
          priority,
          file,
          operation_id: contract.operation_id || null,
        });
      }
    }
  };
  const authority = canonicalOpenApiAuthority({ apiRoot: ROOT });
  for (const file of authority.files) register(file, 0);
  register(path.join(ROOT, "openapi", "frontend-runtime-routes.generated.yaml"), 1);
  return index;
}
const OPENAPI_EVIDENCE_INDEX = buildOpenApiEvidenceIndex();
function openApiEvidence(family, method, httpPath) {
  const signature = `${method} ${httpPath}`;
  const evidence = OPENAPI_EVIDENCE_INDEX.get(signature);
  if (!evidence) throw new Error(`surface_openapi_operation_missing:${signature}`);
  const markers = [`  ${httpPath}:`, `    ${method.toLowerCase()}:`];
  if (evidence.operation_id) markers.push(`operationId: ${evidence.operation_id}`);
  if (evidence.file === "openapi/frontend-runtime-routes.generated.yaml") markers.push(`x-source-file: ${family.route_file}`);
  return { file: evidence.file, markers };
}'''
if old_openapi in source:
    source = source.replace(old_openapi, new_openapi, 1)
elif new_openapi not in source:
    raise SystemExit("closure_generator_openapi_evidence_marker_missing")

old_test_openapi = r'''const runtimeOpenApi = YAML.parse(fs.readFileSync(\"openapi/frontend-runtime-routes.generated.yaml\", \"utf8\"));\nconst canonicalOpenApi = YAML.parse(fs.readFileSync(\"openapi.yaml\", \"utf8\"));\nfor (const contract of manifest.contracts) {\n  const [method, route] = contract.route_signature.split(/\\s+/, 2);\n  const document = route === \"/system/tools/call\" ? canonicalOpenApi : runtimeOpenApi;\n  assert(document.paths?.[route]?.[method.toLowerCase()], `OpenAPI operation missing: ${contract.route_signature}`);\n}'''
new_test_openapi = r'''const openApiDocuments = new Map();\nfor (const contract of manifest.contracts) {\n  const [method, route] = contract.route_signature.split(/\\s+/, 2);\n  if (!openApiDocuments.has(contract.openapi_file)) openApiDocuments.set(contract.openapi_file, YAML.parse(fs.readFileSync(contract.openapi_file, \"utf8\")));\n  const document = openApiDocuments.get(contract.openapi_file);\n  assert(document.paths?.[route]?.[method.toLowerCase()], `OpenAPI operation missing: ${contract.route_signature} in ${contract.openapi_file}`);\n}'''
if old_test_openapi in source:
    source = source.replace(old_test_openapi, new_test_openapi, 1)
elif new_test_openapi not in source:
    raise SystemExit("closure_generator_openapi_test_marker_missing")

PATH.write_text(source, encoding="utf-8")
print("closure generator OpenAPI authority patch applied")
