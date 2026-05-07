import { parse as yamlParse } from "yaml";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

function resolveRefs(obj, root, seen = new Set()) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(item => resolveRefs(item, root, seen));

  if ("$ref" in obj) {
    const ref = obj["$ref"];
    if (!ref.startsWith("#/")) return obj; // external refs left as-is
    if (seen.has(ref)) return { _circular_ref: ref };

    const parts = ref
      .slice(2)
      .split("/")
      .map(s => s.replace(/~1/g, "/").replace(/~0/g, "~"));

    let target = root;
    for (const part of parts) {
      if (target == null || typeof target !== "object") return obj;
      target = target[part];
    }
    if (target === undefined) return obj;

    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return resolveRefs(JSON.parse(JSON.stringify(target)), root, nextSeen);
  }

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveRefs(v, root, seen);
  }
  return out;
}

function parseDoc(raw) {
  const t = raw.trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  return yamlParse(t);
}

export function splitSchema(rawText) {
  const warnings = [];
  let doc;

  try {
    doc = parseDoc(rawText);
  } catch (e) {
    throw new Error(`Schema parse failed: ${e.message}`);
  }

  if (!doc || typeof doc !== "object") throw new Error("Schema must be a YAML/JSON object");
  if (!doc.openapi) throw new Error("Not a valid OpenAPI document (missing openapi field)");
  if (!doc.paths || typeof doc.paths !== "object") throw new Error("Schema has no paths defined");

  const actionMeta = {
    title: doc.info?.title ?? null,
    version: doc.info?.version ?? null,
    description: doc.info?.description ?? null,
    servers: doc.servers ?? [],
    security: doc.security ?? [],
    securitySchemes: doc.components?.securitySchemes ?? {},
  };

  const operations = [];

  for (const [path, rawPathItem] of Object.entries(doc.paths)) {
    if (!rawPathItem || typeof rawPathItem !== "object") continue;
    const pathItem = resolveRefs(rawPathItem, doc);

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      if (!op.operationId) {
        warnings.push(`${method.toUpperCase()} ${path}: missing operationId — skipped`);
        continue;
      }

      const spec = resolveRefs(
        {
          operationId: op.operationId,
          summary: op.summary,
          description: op.description,
          tags: op.tags,
          parameters: op.parameters,
          requestBody: op.requestBody,
          responses: op.responses,
          security: op.security ?? doc.security,
        },
        doc
      );

      // Remove undefined keys so JSON.stringify produces clean output
      const compact = JSON.parse(JSON.stringify(spec));

      operations.push({
        path,
        method,
        operationId: op.operationId,
        schema_json: JSON.stringify(compact),
      });
    }
  }

  if (operations.length === 0) {
    warnings.push("No operations with operationId were found in this schema");
  }

  return { actionMeta, operations, warnings };
}
