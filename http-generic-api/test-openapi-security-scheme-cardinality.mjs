import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const OPENAPI_DIR = path.join(process.cwd(), "openapi");
const files = fs.readdirSync(OPENAPI_DIR)
  .filter((file) => /^(?:openapi\.)?(?:custom-gpt|tenant-gpt)\..+\.yaml$/u.test(file))
  .sort();

assert.ok(files.length > 0, "published Custom GPT/Tenant OpenAPI artifacts must exist");

const rows = [];
for (const file of files) {
  const document = YAML.parse(fs.readFileSync(path.join(OPENAPI_DIR, file), "utf8"));
  const schemes = Object.keys(document.components?.securitySchemes || {});
  assert.equal(schemes.length, 1, `${file} must declare exactly one security scheme`);
  const scheme = schemes[0];
  const requirements = [];
  if (Array.isArray(document.security)) requirements.push(...document.security);
  for (const [pathKey, pathItem] of Object.entries(document.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!/^(get|post|put|patch|delete|options|head|trace)$/u.test(method)) continue;
      if (Array.isArray(operation.security)) requirements.push(...operation.security);
      for (const requirement of operation.security || []) {
        assert.deepEqual(Object.keys(requirement || {}), [scheme], `${file} ${method.toUpperCase()} ${pathKey} must use only ${scheme}`);
      }
    }
  }
  for (const requirement of requirements) {
    assert.deepEqual(Object.keys(requirement || {}), [scheme], `${file} security requirement must use only ${scheme}`);
  }
  rows.push({ file, scheme, requirement_count: requirements.length });
}

console.log(JSON.stringify({
  contract: "mad4b.openapi.security-scheme-cardinality.v1",
  artifact_count: rows.length,
  rows,
  secrets_included: false
}, null, 2));
console.log("OpenAPI security scheme cardinality tests passed");
