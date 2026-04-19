export function normalizeMethod(method) {
  const m = String(method || "").trim().toUpperCase();
  const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  if (!allowed.includes(m)) {
    const err = new Error(`Method not allowed: ${m}`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
  return m;
}

export function normalizePath(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    const err = new Error("path must be a relative path starting with '/'.");
    err.code = "path_not_allowed";
    err.status = 400;
    throw err;
  }
  if (/^https?:\/\//i.test(path)) {
    const err = new Error("Full URLs are not allowed.");
    err.code = "path_not_allowed";
    err.status = 403;
    throw err;
  }
  return path;
}

export function applyPathParams(pathTemplate, pathParams = {}) {
  return String(pathTemplate || "").replace(/\{([^}]+)\}/g, (_, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null || value === "") {
      const err = new Error(`Missing required path param: ${key}`);
      err.code = "invalid_request";
      err.status = 400;
      throw err;
    }
    return encodeURIComponent(String(value));
  });
}

export function pathTemplateToRegex(pathTemplate) {
  const escaped = String(pathTemplate)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

export function ensureMethodAndPathMatchEndpoint(
  endpoint,
  requestedMethod,
  requestedPath,
  pathParams = {}
) {
  const endpointMethod = normalizeMethod(endpoint.method);
  const endpointPath = normalizePath(endpoint.endpoint_path_or_function);

  let expandedPath = "";
  let pathExpansionError = null;

  try {
    expandedPath = normalizePath(applyPathParams(endpointPath, pathParams));
  } catch (err) {
    pathExpansionError = err;
  }

  if (requestedMethod) {
    const normalizedRequestedMethod = normalizeMethod(requestedMethod);
    if (normalizedRequestedMethod !== endpointMethod) {
      const err = new Error(
        `Method does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "method_mismatch";
      err.status = 400;
      throw err;
    }
  }

  if (requestedPath) {
    const normalizedRequestedPath = normalizePath(requestedPath);

    const exact =
      normalizedRequestedPath === endpointPath ||
      (!!expandedPath && normalizedRequestedPath === expandedPath);

    const regexMatch = pathTemplateToRegex(endpointPath).test(normalizedRequestedPath);

    if (!exact && !regexMatch) {
      const err = new Error(
        `Path does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "path_mismatch";
      err.status = 400;
      throw err;
    }

    return {
      method: endpointMethod,
      path: normalizedRequestedPath,
      templatePath: endpointPath
    };
  }

  if (pathExpansionError) {
    throw pathExpansionError;
  }

  return {
    method: endpointMethod,
    path: expandedPath,
    templatePath: endpointPath
  };
}
