import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const artifactNames = [
  "openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  "openapi/openapi.custom-gpt.activation-admin.yaml",
  "openapi/openapi.tenant-gpt.auth.yaml",
  "openapi/openapi.tenant-gpt.activation.yaml",
];
const mutationMethods = new Set(["post", "put", "patch", "delete"]);
const operations = [];

for (const relative of artifactNames) {
  const file = path.join(root, relative);
  const document = parse(fs.readFileSync(file, "utf8"));
  for (const [routePath, item] of Object.entries(document.paths || {})) {
    for (const method of mutationMethods) {
      const operation = item?.[method];
      if (!operation) continue;
      const securityScopes = Object.values(operation.security?.[0]?.userBearerAuth || {});
      operations.push({
        surface: path.basename(file, ".yaml"),
        artifact: relative,
        method: method.toUpperCase(),
        path: routePath,
        operation_id: String(operation.operationId || "").trim(),
        effect_class: method === "delete" || /(?:restore|transition|decide|apply|install|rotate|revoke|destroy|remove)/iu.test(routePath) ? "destructive" : "internal_write",
        declared_security_scopes: securityScopes.map((scope) => String(scope).replace(/^https?:\/\/[^/]+\/scopes\//u, "")).sort(),
        policy_status: "unbound",
        required_scope: null,
        reason: "No write scope is promoted; operation remains explicitly denied until independent resource-operation approval, capability, lease, and readback policy is reviewed.",
        owner: "platform-governance",
        review_after: "2026-09-30",
      });
    }
  }
}
operations.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
const payload = {
  schema_version: 1,
  generated_from: artifactNames,
  operation_count: operations.length,
  unbound_operation_count: operations.filter((operation) => operation.policy_status !== "bound").length,
  all_operations_accounted_for: operations.every((operation) => operation.operation_id && operation.method && operation.path),
  write_activation_allowed: false,
  source_fingerprint_sha256: crypto.createHash("sha256").update(artifactNames.map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n")).digest("hex"),
  operations,
};
const output = path.join(root, "openapi/openapi-mutation-policy.generated.json");
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(root, output), operation_count: payload.operation_count, unbound_operation_count: payload.unbound_operation_count, write_activation_allowed: payload.write_activation_allowed }, null, 2));
