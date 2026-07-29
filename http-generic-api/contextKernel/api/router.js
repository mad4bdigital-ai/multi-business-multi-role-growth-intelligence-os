const CONTEXT_KERNEL_ROUTE_BINDINGS = Object.freeze([
  ["post", "/context-resolutions", "createContextResolution"],
  ["get", "/context-resolutions/:resolutionId", "getContextResolution"],
  ["post", "/context-pins", "createContextPin"],
  ["delete", "/context-pins/:pinId", "deleteContextPin"],
  ["post", "/execution-contexts", "createExecutionContext"],
  ["post", "/execution-contexts/:contextId/validate", "validateExecutionContext"],
]);

export function createContextKernelRouter({ Router, controller }) {
  if (typeof Router !== "function") throw new TypeError("Router must be a function.");
  if (!controller || typeof controller !== "object") throw new TypeError("controller must be an object.");
  const router = Router();
  for (const [method, path, handlerName] of CONTEXT_KERNEL_ROUTE_BINDINGS) {
    if (typeof router[method] !== "function") throw new TypeError(`Router does not support ${method}.`);
    if (typeof controller[handlerName] !== "function") throw new TypeError(`controller.${handlerName} must be a function.`);
    router[method](path, controller[handlerName]);
  }
  return router;
}

export { CONTEXT_KERNEL_ROUTE_BINDINGS };
