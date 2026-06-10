export function resolveSchemaOperation(schema, method, path, deps = {}) {
  const doc = schema?.parsed || {};
  const paths = doc.paths || {};
  const methodKey = String(method || "").toLowerCase();

  if (paths[path] && paths[path][methodKey]) {
    return { operation: paths[path][methodKey], pathTemplate: path };
  }

  for (const [template, entry] of Object.entries(paths)) {
    const regex = deps.pathTemplateToRegex(template);
    if (regex.test(path) && entry?.[methodKey]) {
      return { operation: entry[methodKey], pathTemplate: template };
    }
  }

  return null;
}

export function validateByJsonSchema(schema, value, scope, pathPrefix = "") {
  if (!schema) return [];

  const errors = [];
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  const actualType = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value;
  const normalizedActualType =
    actualType === "number" && Number.isInteger(value) ? "integer" : actualType;

  if (
    types.length &&
    !types.includes(normalizedActualType) &&
    !(types.includes("number") && normalizedActualType === "integer")
  ) {
    errors.push(`${scope}${pathPrefix}: expected ${types.join("|")} got ${normalizedActualType}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${scope}${pathPrefix}: value not in enum`);
    return errors;
  }

  if (normalizedActualType === "object" && schema.properties) {
    const required = schema.required || [];
    for (const req of required) {
      if (!(req in (value || {}))) {
        errors.push(`${scope}${pathPrefix}.${req}: missing required property`);
      }
    }
    for (const [key, rule] of Object.entries(schema.properties || {})) {
      if (value && key in value) {
        errors.push(...validateByJsonSchema(rule, value[key], scope, `${pathPrefix}.${key}`));
      }
    }
  }

  if (normalizedActualType === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, idx) => {
      errors.push(...validateByJsonSchema(schema.items, item, scope, `${pathPrefix}[${idx}]`));
    });
  }

  return errors;
}

export function validateParameters(operation, request) {
  const errors = [];
  const params = operation?.parameters || [];
  for (const param of params) {
    const where = param.in;
    const name = param.name;
    const required = !!param.required;
    const source =
      where === "path"
        ? request.path_params
        : where === "query"
          ? request.query
          : where === "header"
            ? request.headers
            : {};
    const value = source ? source[name] ?? source[name?.toLowerCase?.()] : undefined;
    if (required && (value === undefined || value === null || value === "")) {
      errors.push(`missing required ${where} parameter: ${name}`);
      continue;
    }
    if (value !== undefined && param.schema) {
      errors.push(...validateByJsonSchema(param.schema, value, `${where}:${name}`));
    }
  }
  return errors;
}

export function validateRequestBody(operation, body) {
  const reqBody = operation?.requestBody;
  if (!reqBody) return [];
  if (reqBody.required && (body === undefined || body === null)) {
    return ["missing required request body"];
  }
  if (body === undefined || body === null) return [];

  const content = reqBody.content || {};
  const multipartRelatedContent = content["multipart/related"];
  const jsonContent = content["application/json"];
  const selectedContent =
    typeof body === "string" && multipartRelatedContent
      ? multipartRelatedContent
      : jsonContent || Object.values(content)[0];
  const schema = selectedContent?.schema;
  if (!schema) return [];
  return validateByJsonSchema(schema, body, "body");
}

export function classifySchemaDrift(expected, actual, scope) {
  if (
    !expected ||
    actual === undefined ||
    actual === null ||
    typeof actual !== "object" ||
    Array.isArray(actual)
  ) {
    return null;
  }
  const expectedProps = expected.properties || {};
  const expectedKeys = new Set(Object.keys(expectedProps));
  const actualKeys = Object.keys(actual);
  const required = new Set(expected.required || []);

  for (const key of required) {
    if (!(key in actual)) {
      return {
        schema_drift_detected: true,
        schema_drift_type: "missing_required",
        schema_drift_scope: scope
      };
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      return {
        schema_drift_detected: true,
        schema_drift_type: "additive",
        schema_drift_scope: scope
      };
    }
    const rule = expectedProps[key] || {};
    if (rule.enum && !rule.enum.includes(actual[key])) {
      return {
        schema_drift_detected: true,
        schema_drift_type: "enum_mismatch",
        schema_drift_scope: scope
      };
    }
    const t = rule.type;
    if (t) {
      const actualType = Array.isArray(actual[key])
        ? "array"
        : actual[key] === null
          ? "null"
          : typeof actual[key];
      const mappedActual =
        actualType === "number" && Number.isInteger(actual[key]) ? "integer" : actualType;
      const acceptable = Array.isArray(t) ? t : [t];
      if (
        !acceptable.includes(mappedActual) &&
        !(acceptable.includes("number") && mappedActual === "integer")
      ) {
        return {
          schema_drift_detected: true,
          schema_drift_type: "type_mismatch",
          schema_drift_scope: scope
        };
      }
    }
  }
  return null;
}
