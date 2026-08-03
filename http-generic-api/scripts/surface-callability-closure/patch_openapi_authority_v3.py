from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "scripts" / "surface-callability-closure" / "generate_closure_contracts.mjs"
source = PATH.read_text(encoding="utf-8")

extractor_import = 'import { extractRegistryToolRegistrations } from "../surface-contract-sql-registry-extractor.mjs";'
authority_import = 'import { canonicalOpenApiAuthority, parseOpenApiContracts } from "../frontend-surface-dispatch.mjs";'
if authority_import not in source:
    if extractor_import not in source:
        raise SystemExit("closure_generator_openapi_import_marker_missing")
    source = source.replace(extractor_import, f"{extractor_import}\n{authority_import}", 1)

replacement = r'''function relativeApiPath(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
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
  if (evidence.file === "openapi/frontend-runtime-routes.generated.yaml") {
    markers.push(`x-source-file: ${family.route_file}`);
  }
  return { file: evidence.file, markers };
}'''

if "const OPENAPI_EVIDENCE_INDEX = buildOpenApiEvidenceIndex();" not in source:
    start = source.find("function openApiEvidence(family, method, httpPath) {")
    end = source.find("\nfunction canonicalBytes", start)
    if start < 0 or end < 0:
        raise SystemExit("closure_generator_openapi_evidence_boundaries_missing")
    source = source[:start] + replacement + source[end:]

legacy = 'const document = route === "/system/tools/call" ? canonicalOpenApi : runtimeOpenApi;'
contract_aware = 'const document = contract.openapi_file === "openapi.yaml" ? canonicalOpenApi : contract.openapi_file === "openapi/frontend-runtime-routes.generated.yaml" ? runtimeOpenApi : null;'
if legacy in source:
    source = source.replace(legacy, contract_aware, 1)
elif contract_aware not in source:
    raise SystemExit("closure_generator_openapi_test_selector_missing")

PATH.write_text(source, encoding="utf-8")
print("closure generator canonical-first OpenAPI authority patch applied")
