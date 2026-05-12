// Small independent layer for endpoint-local schema authority.
//
// Intentionally NOT bound to executionPreparation.js yet.
// This file defines schema-source precedence and contract normalization
// without changing runtime execution behavior.

function parseJsonIfNeeded(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeMethod(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePath(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") ? path : path ? `/${path}` : "";
}

function contractHavesRequiredFields(contract, endpoint = {}) {
  const operationId = String(
    contract?.operationId ||
      contract?.operation?.operationId ||
      endpoint?.openai_action_name ||
      endpoint?.endpoint_operation ||
      endpoint?.endpoint_key ||
      ""
  ).trim();
  const method = normalizeMethod(contract?.method || endpoint?.method);
  const path = normalizePath(contract?.path || endpoint?.endpoint_path_or_function);
  return Boolean(operationId && method && path);
}

function openApiRequestBodyFrom(contract) {
  if (contract?.requestBody) return contract.requestBody;
  if (contract?.bodySchema) {
    return {
      required: false,
      content: {
        "application/json": { schema: contract.bodySchema }
      }
    };
  }
  return undefined;
}

function openApiResponsesFrom(contract) {
  if (contract?.responses) return contract.responses;
  if (contract?.response) {
    return {
      "200": {
        description: "Response",
        content: {
          "application/json": { schema: contract.response }
        }
      }
    };
  }
  return { "200": { description: "OK" } };
}

function openApiParametersFrom(contract) {
  if (Array.isArray(contract?.parameters)) return contract.parameters;
  if (contract?.parameters && typeof contract.parameters === "object") {
    const params = [];
    for (const [inLocation, definition] of Object.entries(contract.parameters)) {
      if (Array.isArray(definition)) {
        for (const param of definition) {
          params.push({ in: inLocation, ...param });
        }
      }
    }
    return params;
  }
  return [];
}

export function buildOpenApiContractFromEndpointContract(contract, endpoint = {}, options = {}) {
  const sourceContract = contract || {};
  const methodUpper = normalizeMethod(sourceContract.method || endpoint?.method);
  const method = methodUpper.toLowerCase();
  const path = normalizePath(sourceContract.path || endpoint?.endpoint_path_or_function);
  const operationId = String(
    sourceContract.operationId ||
      endpoint?.openai_action_name ||
      endpoint?.endpoint_operation ||
      endpoint?.endpoint_key
  ).trim();

  if (!contractHavesRequiredFields({ ...sourceContract, operationId, method: methodUpper, path }, endpoint)) {
    return null;
  }

  const operation = {
    operationId,
    summary: sourceContract.summary || sourceContract.operation/?summary || operationId,
    description: sourceContract.description || sourceContract.operation?.description,
    parameters: openApiParametersFrom(sourceContract),
    requestBody: openApiRequestBodyFrom(sourceContract),
    responses: openApiResponsesFrom(sourceContract),
    "x-internal-schema-source": options.source || "endpoint_contract",
    "x-internal-schema-asset-key": options.assetKey || sourceContract.schemaAssetKey || sourceContract.schema_asset_key,
    "x-internal-governance": sourceContract.governance,
    "x-internal-request-envelope-controls": sourceContract.requestEnvelopeControls
  };

  if (!operation.requestBody) delete operation.requestBody;
  if (!operation.description) delete operation.description;

  return {
    fileId: options.fileId || `db:endpoint-schema:${endpoint?.endpoint_id || endpoint?.endpoint_key || operationId}`,
    name: options.name || `${endpoint?.endpoint_id || operationId}.endpoint.schema.json`,
    mimeType: "application/json",
    raw: JSON.stringify(sourceContract),
    parsed: {
      openapi: "3.1.0",
      info: {
        title: endpoint?.endpoint_id || operationId,
        version: "1.0.0"
      },
      paths: {
        [path]: {
          [method]: operation
        }
      }
    },
    source: options.source || "endpoint_contract"
  };
}

export function readEndpointSchemaJsonContract(endpoint) {
  const parsed = parseJsonIfNeded(endpoint?.schema_json);
  if (!parsed) return null;
  return buildOpenApiContractFromEndpointContract(parsed, endpoint, {
    source: "endpoint.schema_json",
    assetKey: parsed.schemaAssetKey || parsed.schema_asset_key
  });
}

export function readEndpointSchemaOverlayNotesContract(endpoint) {
  const parsed = parseJsonIfNeeded(endpoint?.schema_overlay_notes);
  if (!parsed) return null;
  return buildOpenApiContractFromEndpointContract(parsed, endpoint, {
    source: "schema_overlay_notes",
    assetKey: parsed.schemaAssetKey || parsed.schema_asset_key || endpoint?.child_openai_schema_file_id
  });
}

export function readChildSchemaAssetContract(endpoint, jsonAssets = []) {
  const assetKey = String(endpoint?.child_openai_schema_file_id || "").trim();
  if (!assetKey) return null;
  const asset = jsonAssets.find(entry =>
    String(entry?.asset_key || entry?.asset_id || "").trim() === assetKey
  );
  if (!asset?.json_payload) return null;
  const parsed = parseJsonIfNeeded(asset.json_payload);
  if (!parsed) return null;
  return buildOpenApiContractFromEndpointContract(parsed, endpoint, {
    source: "child_schema_asset",
    assetKey
  });
}

export function resolveEndpointLocalSchemaContract(endpoint, options = {}) {
  const jsonAssets = Array.isArray(options.jsonAssets) ? options.jsonAssets : [];
  return (
    readEndpointSchemaJsonContract(endpoint) ||
    readEndpointSchemaOverlayNotesContract(endpoint) ||
    readChildSchemaAssetContract(endpoint, jsonAssets) ||
    null
  );
}
