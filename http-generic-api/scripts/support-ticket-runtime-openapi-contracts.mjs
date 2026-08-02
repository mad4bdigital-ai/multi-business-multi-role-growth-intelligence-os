import fs from "node:fs";
import path from "node:path";

export const SUPPORT_TICKET_ROUTE_FILE = "routes/supportTicketRoutes.js";
const METHOD_ORDER = new Map(["GET", "POST", "PUT", "PATCH", "DELETE"].map((method, index) => [method, index]));
const HTTP_METHOD_KEYS = new Set([...METHOD_ORDER.keys()].map((method) => method.toLowerCase()));
const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

function normalizePath(routePath) {
  let value = String(routePath || "").trim();
  if (!value || value === "/") return "/";
  if (!value.startsWith("/")) value = `/${value}`;
  return value.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function declarationLine(source, index) {
  const end = source.indexOf("\n", index);
  return source.slice(index, end === -1 ? source.length : end);
}

function inferAuthProfile(declaration, signature) {
  if (/\brequireTenantUserJwt\b|\brequireUserJwt\b/.test(declaration)) return "user_jwt";
  if (/\.\.\.adminGuards\b/.test(declaration)) return "admin_backend";
  throw new Error(`Unsupported or ambiguous Support Ticket runtime authorization for ${signature}.`);
}

export function collectSupportTicketRuntimeOperations(root = process.cwd()) {
  const routePath = path.join(root, SUPPORT_TICKET_ROUTE_FILE);
  if (!fs.existsSync(routePath)) return [];
  const source = fs.readFileSync(routePath, "utf8");
  const bySignature = new Map();
  let match;
  while ((match = ROUTE_RE.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const normalizedPath = normalizePath(match[2]);
    const signature = `${method} ${normalizedPath}`;
    const declaration = declarationLine(source, match.index);
    const authProfile = inferAuthProfile(declaration, signature);
    const existing = bySignature.get(signature);
    if (existing && existing.auth_profile !== authProfile) {
      throw new Error(`Support Ticket runtime route ${signature} declares conflicting authorization profiles.`);
    }
    bySignature.set(signature, {
      signature,
      method,
      path: normalizedPath,
      auth_profile: authProfile,
    });
  }
  return [...bySignature.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || METHOD_ORDER.get(left.method) - METHOD_ORDER.get(right.method));
}

function pascal(value) {
  return String(value || "")
    .replace(/[{}]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
}

function operationIdFor(operation) {
  const pathParts = operation.path.split("/").filter(Boolean).map((part) => {
    const parameter = part.match(/^\{([A-Za-z0-9_]+)\}$/);
    return parameter ? `By${pascal(parameter[1])}` : pascal(part);
  });
  return `supportTicketRuntime${pascal(operation.method.toLowerCase())}${pathParts.join("")}`;
}

function securityFor(profile) {
  if (profile === "user_jwt") return [{ userJwtAuth: [] }];
  if (profile === "admin_backend") return [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }];
  throw new Error(`Unsupported Support Ticket authorization profile: ${profile}`);
}

function canonicalSecurity(value) {
  return JSON.stringify((Array.isArray(value) ? value : []).map((entry) => Object.keys(entry || {}).sort()).sort());
}

function humanResource(routePath) {
  return routePath.split("/").filter(Boolean).filter((part) => !part.startsWith("{")).map((part) => part.replace(/[-_]+/g, " ")).join(" ") || "support ticket operation";
}

function response(description) {
  return {
    description,
    content: {
      "application/json": {
        schema: { type: "object", additionalProperties: true },
      },
    },
  };
}

function buildOperation(operation) {
  const verb = { GET: "Read", POST: "Execute", PUT: "Replace", PATCH: "Update", DELETE: "Delete" }[operation.method];
  const parameters = [...operation.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1 },
  }));
  const result = {
    operationId: operationIdFor(operation),
    summary: `${verb} ${humanResource(operation.path)}`,
    description: `Runtime-derived precise route and authorization contract for ${operation.signature} from ${SUPPORT_TICKET_ROUTE_FILE}. Response fields remain service-defined and may include additional properties.`,
    tags: [operation.path.includes("tenant-requests") || operation.path.startsWith("/tenants/") ? "Tenant Requests" : "Support Tickets"],
    security: securityFor(operation.auth_profile),
    "x-openai-isConsequential": operation.method !== "GET",
    "x-runtime-contract-source": SUPPORT_TICKET_ROUTE_FILE,
    "x-runtime-auth-profile": operation.auth_profile,
    responses: {
      "200": response("The Support Ticket operation completed."),
      "400": response("The request was invalid."),
      "401": response("Authentication is required."),
      "403": response("The authenticated principal is not authorized."),
      "404": response("The requested Support Ticket resource was not found."),
      "409": response("The request conflicts with current Support Ticket state."),
      "500": response("The Support Ticket operation failed."),
    },
  };
  if (parameters.length > 0) result.parameters = parameters;
  return result;
}

export function isPreciseRuntimeContract(current, operation) {
  return current
    && current.operationId === operationIdFor(operation)
    && typeof current.summary === "string"
    && current.summary.length > 0
    && current.responses
    && typeof current.responses === "object"
    && canonicalSecurity(current.security) === canonicalSecurity(securityFor(operation.auth_profile))
    && current["x-openai-isConsequential"] === (operation.method !== "GET")
    && current["x-runtime-contract-source"] === SUPPORT_TICKET_ROUTE_FILE
    && current["x-runtime-auth-profile"] === operation.auth_profile
    && current["x-contract-completeness"] !== "operation-index-only";
}

export function isReplaceablePreciseRuntimePathItem(pathItem, operations) {
  if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) return false;
  const expectedByMethod = new Map();
  for (const operation of operations) {
    const method = operation.method.toLowerCase();
    if (expectedByMethod.has(method)) return false;
    expectedByMethod.set(method, operation);
  }
  const keys = Object.keys(pathItem);
  if (keys.length !== expectedByMethod.size) return false;
  return keys.every((key) => {
    const operation = expectedByMethod.get(key);
    return HTTP_METHOD_KEYS.has(key)
      && operation
      && isPreciseRuntimeContract(pathItem[key], operation);
  });
}

function isReplaceableRuntimeIndex(current, operation) {
  return current
    && current["x-contract-completeness"] === "operation-index-only"
    && current["x-source-file"] === SUPPORT_TICKET_ROUTE_FILE
    && canonicalSecurity(current.security) === canonicalSecurity(securityFor(operation.auth_profile));
}

export function inspectSupportTicketRuntimeContracts(doc, runtimeOperations, staticContracts, staticPathRefs) {
  const staticSignatures = new Set(staticContracts.map((contract) => contract.signature));
  const expectedOperationIds = new Map();
  const runtimeBySignature = new Map(runtimeOperations.map((operation) => [operation.signature, operation]));
  const missingByPath = new Map();
  const replaceableByPath = new Map();
  const synced = [];
  const conflicts = [];

  for (const operation of runtimeOperations) {
    if (staticSignatures.has(operation.signature)) continue;
    if (staticPathRefs.has(operation.path)) {
      conflicts.push({ signature: operation.signature, code: "support_ticket_static_path_partially_registered", path_item_ref: staticPathRefs.get(operation.path) });
      continue;
    }
    const operationId = operationIdFor(operation);
    const priorSignature = expectedOperationIds.get(operationId);
    if (priorSignature && priorSignature !== operation.signature) {
      conflicts.push({ signature: operation.signature, code: "support_ticket_operation_id_collision", operation_id: operationId, prior_signature: priorSignature });
      continue;
    }
    expectedOperationIds.set(operationId, operation.signature);

    const pathItem = doc.paths?.[operation.path];
    const current = pathItem?.[operation.method.toLowerCase()];
    if (current) {
      if (isPreciseRuntimeContract(current, operation)) {
        synced.push({ signature: operation.signature, source: "existing_openapi" });
      } else if (isReplaceableRuntimeIndex(current, operation)) {
        const operations = replaceableByPath.get(operation.path) || [];
        operations.push(operation);
        replaceableByPath.set(operation.path, operations);
      } else {
        conflicts.push({
          signature: operation.signature,
          code: "support_ticket_existing_contract_not_precise",
          expected_operation_id: operationId,
          expected_security: securityFor(operation.auth_profile),
          actual_security: current.security || null,
          actual_contract_source: current["x-runtime-contract-source"] || current["x-source-file"] || null,
          actual_contract_completeness: current["x-contract-completeness"] || null,
        });
      }
      continue;
    }
    if (pathItem && Object.keys(pathItem).length > 0) {
      conflicts.push({ signature: operation.signature, code: "support_ticket_partial_path_contract_conflict", existing_keys: Object.keys(pathItem) });
      continue;
    }
    const operations = missingByPath.get(operation.path) || [];
    operations.push(operation);
    missingByPath.set(operation.path, operations);
  }

  for (const [routePath, operations] of replaceableByPath) {
    const pathItem = doc.paths?.[routePath] || {};
    const replacementSignatures = new Set(operations.map((operation) => operation.signature));
    const unsafeKeys = Object.keys(pathItem).filter((key) => {
      if (!HTTP_METHOD_KEYS.has(key)) return true;
      const signature = `${key.toUpperCase()} ${routePath}`;
      const operation = runtimeBySignature.get(signature);
      return !operation || !replacementSignatures.has(signature) || !isReplaceableRuntimeIndex(pathItem[key], operation);
    });
    if (unsafeKeys.length > 0) {
      conflicts.push({
        path: routePath,
        code: "support_ticket_runtime_index_path_not_fully_replaceable",
        unsafe_keys: unsafeKeys,
      });
      replaceableByPath.delete(routePath);
    }
  }

  return { missingByPath, replaceableByPath, synced, conflicts };
}

export function buildSupportTicketRuntimePathItems(operationsByPath) {
  const entries = new Map();
  for (const [routePath, operations] of [...operationsByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const pathItem = {};
    for (const operation of [...operations].sort((left, right) => METHOD_ORDER.get(left.method) - METHOD_ORDER.get(right.method))) {
      pathItem[operation.method.toLowerCase()] = buildOperation(operation);
    }
    entries.set(routePath, pathItem);
  }
  return entries;
}
